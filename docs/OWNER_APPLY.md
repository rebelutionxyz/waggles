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
