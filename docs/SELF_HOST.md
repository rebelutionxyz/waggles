# Self-hosting Waggles

Waggles is a **sovereign, self-host, end-to-end-encrypted messenger** (Expo / React
Native). It ships **no default backend** — a fresh clone talks to *your* Supabase
project and nobody else's. This guide takes a stranger from `git clone` to a running
app. License: **AGPLv3** (running a modified Waggles as a hosted service obliges you
to offer its source).

> **The one thing this repo cannot do for you:** create your Supabase project, your
> LiveKit project, or your app-store/EAS account. Those are yours to stand up
> (account, hosting, cost, naming). Everything else — schema, functions, client — is
> in the repo.

---

## 1. Prerequisites

| Need | For |
|---|---|
| Node 20+ and npm | building the app |
| A **Supabase** project (free tier is fine) | the backend (auth + Postgres + storage) |
| `psql` (or the Supabase SQL editor) | applying the DB bundle |
| An **Expo/EAS** account + `eas-cli` | native dev/production builds |
| *(optional)* a **LiveKit Cloud** project | voice/video calls (WAGGLES_CALLS) |

Native features (WebRTC calls, push) need a **dev build** — they do **not** run in
Expo Go. Text messaging runs in Expo Go.

---

## 2. Clone + install

```sh
git clone <your-fork-url> waggles && cd waggles
npm install
npx tsc --noEmit    # sanity: should report 0 errors
```

---

## 3. Stand up the backend (your fresh Supabase project)

### 3a. Apply the core schema — E2EE 1:1 text (required)

Against a **fresh** project (`DATABASE_URL` = your project's Postgres connection
string), from `db/waggles-core-v0.1/`:

```sh
psql -v ON_ERROR_STOP=1 -f 001_schema.sql "$DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f 002_rls.sql    "$DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f 003_rpcs.sql   "$DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f probe/probe_1to1_flow.sql "$DATABASE_URL"   # 9 assertions, then rolls back
```

This creates 7 tables (`profiles`, `bee_keys`, `comms_conversations`,
`comms_participants`, `comms_messages`, `comms_blocks`, `comms_conversation_keys`),
the `auth.users → profiles` trigger, RLS on every table, and the `comms_*` RPCs.
See `db/waggles-core-v0.1/README.md` for what each file does and its known
limitations. To undo: `000_rollback.sql` (read its header — it destroys ciphertext).

### 3b. Feature surfaces (optional — apply only what you want)

Each surface below is a migration in `supabase/migrations/` plus a client flag that
**ships `false`**. Apply the migration, run its probe, then flip the flag. Full
step-by-step (apply → probe → flag) for every one is in **`docs/OWNER_APPLY.md`**.

| Surface | Migration | Client flag (file) | Extra |
|---|---|---|---|
| Calls (voice/video) | `…_waggles_calls.sql` | — | LiveKit project + `livekit-token` edge fn (§3c) |
| Groups | `…_waggles_groups.sql` | `GROUPS_ENABLED` (comms.ts) | |
| Reactions | `…_waggles_reactions.sql` | `REACTIONS_ENABLED` | |
| Pins | `…_waggles_pins.sql` | `PINS_ENABLED` | |
| Mute | `…_waggles_mute.sql` | `MUTE_ENABLED` | |
| Disappearing | `…_waggles_disappearing.sql` | `DISAPPEARING_ENABLED` | needs `pg_cron` (see OWNER_APPLY) |
| Reporting | `…_waggles_reporting.sql` | `REPORTING_ENABLED` | |
| Presence | `…_waggles_presence.sql` | `PRESENCE_ENABLED` | |
| Media (voice notes + photos) | `…_waggles_media.sql` | `MEDIA_ENABLED` (media.ts) | creates a private storage bucket |
| Push notifications | `…_waggles_push.sql` | `PUSH_ENABLED` (push.ts) | `push-notify` edge fn (§3c) |

### 3c. Edge functions (only for calls and/or push)

Deploy with the Supabase CLI against your project:

```sh
supabase functions deploy livekit-token   # calls — set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
supabase functions deploy push-notify      # push  — needs no third-party key (Expo push tokens)
```

Both read only your project's own `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`. Nothing points at any other backend.

---

## 4. Point the app at your backend

Copy `.env.example` to `.env` (or `.env.local`) and set the two public values:

```sh
EXPO_PUBLIC_WAGGLES_HOST_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your project's anon key>
```

These are **prefills for the in-app setup screen, not a hardcoded default** — the app
still asks the operator to confirm the host on first run, and never connects to a
host the user didn't enter. Leaving them blank is fine; the setup screen just starts
empty.

---

## 5. Run it

```sh
npx expo start                 # dev server; text messaging works in Expo Go
# For calls / push / any native module, build a dev client instead:
eas build --profile development --platform android   # or ios
```

On first launch the app asks for your host URL + anon key (prefilled from step 4),
then signs in via Supabase Auth and publishes your device's E2EE identity key.

---

## 6. The "stranger can run it" proof — result + gaps

This section records the WAGGLES_SELFHOST_DOCS1 proof: what was verified on a clean
checkout, and every gap a stranger still hits. **Honesty note:** a *fully live* run
against a brand-new Supabase + LiveKit project is **owner-infra-gated** (a build
agent cannot create third-party accounts), so the parts that need live infra are
listed as gaps, not claimed as passing.

**Verified statically on a clean checkout (2026-09-29):**
- `npm install` succeeds; `npx tsc --noEmit` → **0 errors**.
- `npx expo config` resolves (app.json + all config plugins, incl.
  `@config-plugins/react-native-webrtc`) → **exit 0**.
- No executable code references any constellation/default backend — the only
  matches for the old default host are non-executable comments in `config.ts`
  explaining its removal. The app genuinely has no default host.
- All setup artifacts present: `LICENSE` (AGPLv3), `.env.example`, `eas.json`, the
  full `db/waggles-core-v0.1/` bundle + probe, both edge functions, and
  `docs/OWNER_APPLY.md` covering all 10 feature surfaces.

**Gaps a stranger still hits (record, per the dispatch):**
1. **Live fresh-infra run not performed** — needs a real new Supabase project +
   (for calls) a LiveKit project + (for push) an EAS `projectId`. Owner-gated;
   the SQL/probe path is written and self-contained but was not executed here.
2. **`expo-notifications` is not in `app.json` `plugins`.** Basic push works, but a
   production build wants the plugin (custom icon/sound, iOS APNs) + an EAS
   `projectId`. Adding it is a build-config decision left to the operator (see
   OWNER_APPLY → WAGGLES_PUSH step 4).
3. **iOS push on a self-hosted build needs your own APNs key** in the Expo
   dashboard — standard Expo push setup, not Waggles-specific.
4. **Disappearing messages need `pg_cron` enabled** in the Supabase dashboard
   before its migration (OWNER_APPLY notes this).
5. **Feature flags ship `false`.** A stranger who wants groups/reactions/etc. must
   apply the migration *and* flip the flag (this doc's §3b table + OWNER_APPLY).

---

## 7. Known limitations (inherited)

- `bee_keys` is world-readable including the *ciphertext* secret-key column (public
  keys must be public; the secret column is encrypted under the account passphrase).
  See `db/waggles-core-v0.1/README.md`.
- No server-side rate limiting (Supabase defaults apply).
- No key rotation on member-leave yet (`key_epoch` exists but isn't advanced).
- **Standing obligation:** the crypto (`e2ee.ts`) and `comms_*` schema are ports of
  the HONEYCOMB constellation. A security fix in either tree must be applied to both.
