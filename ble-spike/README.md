# Waggles BLE Spike

A **throwaway, isolated** Expo app that proves out **real BLE** on a device —
the proving ground for the Waggles mesh (`WAGGLES_MESH_CORE1` builds on it).
It is deliberately **not** wired to TALK/COMMS or any Waggles backend.

It lives in a subfolder of the Waggles repo on purpose: the repo root is the
real Waggles messenger, and this spike must stay isolated from it (its own
`package.json`, `node_modules`, `app.json`, `eas.json`). Treat it as disposable.

## What it does

Single screen. On launch it creates a `BleManager`, fires the runtime
Bluetooth permission prompt (Android), and renders the live BLE **adapter
state** (powered on/off/unauthorized/…). No scanning, no advertising loop, no
mesh — that is the next pass.

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
npm run doctor      # expo-doctor
```
