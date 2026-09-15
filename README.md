# Waggles.app

A **sovereign, self-host, end-to-end-encrypted messenger** — the native (Expo /
React Native) face over the HONEYCOMB comms core. Your keys, your server, your
messages. Nothing routes through us.

Waggles is the **native track** counterpart to the web COMMS surface in
`TheMANUAL.tech`. It does **not** fork the crypto or the schema — it MOUNTS the
existing, already-deployed comms core and speaks the identical wire format, so a
Bee's messages cross web ↔ native transparently.

---

## What it is

- **Sovereign / self-host.** The app ships with no baked-in backend **and no
  default one**. On first run you point it at your own Waggles backend (a Supabase
  project running the schema + RPCs in `db/`) and supply that project's public anon
  key. Until you do, the app reaches no server at all — there is deliberately no
  fallback host to fall back to (WAGGLES_FORK_PLAN v0.2, ruling #4). An operator
  building Waggles for their own deployment may pre-fill both fields via
  `.env` (see `.env.example`); that is their choice, not a vendor default.
- **End-to-end encrypted.** Each device holds an X25519 identity keypair; the
  secret key lives only in the OS keystore (Keychain / Android Keystore) via
  `expo-secure-store` and never leaves the device unless you export a recovery
  code. Each conversation has a random content key sealed (`crypto_box_seal`) to
  every device of every member; message bodies are XChaCha20-Poly1305. The server
  only ever sees public keys, sealed blobs, and ciphertext.
- **Offline-first.** The conversation list and open threads are cached locally and
  the app opens to real content with no network. A message composed offline is
  queued in an outbox and flushed when connectivity returns.

## Wire compatibility (the "mount, don't fork" contract)

`src/lib/e2ee.ts` is a deliberate line-for-line mirror of
`TheMANUAL.tech/src/lib/e2ee.ts`. Only the platform seams differ:

| Concern            | Web (`TheMANUAL.tech`)        | Native (`Waggles.app`)                    |
| ------------------ | ----------------------------- | ----------------------------------------- |
| libsodium          | `libsodium-wrappers-sumo` (WASM) | `react-native-libsodium` (native binding) |
| identity secret    | IndexedDB                     | `expo-secure-store` (OS keystore)         |
| public key / device id | IndexedDB                 | `AsyncStorage`                            |
| safety-number memory | `localStorage`              | `AsyncStorage`                            |
| Supabase client    | module singleton              | runtime factory (self-host endpoint)      |

Algorithms, byte framing (`e2ee:v1:` + base64(nonce‖ct)), base64 variants, and the
`comms_*` RPC calls are **unchanged** — that identity is what makes the two clients
interoperate. Do not "improve" the crypto here; change it in both or neither.

> **Why a dev build, not Expo Go:** Hermes (React Native's engine) has no
> WebAssembly, so the web's WASM sumo build can't run on device. `react-native-libsodium`
> is a native module, which requires a custom **dev-client** build. Plain Expo Go
> cannot load it.

## Project layout

```
Waggles.app/
├── app/                     Expo Router routes
│   ├── _layout.tsx          root stack + AuthProvider
│   ├── index.tsx            boot gate → setup / sign-in / chats
│   ├── setup.tsx            first-run self-host endpoint config
│   ├── sign-in.tsx          email one-time-code auth
│   ├── chats.tsx            conversation list (realtime + offline cache)
│   ├── new.tsx              start a direct chat / create a group
│   ├── c/[id].tsx           thread: messages, composer, outbox, key status
│   └── settings.tsx         identity, recovery code, safety number, endpoint, sign-out
├── src/lib/
│   ├── config.ts            self-host endpoint store
│   ├── supabase.ts          runtime client factory
│   ├── sodium.ts            libsodium adapter (the mount seam)
│   ├── e2ee.ts              E2EE core (native port — wire-compatible)
│   ├── comms.ts             typed data layer over comms_* RPCs
│   ├── cache.ts             offline cache + outbox
│   ├── auth.tsx             auth/boot context
│   ├── format.ts            time/initials helpers
│   └── theme.ts             light/dark tokens
├── db/proposals/            (empty — no schema proposed; mounts existing core)
├── app.json  eas.json  tsconfig.json  babel.config.js
```

## Develop

```bash
npm install
npm run typecheck        # tsc --noEmit — the green gate CI runs

# On-device (requires the owner-gated dev-client build, see below):
npm run prebuild         # generates native ios/ & android/ projects
npm run ios              # or: npm run android
npm start                # Metro for the dev client
```

Language firewall holds: this is a messenger; it uses no money vocabulary. If a
GET/GIVE/OFFER surface is ever added, apply the firewall.

## Owner-gated (do NOT attempt without Butch)

Per the DEPLOY AMENDMENT, these are owner actions — the agent never performs them:

- **Apple / Google developer accounts, signing credentials, provisioning.**
- **`eas build` / `eas submit`** (store or TestFlight/Play submission).
- **App Store / Play Store listing + review.**

`eas.json` is provided so the owner can run `eas build --profile development` for a
dev client and `--profile production` for store binaries when ready. The JS/TS
layer (this repo) is complete and typechecks; the native compile + store shipping
is the owner's gate.

## Known deferrals (v1 native)

- **Voice messages & media object-URL playback** — the web build uses browser
  `Blob` / `URL.createObjectURL` / `MediaRecorder`; native equivalents
  (`expo-av`, `expo-file-system`) are a follow-up. Text, reactions, pins, groups,
  disappearing messages, blocks, presence, typing, and safety numbers are live.
- **LiveKit calls / spaces / roulette** — out of scope for the messenger v1.
- **Cache-at-rest encryption** — the offline cache holds decrypted bodies in the
  app sandbox; the identity secret stays in the keystore. A hardened build moves
  the cache behind SQLCipher / an encrypted store.
- **Push notifications** — `expo-notifications` + a server hook is a follow-up.

## Backend it mounts

See `db/proposals/README.md` for the exact tables and RPCs. Nothing in this repo
writes DDL.
