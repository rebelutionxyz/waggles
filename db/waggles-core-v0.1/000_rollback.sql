-- ============================================================================
-- WAGGLES CORE v0.1 — ROLLBACK
--
-- WAGGLES_F1 (2026-09-15). THIS FILE WAS WRITTEN FIRST, before any of the
-- forward migrations, per the MIGRATION AMENDMENT standing rule. It is listed
-- first in this bundle for the same reason: a bundle whose rollback is written
-- afterwards is a bundle whose rollback has never been thought about.
--
-- WHAT THIS UNDOES: everything 001/002/003 create, in reverse dependency order.
-- It is safe to run against a project where the bundle was only partially
-- applied — every drop is IF EXISTS.
--
-- WHAT THIS DOES NOT TOUCH: `auth.users`. The bundle never creates auth users;
-- it only hangs a `profiles` row off them and installs a trigger. Dropping the
-- trigger leaves existing auth accounts intact and signable-in — they will
-- simply have no profile row until the bundle is re-applied.
--
-- DESTRUCTIVE: dropping `comms_messages` destroys message ciphertext, and
-- dropping `comms_conversation_keys` destroys the wrapped conversation keys.
-- Neither is recoverable from anywhere else — by design, since the server
-- never holds a plaintext copy. Back up before running this on an instance
-- anyone has actually used.
-- ============================================================================

-- ── 003: functions ──────────────────────────────────────────────────────────
drop function if exists public.comms_unblock(uuid);
drop function if exists public.comms_block(uuid);
drop function if exists public.comms_leave(uuid);
drop function if exists public.comms_mark_read(uuid);
drop function if exists public.comms_delete_message(uuid);
drop function if exists public.comms_edit_message(uuid, text);
drop function if exists public.comms_send(uuid, text, text, boolean, uuid);
drop function if exists public.comms_start_direct(uuid);
drop function if exists public.comms_put_conversation_keys(uuid, integer, jsonb);
drop function if exists public.bee_register_key(text, text, text);
drop function if exists public.comms_is_blocked(uuid, uuid);
drop function if exists public.is_comms_participant(uuid, uuid);

-- ── 002: the auth.users hook ────────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_profile();

-- ── 001: tables (reverse dependency order) ──────────────────────────────────
drop table if exists public.comms_conversation_keys;
drop table if exists public.comms_blocks;
drop table if exists public.comms_messages;
drop table if exists public.comms_participants;
drop table if exists public.comms_conversations;
drop table if exists public.bee_keys;
drop table if exists public.profiles;
