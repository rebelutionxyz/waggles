# BLE Advertiser / Peripheral module — design plan

**Pass:** WAGGLES_BLE_ADV1 · **Status:** design doc only (no native code).
Native-only (Go-Dark mesh is not part of the web version). Post-v1 feature per
`WAGGLES_CONCEPT` v0.9.

## The problem this solves

`WAGGLES_MESH_CORE1` built and tested the store-and-forward relay core (engine,
dedup, TTL, frame codec, and the **central-role** BLE transport over
`react-native-ble-plx`). It proved A→B→C relay with A and C not directly linked —
but only over an in-memory test network. On real radios it cannot yet run, for one
reason:

> **`react-native-ble-plx` is central-only.** It scans, connects, reads, writes and
> subscribes, but has no advertise / GATT-server API. A node built on it can *find*
> peers but can never *be found*. Two such nodes never discover each other.
> (Verified in MESH_CORE1 by grepping the library; re-stated in
> `ble-spike/src/ble/bleTransport.ts` and its `startPeripheral()` seam.)

The mesh needs the **dual role**: every node both **advertises** the mesh service
*and* **serves** the frame characteristic so other centrals can push frames to it,
while also running the already-built central half to push frames out. This document
plans the missing **peripheral half** as a native module.

## What already exists (do not rebuild)

From `ble-spike/` (MESH_CORE1, commit `8e5a07c`):

- `src/ble/protocol.ts` — the GATT identifiers and the pure-JS frame codec:
  - `MESH_SERVICE_UUID = b2e7d8a0-0001-4a7c-9c1a-a1b2c3d4e5f0`
  - `MESH_FRAME_CHAR_UUID = b2e7d8a0-0002-4a7c-9c1a-a1b2c3d4e5f1`
  - `encodeFrame()/decodeFrame()` — base64(UTF-8 JSON) of a `MeshMessage`.
- `src/ble/bleTransport.ts` — the central half: `startScanning()` filters on
  `MESH_SERVICE_UUID`, connects, `monitorCharacteristic` for inbound frames,
  `writeCharacteristicWithoutResponse` to send; `startPeripheral()` is the empty seam
  this module fills.
- `src/mesh/*` — transport-agnostic engine + `MeshNode` glue (`Transport.sendTo`,
  `onFrame`). The peripheral module must feed inbound frames into the same `onFrame`
  sink and accept outbound frames the same way the central half does; **no mesh-logic
  change is needed.**

The design below keeps those UUIDs and that codec unchanged so the central half drives
it the moment the peripheral half lands.

## Options for the peripheral half

### Option A — advertise-only (`react-native-ble-advertiser`-style)
Broadcast `MESH_SERVICE_UUID` in the advertising packet so other centrals can *discover*
the node. **Insufficient alone:** advertising makes the node visible but provides no GATT
server, so a discovering central has nothing to `write` the frame to and nothing to
`subscribe` to. The existing central transport is connection + characteristic based, so
advertise-only would force a rewrite to connectionless data. *(Likely)* Rejected as the
primary path; may still be needed as the advertising piece if a chosen GATT-server
library does not advertise on its own.

### Option B — connectionless broadcast (frame in the advertising payload)
Put the frame bytes in the advertising / scan-response payload (service-data or
manufacturer-data); every scanner reads it passively, no connection. **Limits:** BLE
legacy advertising carries ~20–27 usable bytes; BLE 5 "extended advertising" carries up
to ~255 but needs Android 8+ (API 26) and hardware support, and is itself not universally
reliable. Mesh frames are base64 JSON (`id`, `origin`, `ttl`, `payload`, `seen[]`) and
routinely exceed that, so this needs fragmentation/reassembly. *(Assumption:* most target
phones support extended advertising, but not all.) Keep as a **future augmentation** for
tiny beacon frames, not the v1 transport.

### Option C — full GATT server native module (RECOMMENDED)
A custom Android native module that:
1. Advertises `MESH_SERVICE_UUID` via `BluetoothLeAdvertiser`, and
2. Runs a `BluetoothGattServer` hosting `MESH_FRAME_CHAR_UUID` with
   **WRITE_NO_RESPONSE + NOTIFY** (plus a CCCD descriptor for notify subscriptions).

This is the exact shape the central half already speaks (`writeCharacteristicWithoutResponse`
+ `monitorCharacteristic`), so both halves compose into the dual role with zero changes to
the mesh engine or codec. **This is the plan.** Android first.

## Why Android first, iOS later

- **Android** exposes `BluetoothLeAdvertiser` + `BluetoothGattServer` directly; a foreground
  service keeps advertising/scanning alive. Reliable dual-role target. *(Verified API
  exists; on-device behaviour Likely pending the 3-phone test.)*
- **iOS** CoreBluetooth *can* act as a peripheral, but in the background the advertised
  **service UUID is moved to the "overflow" area**, which other iOS centrals cannot discover
  in the background, and background advertising is heavily restricted. *(This is the
  documented CoreBluetooth limitation — Likely decisive for a mesh that must run with the
  screen off.)* iOS is therefore a later pass with its own constraints doc; do not block
  Android on it.

## GATT layout (the contract both halves share)

| Element | Value | Properties | Notes |
|---|---|---|---|
| Service | `b2e7d8a0-0001-4a7c-9c1a-a1b2c3d4e5f0` | primary | advertised in the adv packet so `startDeviceScan([MESH_SERVICE_UUID])` finds it |
| Frame characteristic | `b2e7d8a0-0002-4a7c-9c1a-a1b2c3d4e5f1` | `WRITE_NO_RESPONSE`, `NOTIFY` | value = one `encodeFrame()` string (base64 JSON) |
| CCCD descriptor | `00002902-0000-1000-8000-00805f9b34fb` | read/write | standard Client Characteristic Configuration for notify subscriptions |

**Direction of data (per node, dual role):**
- *Inbound to this node:* a remote central (another node's central half) **writes** a frame
  to our frame characteristic → the GATT server's `onCharacteristicWriteRequest` hands the
  base64 up to JS → JS calls `decodeFrame` → feeds `MeshNode`'s `onFrame` sink (same path the
  central half uses today).
- *Outbound from this node:* the central half still `writeCharacteristicWithoutResponse`s to
  each connected peer (unchanged). The server's **notify** is the symmetric alternative for
  peers subscribed to us; v1 can rely on the central-write path and treat notify as the
  mechanism that lets a peer that connected *to us* receive our relays without us also opening
  a central connection back. *(Assumption: central-write to every discovered peer is enough
  for the 3-phone test; notify is the clean long-term path.)*

### MTU / fragmentation
Default ATT MTU is 23 (20 usable bytes). Frames exceed this. Steps:
1. Central negotiates a larger MTU (`BleManager.requestMTU`, Android server supports up to
   517). *(Likely sufficient for single-message text frames.)*
2. If a frame still exceeds the negotiated MTU, add a thin chunking layer (seq/total header)
   in `protocol.ts`, reassembled before `decodeFrame`. Defer until a measured frame overflows.

### JS ↔ native bridge contract
The native module exposes to JS:
- `startAdvertising()` / `stopAdvertising()`
- `startGattServer()` / `stopGattServer()`
- event `onFrameWritten(base64: string, fromDeviceId: string)`
- `notifyFrame(base64: string)` (push to subscribers)
`bleTransport.ts`'s `startPeripheral()` becomes: start advertising + GATT server, and wire
`onFrameWritten` → the existing `frameHandler`. The `Transport` interface is unchanged.

## Android permissions / runtime
- `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (API 31+; declare
  `neverForLocation` on SCAN to avoid the location grant where possible). Legacy
  (API ≤ 30): `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION`.
- A **foreground service** (type `connectedDevice`) to keep the radios alive with the screen
  off. *(Likely required for a usable mesh; confirm on-device.)*
- Delivered as an **Expo config plugin** that injects the manifest entries + links the Kotlin
  module, requiring a **dev-client / EAS rebuild** (not Expo Go).

## Build steps, each with a done-test

1. **Scaffold the native module + config plugin.**
   *Done-test:* `npx expo prebuild` succeeds; the app boots on a dev-client with the module
   linked; `NativeModules.WagglesBleAdvertiser` is defined in JS.
2. **Advertise the service UUID.**
   *Done-test:* a second device running **nRF Connect** (or any BLE scanner) sees an
   advertisement carrying `b2e7d8a0-0001-…`. (1 phone + 1 scanner device suffices.)
3. **Stand up the GATT server with the frame characteristic.**
   *Done-test:* nRF Connect connects, discovers the service, sees
   `b2e7d8a0-0002-…` with write + notify, and can **write** a base64 value; the app logs
   `onFrameWritten` with that value.
4. **Wire `onFrameWritten` → `MeshNode.onFrame`; implement `notifyFrame`.**
   *Done-test:* writing a valid `encodeFrame` frame from nRF Connect produces a local DELIVER
   log; an invalid value is dropped by `decodeFrame` (no crash).
5. **Compose dual role:** `startPeripheral()` starts advertising + server; `startScanning()`
   unchanged. MTU negotiation added.
   *Done-test (2 phones):* phone A discovers phone B and B discovers A (both advertise + scan);
   a message from A appears on B.
6. **Full mesh relay (3 phones).**
   *Done-test (3 phones):* B in the middle; A and C positioned so they do **not** list each
   other but both list B; send from A → B logs `RELAY A→C`, C logs `DELIVER`; repeats show
   `DROP-DUP`; kill B → C receives nothing. (This is the MESH_CORE1 runbook, now runnable.)

## What must be measured on real devices (hardware gate)

The owner has **one** Android phone; the full mesh test needs **three**. Measurable now vs later:

| Needs | Phones | Measurable with 1 phone + a scanner? |
|---|---|---|
| Module builds & links (step 1) | 1 | Yes |
| Advertises service UUID (step 2) | 1 + scanner | Yes (nRF Connect as the observer) |
| GATT server write/notify (steps 3–4) | 1 + scanner | Yes (nRF Connect writes/subscribes) |
| Mutual discovery (step 5) | 2 | No — needs a 2nd phone running the app |
| A→B→C relay, dedup, TTL, kill-B (step 6) | 3 | No — needs 3 phones |

So steps 1–4 are verifiable with the single phone plus a generic BLE scanner app as the peer;
steps 5–6 are **blocked on hardware** (2–3 Android phones) and must be marked pending until the
owner has them.

## What can be simulated without hardware (and already is)
- The relay engine, dedup, TTL and topology logic — `ble-spike/src/mesh/engine.test.ts`
  (10/10, via `InMemoryNetwork`). Unchanged by this module.
- The frame codec round-trip — same suite.
- The JS↔native bridge **contract** — mock `NativeModules.WagglesBleAdvertiser` in a JS test
  and assert `startPeripheral()` wires `onFrameWritten` into `frameHandler`. The radio itself
  (advertising, GATT) cannot be simulated in Node and is the on-device gate.

## Out of scope / carried risk
- **No encryption is added by this module.** Mesh frames today carry `payload` as a plain
  string; `WAGGLES_CONCEPT` v0.9 notes TALK_GODARK1 flagged a **security defect** in the mesh
  module to carry into the Go-Dark pass. Payloads must be E2EE'd before Go-Dark ships; that is
  the Go-Dark crypto pass, not this transport module. Flagged here so it is not lost.
- iOS peripheral support (its own later pass).
- Connectionless / extended-advertising transport (Option B) — future augmentation.

*Unverified claims above are marked Likely or Assumption; everything else is grounded in the
MESH_CORE1 code/report or the public Android/CoreBluetooth APIs.*
