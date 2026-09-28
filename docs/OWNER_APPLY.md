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

## 3. Turn groups on (one-line client flag)
In `src/lib/comms.ts`, set `export const GROUPS_ENABLED = true;` (it ships **false**). Groups do not
appear in the app until this migration is applied AND the flag is flipped. Commit the flip yourself.
No edge function and no secrets for groups.

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

## 3. Turn reactions on (one-line client flag)
In `src/lib/comms.ts` set `export const REACTIONS_ENABLED = true;` (ships **false**). This also
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

## 3. Turn pins on (one-line client flag)
In `src/lib/comms.ts` set `export const PINS_ENABLED = true;` (ships **false**). This lights up the
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

## 3. Turn mute on (one-line client flag)
In `src/lib/comms.ts` set `export const MUTE_ENABLED = true;` (ships **false**). Lights up the mute
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

## 3. Turn disappearing on (one-line client flag)
In `src/lib/comms.ts` set `export const DISAPPEARING_ENABLED = true;` (ships **false**). Lights up
the timer picker in a conversation's Settings. No edge function, no secrets.

## What this added
RPCs `comms_set_disappearing` (user-callable) + `comms_sweep_expired` (cron-only; deletes
`expires_at < now`), both SECURITY DEFINER and verbatim; a `*/5` pg_cron job `comms-disappear-sweep`.
No tables/columns (the core already has `disappear_seconds` + `expires_at`).
