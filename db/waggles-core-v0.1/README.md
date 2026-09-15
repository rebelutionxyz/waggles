# waggles-core v0.1 — the fork's backend, in one bundle

**PROPOSED. NOTHING HERE HAS BEEN APPLIED ANYWHERE.** Authored under dispatch
`WAGGLES_F1` (lane `waggles`, workdir `Waggles.tech`, EFFORT: DEEP), 2026-09-15,
as F1 of `docs/WAGGLES_FORK_PLAN_v0.1.md`.

This is the thing a stranger's fresh Supabase project needs so that
`Waggles.app` has something to talk to. Today `Waggles.app` defaults
`DEFAULT_HOST_URL` at the HONEYCOMB constellation project and ships no schema of
its own — point it anywhere else and it mounts an empty database. That is the
gap F1 closes, and it is why F1 is the gate: nothing downstream of it is real
until a fresh project can be stood up from this repo.

## What a self-hoster runs

```sh
# against a FRESH Supabase project — not one with data in it
psql -v ON_ERROR_STOP=1 -f 001_schema.sql "$DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f 002_rls.sql    "$DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f 003_rpcs.sql   "$DATABASE_URL"

# prove it works, then throw the test data away
psql -v ON_ERROR_STOP=1 -f probe/probe_1to1_flow.sql "$DATABASE_URL"
```

To undo everything: `psql -v ON_ERROR_STOP=1 -f 000_rollback.sql "$DATABASE_URL"`.
Read its header first — it destroys message ciphertext and wrapped keys, and
neither is recoverable from anywhere else, by design.

## The files, in the order they were written

| File | What |
|---|---|
| `000_rollback.sql` | **Written first**, per the MIGRATION AMENDMENT rule. Drops everything the other three create, reverse dependency order, all `IF EXISTS`. |
| `001_schema.sql` | 7 tables + indexes. `profiles`, `bee_keys`, `comms_conversations`, `comms_participants`, `comms_messages`, `comms_blocks`, `comms_conversation_keys`. |
| `002_rls.sql` | The `auth.users` → `profiles` trigger, the `is_comms_participant` predicate, RLS enabled on every table, and the read policies. |
| `003_rpcs.sql` | 10 RPCs + `comms_is_blocked`, and the EXECUTE grants. |
| `probe/probe_1to1_flow.sql` | Nine assertions over the full 1:1 flow, in `BEGIN … ROLLBACK`. |

## Scope: E2EE 1:1 text, and nothing else yet

Extracted from the constellation project by reading `pg_get_functiondef()`,
`pg_get_constraintdef()`, `pg_indexes` and `pg_policy` live on 2026-09-15. Every
function in `003` carries a `FORK CHANGE` note naming exactly what differs from
the constellation original; anything without one is verbatim.

**In:** `comms_start_direct`, `comms_send`, `comms_edit_message`,
`comms_delete_message`, `comms_mark_read`, `comms_leave`, `comms_block`,
`comms_unblock`, `bee_register_key`, `comms_put_conversation_keys`, plus the
`comms_is_blocked` and `is_comms_participant` predicates.

**Out, with the pass that owns each:** groups (F3+), reactions/pins, mentions,
disappearing messages, push (F5), rooms and calls (F6), reporting. `003`'s header
says why for each one.

## Four things worth knowing before you read the SQL

**1. Every write goes through a `SECURITY DEFINER` function.** There is not one
INSERT, UPDATE or DELETE policy on the comms tables — that is copied from the
constellation, not an oversight. A client literally cannot write a message row;
it can only ask `comms_send` to. That is what makes the E2EE floor real: the
first thing `comms_send` does is refuse `is_encrypted = false`, and there is no
path around it.

**2. The only rename is `bees` → `profiles`.** Columns stay `bee_id`, the
`bee_keys` table keeps its name, and every RPC keeps its exact constellation
name. `Waggles.app` already calls those names; renaming them would fork the
client as well as the backend, for cosmetics.

**3. `profiles` deliberately carries no email.** The constellation's `bees` has
a NOT NULL `email` behind a `USING (true)` read policy — every signed-in user can
read every other user's email. `auth.users` already holds the email; the fork
does not need a second world-readable copy.

**4. There is no server-side fan-out on send.** The constellation's `comms_send`
ends by writing a row into its platform-wide `notifications` inbox; the fork
strips that table, so the loop is gone. Unread is derived client-side from
`comms_participants.last_read_at` against `comms_conversations.last_message_at`,
both of which `comms_send` still maintains. Actual push is F5.

## Known, and deliberately not fixed here

- **`bee_keys` is world-readable, including `encrypted_secret_key`.** Public keys
  must be public — you have to be able to seal a conversation key to someone you
  have never messaged. The secret-key column is ciphertext under the account
  holder's own passphrase, and the constellation exposes it the same way.
  Narrowing that one column to its owner would be a strict improvement, and it
  is a **change of behaviour rather than an extraction**, so F1 did not make it.
  Worth a pass of its own.
- **No rate limiting.** The constellation does it above the database. A
  self-hosted instance gets whatever Supabase gives it by default.
- **`key_epoch` on messages is never advanced.** The column and the epoch
  dimension on `comms_conversation_keys` exist and are honoured, but nothing in
  this bundle rotates a conversation key. Matters when groups arrive and someone
  leaves; not before.

## Provenance and the standing obligation

Everything here descends from the HONEYCOMB constellation comms core. A
**security fix in either tree has to be applied to both** — this bundle, and the
constellation's own `comms_*` functions. That is convention, not tooling, and it
is the standing risk the fork accepts by existing (`WAGGLES_FORK_PLAN v0.1`
§1.6 says the same about `e2ee.ts`, which has three copies).
