# Waggles BLE Spike

A **throwaway, isolated** Expo app that proves out **real BLE** on a device —
the proving ground for the Waggles mesh (`WAGGLES_MESH_CORE1` builds on it).
It is deliberately **not** wired to TALK/COMMS or any Waggles backend.

It lives in a subfolder of the Waggles repo on purpose: the repo root is the
real Waggles messenger, and this spike must stay isolated from it (its own
`package.json`, `node_modules`, `app.json`, `eas.json`). Treat it as disposable.

## What it does

The mesh test screen (`WAGGLES_MESH_CORE1`): shows discovered **peers**, a
**Send** box, and a **live log** of SENT / RECV / RELAY(from→to) / DROP-DUP /
TTL-STOP. Built to watch **A originate, B relay, C receive** with A and C out of
direct BLE range.

### Mesh model (`src/mesh/`)

Protocol-simple store-and-forward gossip — a proof, not a final wire format:

- **Message** `{ id, origin, ttl, payload, seen[] }`.
- **On receive**: `id` already in the bounded **seen-cache** → DROP (dedup /
  loop guard); else **deliver locally**, **decrement ttl**, and if `ttl > 0`
  **re-broadcast** to peers not already in `seen[]` (store-and-forward).
- **TTL** hop limit (default 5) + **bounded seen-cache** (FIFO, default 512)
  stop loops and floods.

`MeshEngine` is pure and transport-agnostic (`engine.ts`); `transport.ts` has
the `Transport` interface, a `MeshNode` glue layer, and an `InMemoryNetwork`
that wires A/B/C with an explicit topology so the relay is proven with **no
hardware**. Run it:

```bash
npm test       # tsc + node --test — dedup, ttl, seen-cache, A→B→C, loop guard, kill-B, codec
```

### ⚠️ BLE dual-role constraint (real, must-know)

`react-native-ble-plx` is **central-only** — it can scan / connect / read /
write / subscribe, but it **cannot advertise or run a GATT server** (no
`startAdvertising`). The mesh needs the **dual role** (each node both advertises
*and* scans). `src/ble/bleTransport.ts` implements the **central half** fully;
the **peripheral half** is a documented seam (`startPeripheral()`) that needs a
companion native module — e.g. **`react-native-ble-advertiser`** (advertise) or
a GATT-server module — added as an extra Expo config plugin + dev-client
rebuild. **Until that module is added, two ble-plx-only nodes cannot discover
each other.** The engine, codec, and central half are proven and ready to drive
once it lands. (iOS further restricts the peripheral role in background — Android
is the reliable dual-role target, which is why the device test is Android.)

## Device reality (owner-confirmed)

- **iPhones only, no Apple Developer account.** A real-BLE build **cannot** be
  installed on an iPhone via QR without a paid Apple Developer account
  (TestFlight / ad-hoc) or a Mac free-provisioning sideload. **Expo Go cannot
  run custom BLE at all.** iOS config (bundle id + `NSBluetooth*` plist
  strings) is present but **untested**.
- **On-device target is Android** via EAS Build *internal distribution* (free):
  it produces an APK plus a QR/URL to sideload.

## Build & install (owner runs these — needs an Expo login)

Code cannot run `eas build` (requires the owner's Expo account) and there is no
Android device yet to test on. From this folder:

```bash
cd waggles/ble-spike
npm install                       # already run during scaffold; re-run on a fresh clone
npx eas login                     # owner's Expo account
npx eas build -p android --profile preview
```

When the build finishes, EAS prints an **install QR / URL**. Open it on the
Android phone, install the APK, launch "Waggles BLE Spike", accept the
Bluetooth permission prompt, and confirm the adapter state reads **"Powered on
— ready"**.

> `eas build` uploads the project to EAS and provisions an Android keystore on
> first run (accept the prompt). No `eas.json` secrets are required for the
> `preview` profile.

## Local checks (no device needed)

```bash
npm run typecheck   # tsc --noEmit
npm test            # mesh relay unit tests (no device)
npm run doctor      # expo-doctor
```

## 3-Android mesh test runbook (owner, deferred)

Proves A → B → C relay with A and C **not** in direct range. **Prerequisite:**
the peripheral module must be added first (see the dual-role constraint above) —
without it the phones will not discover each other.

1. Add a peripheral/advertiser module + config plugin, then
   `npx eas build -p android --profile preview` and install the APK on **three**
   Android phones (A, B, C).
2. Launch the app on all three; accept Bluetooth permission on each. Each shows
   its own `node <id>`.
3. **Geometry:** place B in the middle. Put A and C far enough apart (or shield
   one, e.g. foil / a few rooms) that **A and C do NOT list each other as
   peers**, but **both list B** (and B lists both A and C).
4. On **A**, type a message and Send. **Expected:** A logs `SEND`; B logs `RECV`
   then `RELAY A→C`; **C logs `RECV`/`DELIVER`** — delivered via B though A and C
   never saw each other. Sending again shows `DROP-DUP` on repeats.
5. **Kill B** (quit the app / Bluetooth off on B). Send again from A.
   **Expected:** C receives **nothing** — the only path was through B.

Record on each phone: peers listed, and the SEND/RECV/RELAY/DELIVER/DROP log
lines, to confirm the hop path.
