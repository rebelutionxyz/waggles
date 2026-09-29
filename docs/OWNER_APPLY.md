# Waggles fork — OWNER APPLY: the calls surface (WAGGLES_FORK_DB1)

Adds the E2EE call rooms + sealed-key surface to the fork Supabase project
**`fzmuobbboknhvpkqetxn`**. Prerequisite: the messaging v0.1 schema is already applied
(WAGGLES_F4). This migration is **calls-only** and preflights that the messaging
prerequisites exist before touching anything.

Nothing here contains secrets. Nothing here has been applied by any agent — these are the
steps for **you** to run.

## 1. Apply the migration (paste into the SQL editor — transactional)
1. Open the Supabase dashboard → project `fzmuobbboknhvpkqetxn` → **SQL Editor**.
2. Open this file and copy its ENTIRE contents:
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260928230000_waggles_calls.sql`
3. Paste into a new SQL editor query and **Run**.
   - It is wrapped in one `BEGIN … COMMIT`. If the PREFLIGHT (or any statement) fails, the whole
     thing rolls back and nothing is applied — read the raised message, fix the missing prereq,
     and re-run. Re-running after success is safe (`IF NOT EXISTS` / `CREATE OR REPLACE`).

## 2. Probe it (paste — read-only)
1. Open: `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\calls_probe.sql`
2. Paste into the SQL editor and **Run**.
3. Success = the NOTICES end with **`WAGGLES_CALLS PROBE: ALL PASS`**. Any `FAIL:` line means stop
   and report it — the calls surface is not correctly locked.

## 3. Deploy the LiveKit token edge function (PowerShell)
```powershell
cd C:\Users\Butch\Documents\HONEYCOMB\waggles
supabase login
supabase link --project-ref fzmuobbboknhvpkqetxn
supabase functions deploy livekit-token
```
- If `supabase link` complains there is no local config, run `supabase init` first (accept the
  defaults), then re-run `link` + `deploy`.
- Set the function's secrets in the dashboard (Project → Edge Functions → livekit-token → Secrets),
  NOT in any file: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## 4. Live check (two accounts — your runtime test)
With two signed-in Waggles users, start a call from a 1:1 thread on device A, join on device B,
and confirm audio/video connect and stay E2EE (device B refuses to join until A seals it a key).
That two-account media test is the part a single SQL session cannot prove; §2's probe proves the
schema/lock structure.

## What this added (see the migration header for the exact constellation diff)
Tables `comms_rooms`, `comms_room_participants`, `comms_call_keys`; helpers `is_room_participant`,
`room_is_public`; RPCs `comms_room_create` / `comms_room_join` / `comms_room_leave` /
`comms_put_call_keys`; read-only RLS (writes only via the SECURITY DEFINER RPCs); anon revoked,
`authenticated` granted only what `src/lib/calls.ts` calls.

---

# Waggles fork — OWNER APPLY: groups (WAGGLES_GROUPS1)

Adds group conversations to the fork Supabase project **`fzmuobbboknhvpkqetxn`**. Prerequisite:
messaging v0.1 is applied (WAGGLES_F4). Groups add **NO tables/columns** — the core schema already
has `comms_conversations.kind`/`title`/`created_by`/`members_can_add` and `comms_participants.role`.
This migration adds only the four group RPCs (forked from the constellation) + their grants.

Nothing here contains secrets. Nothing here has been applied by any agent.

## 1. Apply the migration (paste into the SQL editor — transactional)
1. Supabase dashboard → project `fzmuobbboknhvpkqetxn` → **SQL Editor**.
2. Copy the ENTIRE contents of:
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260928233000_waggles_groups.sql`
3. Paste into a new query and **Run**. One `BEGIN … COMMIT`; a failed PREFLIGHT rolls back with a
   message naming the missing prereq. Re-running after success is safe (`CREATE OR REPLACE`).

## 2. Probe it (paste — read-only)
1. Open: `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\groups_probe.sql`
2. Paste and **Run**. Success = the NOTICES end with **`WAGGLES_GROUPS PROBE: ALL PASS`**. Any
   `FAIL:` line = stop and report it.

## 3. Enabling it — tell LEAD it applied cleanly
Don't edit the flag yourself. Once this migration + its probe pass, **tell LEAD it applied cleanly**;
a terminal flips `GROUPS_ENABLED` in the repo and commits it. (Done for the whole v1 feature set in
WAGGLES_FLIP_GROUPS1 — `GROUPS_ENABLED` is now `true`.) Groups do not appear until both the migration
is applied AND the flag is on. No edge function, no secrets.

## What this added
RPCs `comms_create_group` / `comms_group_add` / `comms_group_remove` / `comms_group_set_add_policy`
(SECURITY DEFINER; owner/member roles + `members_can_add` policy; the only fork edit is
`bees`→`profiles`). No new tables — RLS is inherited from messaging v0.1; anon revoked,
`authenticated` granted only what `src/lib/comms.ts` calls.

---

# Waggles fork — OWNER APPLY: reactions (WAGGLES_REACTIONS1)

Adds message reactions to the fork project **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging
v0.1 (WAGGLES_F4). Unlike groups, this CREATES a table (`comms_reactions`) — the core deferred it.

## 1. Apply the migration (paste — transactional)
1. Supabase dashboard → project `fzmuobbboknhvpkqetxn` → **SQL Editor**.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260928234000_waggles_reactions.sql`
3. Paste into a new query and **Run** (one `BEGIN … COMMIT`; PREFLIGHT rolls back on a missing prereq).

## 2. Probe it (paste — read-only)
1. Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\reactions_probe.sql`, paste, **Run**.
2. Success = NOTICES end with **`WAGGLES_REACTIONS PROBE: ALL PASS`**.

## 3. Enabling it — tell LEAD it applied cleanly
Don't edit the flag yourself. Once this migration + probe pass, **tell LEAD it applied cleanly**; a
terminal flips `REACTIONS_ENABLED` (done in WAGGLES_FLIP_GROUPS1 — now `true`). Turning it on also
switches on the `comms_reactions` embed in the message query (kept off while the table was absent).
No edge function, no secrets.

## What this added
Table `comms_reactions` (PK `(message_id, bee_id, emoji)`; `bee_id`→`profiles`, `message_id`→
`comms_messages`); participant-scoped read RLS; RPC `comms_react` (SECURITY DEFINER, verbatim — no
fork edit); anon revoked, `authenticated` granted SELECT + `comms_react` EXECUTE.

---

# Waggles fork — OWNER APPLY: pins (WAGGLES_PINS1)

Adds pinned messages to the fork project **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging v0.1.
Creates `comms_pins` + `comms_pin`/`comms_unpin` (the core deferred them).

## 1. Apply the migration (paste — transactional)
1. Supabase dashboard → project `fzmuobbboknhvpkqetxn` → **SQL Editor**.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260928235000_waggles_pins.sql`
3. Paste into a new query and **Run** (one `BEGIN … COMMIT`; PREFLIGHT rolls back on a missing prereq).

## 2. Probe it (paste — read-only)
1. Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\pins_probe.sql`, paste, **Run**.
2. Success = NOTICES end with **`WAGGLES_PINS PROBE: ALL PASS`**.

## 3. Enabling it — tell LEAD it applied cleanly
Don't edit the flag yourself. Once this migration + probe pass, **tell LEAD it applied cleanly**; a
terminal flips `PINS_ENABLED` (done in WAGGLES_FLIP_GROUPS1 — now `true`). It lights up the
long-press Pin/Unpin action and the 📌 marker in the thread. No edge function, no secrets.

## What this added
Table `comms_pins` (PK `(conversation_id, message_id)`; `pinned_by`→`profiles`); participant-scoped
read RLS; RPCs `comms_pin` / `comms_unpin` (SECURITY DEFINER, verbatim; 50-pin/conversation cap);
anon revoked, `authenticated` granted SELECT + both RPCs' EXECUTE.

---

# Waggles fork — OWNER APPLY: mute (WAGGLES_MUTE1)

Adds per-participant conversation mute to **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging v0.1.
Adds NO tables/columns — the core already has `comms_participants.muted`; this is the one RPC
`comms_set_mute`.

## 1. Apply the migration (paste — transactional)
1. SQL Editor of project `fzmuobbboknhvpkqetxn`.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260928235500_waggles_mute.sql`
3. Paste and **Run** (one `BEGIN … COMMIT`; PREFLIGHT rolls back on a missing prereq).

## 2. Probe it (paste — read-only)
Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\mute_probe.sql`, paste, **Run** →
**`WAGGLES_MUTE PROBE: ALL PASS`**.

## 3. Enabling it — tell LEAD it applied cleanly
Don't edit the flag yourself. Once this migration + probe pass, **tell LEAD it applied cleanly**; a
terminal flips `MUTE_ENABLED` (done in WAGGLES_FLIP_GROUPS1 — now `true`). It lights up the mute
toggle in a conversation's Settings. No edge function, no secrets.

## What this added
RPC `comms_set_mute` (SECURITY DEFINER, verbatim — no fork edit; updates the caller's own
`comms_participants.muted`); anon revoked, `authenticated` granted EXECUTE. No tables/columns.

---

# Waggles fork — OWNER APPLY: disappearing messages (WAGGLES_DISAPPEAR1)

Adds disappearing messages to **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging v0.1. The core
already stamps `expires_at` on send; this adds the timer RPC, the sweep, and a cron.

## 0. Enable pg_cron FIRST (dashboard)
Database → Extensions → enable **`pg_cron`**. Without it the migration still applies but expired
messages are never swept server-side (the client still hides them locally).

## 1. Apply the migration (paste — transactional)
1. SQL Editor of `fzmuobbboknhvpkqetxn`.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260929000000_waggles_disappearing.sql`
3. Paste and **Run**. If pg_cron is on, it schedules `comms-disappear-sweep` (*/5); if not, it
   NOTICEs a reminder — enable pg_cron then run the one-line `cron.schedule(...)` the NOTICE prints.

## 2. Probe it (paste — read-only)
Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\disappearing_probe.sql`, paste,
**Run** → **`WAGGLES_DISAPPEAR PROBE: ALL PASS`** (a `pg_cron NOT enabled` WARNING means finish step 0).

## 3. Enabling it — tell LEAD it applied cleanly
Don't edit the flag yourself. Once this migration + probe pass (and `pg_cron` is on, step 0),
**tell LEAD it applied cleanly**; a terminal flips `DISAPPEARING_ENABLED` (done in
WAGGLES_FLIP_GROUPS1 — now `true`). It lights up the timer picker in a conversation's Settings.
No edge function, no secrets.

## What this added
RPCs `comms_set_disappearing` (user-callable) + `comms_sweep_expired` (cron-only; deletes
`expires_at < now`), both SECURITY DEFINER and verbatim; a `*/5` pg_cron job `comms-disappear-sweep`.
No tables/columns (the core already has `disappear_seconds` + `expires_at`).

---

# Waggles fork — OWNER APPLY: reporting (WAGGLES_REPORT1)

Adds user reporting to **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging v0.1. Creates `comms_reports`.

## 1. Apply the migration (paste — transactional)
1. SQL Editor of `fzmuobbboknhvpkqetxn`.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260929000500_waggles_reporting.sql`
3. Paste and **Run** (one `BEGIN … COMMIT`).

## 2. Probe it (paste — read-only)
Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\reporting_probe.sql`, paste, **Run**
→ **`WAGGLES_REPORT PROBE: ALL PASS`**.

## 3. Enabling it — tell LEAD it applied cleanly
Don't edit the flag yourself. Once this migration + probe pass, **tell LEAD it applied cleanly**; a
terminal flips `REPORTING_ENABLED` (done in WAGGLES_FLIP_GROUPS1 — now `true`). It lights up the
"Report" action in a conversation's Settings.

## Reading reports (operator)
The fork has NO client read policy (no admin role). Read `public.comms_reports` from the Supabase
dashboard / SQL editor (service role bypasses RLS) — e.g. `select * from public.comms_reports order
by created_at desc;`.

## What this added
Table `comms_reports` (reporter/reported → `profiles`, optional conversation, reason 1..2000);
RLS insert-own + NO client read (operator reads out of band); RPC `comms_report` (SECURITY DEFINER,
verbatim); anon no access, `authenticated` granted only `comms_report` EXECUTE.

---

# Waggles fork — OWNER APPLY: presence (WAGGLES_PRESENCE1)

Adds online-status presence to **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging v0.1. Creates
`bee_presence` + `bee_presence_ping`.

## 1. Apply the migration (paste — transactional)
1. SQL Editor of `fzmuobbboknhvpkqetxn`.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260929001000_waggles_presence.sql`
3. Paste and **Run**.

## 2. Probe it (paste — read-only)
Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\presence_probe.sql`, paste, **Run**
→ **`WAGGLES_PRESENCE PROBE: ALL PASS`**.

## 3. Enabling it — tell LEAD it applied cleanly
Don't edit the flag yourself. Once this migration + probe pass, **tell LEAD it applied cleanly**; a
terminal flips `PRESENCE_ENABLED` (done in WAGGLES_FLIP_GROUPS1 — now `true`). The client already
pings on the Chats screen (fire-and-forget). No edge function, no secrets.

## Note — display is not wired (matches the source)
`bee_presence` is WRITE-ONLY via the ping (RLS on, no policies) exactly like the constellation, so
turning the flag on records last-seen but does NOT yet SHOW anyone's status — surfacing presence
needs a read policy or read RPC that the constellation doesn't define (a source-side gap). A future
WAGGLES_PRESENCE_SHOW1 would add a `show_presence`-respecting read path + the online dot.

## What this added
Table `bee_presence` (PK `bee_id`→`profiles`, `last_seen_at`, `show_presence`); RLS on, no policies;
RPC `bee_presence_ping` (SECURITY DEFINER, verbatim); anon no access, `authenticated` granted only
`bee_presence_ping` EXECUTE.

---

# Waggles fork — OWNER APPLY: media (voice notes + photos) (WAGGLES_MEDIA1)

Adds **E2EE voice notes + photos** to **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging v0.1. This
is STORAGE config, not app-schema: it creates a **private** storage bucket `waggles-media` + RLS on
`storage.objects`. No `comms_*` table/RPC changes — the (encrypted) media pointer rides in the
existing `comms_messages.body` with `content_type='media'` (already supported by `comms_send`).

**How the encryption works:** the client seals the file bytes under the conversation content key
(`e2ee.encryptBytes`, the same XChaCha20-Poly1305 AEAD as text) BEFORE upload, so the bucket only
ever holds ciphertext. Recipients sign a URL, fetch, and decrypt locally. The bucket being private
means anon can't even fetch the ciphertext.

## 1. Apply the migration (paste — transactional)
1. SQL Editor of `fzmuobbboknhvpkqetxn`.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260929002000_waggles_media.sql`
3. Paste and **Run**. (Creating a bucket + `storage.objects` policies needs an owner/admin role —
   this is why it can't be done from the client.)

## 2. Probe it (paste — read-only)
Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\media_probe.sql`, paste, **Run**
→ **`WAGGLES_MEDIA PROBE: ALL PASS`**.

## 3. Device smoke test FIRST, then tell LEAD to enable it
Recording + playback can only be verified on a real device build (tsc can't). `npx expo install`
already added `expo-av`, `expo-file-system`, `expo-image-picker`; do a dev build, record a voice note
+ send a photo between two accounts, confirm the other side decrypts and plays/shows. THEN **tell LEAD
the bucket applied + the device test passed** — a terminal flips `MEDIA_ENABLED` in `src/lib/media.ts`
(ships **false**), don't edit it yourself. That lights up the 🎙️ + 📎 buttons and the media bubbles.

## What this added
Private bucket `waggles-media`; four `storage.objects` policies scoped to it — INSERT
(`authenticated`, only under `media/<own uid>/*`), SELECT (`authenticated`, any object — the bytes
are ciphertext), UPDATE/DELETE (owner-only). Client: `src/lib/media.ts` (seal→upload,
sign→fetch→decrypt→local-URI), `e2ee.encryptBytes`/`decryptBytes`, gated composer + `MediaBubble` in
`app/c/[id].tsx`.

---

# Waggles fork — OWNER APPLY: push notifications (WAGGLES_PUSH1)

Adds **content-blind** push notifications to **`fzmuobbboknhvpkqetxn`**. Prerequisite: messaging v0.1.
Native (Expo push), not Web Push. The push payload is a GENERIC "New message" — **no sender, no
content, no preview** (comms_send enforces server-side encryption, so the backend has no plaintext to
leak). The tap deep-links to the thread; plaintext is decrypted on-device only.

Two moving parts: a DB migration (token storage + subscribe RPCs) and an edge function (the sender).
Both are owner/LEAD-gated; a self-hoster who doesn't want push simply skips the function and leaves
the client flag false.

## 1. Apply the migration (paste — transactional)
1. SQL Editor of `fzmuobbboknhvpkqetxn`.
2. Copy the ENTIRE contents of
   `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\migrations\20260929003000_waggles_push.sql`
3. Paste and **Run**.

## 2. Probe it (paste — read-only)
Open `C:\Users\Butch\Documents\HONEYCOMB\waggles\supabase\probe\push_probe.sql`, paste, **Run**
→ **`WAGGLES_PUSH PROBE: ALL PASS`**.

## 3. Deploy the edge function (LEAD)
`supabase/functions/push-notify/index.ts` ships to the FORK project. It needs only the project's own
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` env (no third-party credential —
Expo push tokens need no server key). It is client-invoked fire-and-forget after each send;
content-blind by construction.

## 4. Device smoke test FIRST, then turn push on (one-line client flag)
Push registration + delivery only work on a real device with an EAS `projectId` in app config (the
Expo push service issues no simulator tokens). `npx expo install` already added `expo-notifications`
+ `expo-device`. For a production build, add the `expo-notifications` config plugin + (iOS) APNs / a
`projectId` to `app.json` — a build-config step, left to the owner, not edited here. After a two-account
device test confirms a generic "New message" arrives and the tap opens the thread, **tell LEAD the
migration applied + the edge fn deployed + the device test passed** — a terminal flips `PUSH_ENABLED`
in `src/lib/push.ts` (ships **false**), don't edit it yourself. That lights up device registration on
sign-in, the fire-and-forget invoke after each send, and the tap→thread deep link.

## Note — mute is not yet respected
The edge function notifies every other participant; it does NOT filter `comms_participants.muted`
(the WAGGLES_MUTE surface is a separate, independently-gated pass). Wiring the mute filter is a
follow-up for whenever mute is applied — flagged, not silently skipped.

## What this added
Table `bee_push_tokens` (PK `token`, `bee_id`→`profiles`, `platform`, `updated_at`); RLS on with an
own-row SELECT policy, no anon access; RPCs `comms_push_subscribe(text,text)` /
`comms_push_unsubscribe(text)` (SECURITY DEFINER, anon revoked + authenticated granted). Client:
`src/lib/push.ts` (register / notify / tap-subscribe, all gated on `PUSH_ENABLED`), a fire-and-forget
`notifyNewMessage` in `comms.sendEncrypted`, registration on sign-in (`auth.tsx`), tap→thread in
`app/_layout.tsx`. Edge function `push-notify` (Expo push, content-blind, stale-token cleanup).
