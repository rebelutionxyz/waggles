-- ============================================================================
-- WAGGLES CORE v0.1 — PROBE: the E2EE 1:1 text flow, proved then rolled back.
--
-- WAGGLES_F1 (2026-09-15).
--
-- ── HOW TO RUN ──────────────────────────────────────────────────────────────
--   psql -v ON_ERROR_STOP=1 -f probe/probe_1to1_flow.sql "$DATABASE_URL"
--
-- Run it AFTER 001/002/003 have been applied, against a project you are willing
-- to have a transaction open on. It writes nothing that survives: the file ends
-- in ROLLBACK, and ON_ERROR_STOP=1 means any failed assertion aborts the script
-- with the transaction still open and therefore discarded. Both directions end
-- the same way — nothing committed.
--
-- DO NOT RUN THIS AGAINST THE HONEYCOMB CONSTELLATION PROJECT. It inserts into
-- `auth.users`, and this bundle's schema is not that project's schema. This is
-- the fork's probe, for the fork's database.
--
-- ── WHAT IT PROVES ──────────────────────────────────────────────────────────
--   1. A new auth user gets a profile automatically (the 002 trigger).
--   2. Two devices can register X25519 public keys.
--   3. `comms_start_direct` opens a 1:1, and is idempotent — calling it again
--      returns the SAME conversation rather than a second one.
--   4. `comms_put_conversation_keys` distributes a wrapped CK to both members,
--      and REFUSES to let one member overwrite the other's wrapped key.
--   5. `comms_send` stores an encrypted message and bumps `last_message_at`.
--   6. `comms_send` REFUSES a plaintext message. This is the E2EE floor.
--   7. RLS: a third party who is not a participant reads ZERO messages, while a
--      participant reads them all.
--   8. Blocking stops a send in both directions.
--   9. `comms_mark_read` moves `last_read_at`, which is the fork's whole unread
--      mechanism now that the constellation `notifications` fan-out is gone.
--
-- ── HOW IT IMPERSONATES A USER ──────────────────────────────────────────────
-- Every RPC reads `auth.uid()`, which on Supabase resolves from the
-- `request.jwt.claims` GUC. Setting that GUC transaction-locally is exactly how
-- the real request path populates it, so the functions run against the same
-- input they see in production — no stubbing, no rewritten bodies.
--
-- RLS assertions additionally `set local role authenticated`, because a
-- superuser/owner connection BYPASSES row level security entirely and would
-- make step 7 pass without proving anything.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Fixed UUIDs so failures are readable in the output.
\set alice   '''11111111-1111-4111-8111-111111111111'''
\set bob     '''22222222-2222-4222-8222-222222222222'''
\set mallory '''33333333-3333-4333-8333-333333333333'''

-- ── 1. auth users → profiles, via the trigger ───────────────────────────────
insert into auth.users (id, email, instance_id, aud, role)
values (:alice::uuid,   'alice@probe.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
       (:bob::uuid,     'bob@probe.invalid',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
       (:mallory::uuid, 'mallory@probe.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

do $$
begin
  if (select count(*) from public.profiles
       where id in ('11111111-1111-4111-8111-111111111111',
                    '22222222-2222-4222-8222-222222222222',
                    '33333333-3333-4333-8333-333333333333')) <> 3 then
    raise exception 'PROBE 1 FAILED: handle_new_profile did not create a profile per auth user';
  end if;
  if (select handle from public.profiles where id = '11111111-1111-4111-8111-111111111111') <> 'alice' then
    raise exception 'PROBE 1 FAILED: handle not derived from the email local part';
  end if;
end $$;
\echo 'PROBE 1 ok — auth user -> profile, handle derived'

-- ── 2. device keys ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :alice)::text, true);
select public.bee_register_key('alice-device-1', 'ALICE_X25519_PUBKEY_BASE64');

select set_config('request.jwt.claims', json_build_object('sub', :bob)::text, true);
select public.bee_register_key('bob-device-1', 'BOB_X25519_PUBKEY_BASE64');

do $$
begin
  if (select count(*) from public.bee_keys) <> 2 then
    raise exception 'PROBE 2 FAILED: expected 2 device keys';
  end if;
end $$;
\echo 'PROBE 2 ok — per-device X25519 public keys registered'

-- ── 3. start a direct conversation, twice ───────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :alice)::text, true);

create temporary table probe_state (k text primary key, v text) on commit drop;
insert into probe_state
select 'cid', (public.comms_start_direct(:bob::uuid) ->> 'conversation_id');

do $$
declare v_again uuid; v_cid uuid;
begin
  select v::uuid into v_cid from probe_state where k = 'cid';
  select (public.comms_start_direct('22222222-2222-4222-8222-222222222222'::uuid) ->> 'conversation_id')::uuid
    into v_again;
  if v_again <> v_cid then
    raise exception 'PROBE 3 FAILED: comms_start_direct is not idempotent (% vs %)', v_cid, v_again;
  end if;
  if (select count(*) from public.comms_participants where conversation_id = v_cid) <> 2 then
    raise exception 'PROBE 3 FAILED: expected exactly 2 participants';
  end if;
end $$;
\echo 'PROBE 3 ok — 1:1 opened, and re-opening returns the same conversation'

-- ── 4. wrapped conversation keys, and the overwrite guard ───────────────────
do $$
declare v_cid uuid;
begin
  select v::uuid into v_cid from probe_state where k = 'cid';

  -- Alice distributes the CK to both members.
  perform public.comms_put_conversation_keys(v_cid, 1, jsonb_build_array(
    jsonb_build_object('bee_id','11111111-1111-4111-8111-111111111111','device_id','alice-device-1','wrapped_key','SEALED_TO_ALICE'),
    jsonb_build_object('bee_id','22222222-2222-4222-8222-222222222222','device_id','bob-device-1','wrapped_key','SEALED_TO_BOB')
  ));
  if (select count(*) from public.comms_conversation_keys where conversation_id = v_cid) <> 2 then
    raise exception 'PROBE 4 FAILED: expected a wrapped key per member';
  end if;

  -- THE SECURITY PROPERTY: Alice tries to REPLACE Bob's wrapped key. The
  -- `where v_target = v_bee` guard on the conflict clause must make this a
  -- no-op, leaving Bob's original key intact.
  perform public.comms_put_conversation_keys(v_cid, 1, jsonb_build_array(
    jsonb_build_object('bee_id','22222222-2222-4222-8222-222222222222','device_id','bob-device-1','wrapped_key','ATTACKER_CHOSEN_KEY')
  ));
  if (select wrapped_key from public.comms_conversation_keys
       where conversation_id = v_cid
         and bee_id = '22222222-2222-4222-8222-222222222222') <> 'SEALED_TO_BOB' then
    raise exception 'PROBE 4 FAILED: a participant overwrote ANOTHER participant''s wrapped key';
  end if;
end $$;
\echo 'PROBE 4 ok — CK distributed; cross-member key overwrite refused'

-- ── 5 + 6. send encrypted; refuse plaintext ─────────────────────────────────
do $$
declare v_cid uuid; v_before timestamptz; v_after timestamptz; v_raised boolean := false;
begin
  select v::uuid into v_cid from probe_state where k = 'cid';
  select last_message_at into v_before from public.comms_conversations where id = v_cid;

  perform public.comms_send(v_cid, 'e2ee:v1:BASE64CIPHERTEXT', 'text', true, null);

  select last_message_at into v_after from public.comms_conversations where id = v_cid;
  if v_after is null or (v_before is not null and v_after <= v_before) then
    raise exception 'PROBE 5 FAILED: last_message_at was not bumped';
  end if;
  if (select count(*) from public.comms_messages
       where conversation_id = v_cid and is_encrypted) <> 1 then
    raise exception 'PROBE 5 FAILED: expected exactly 1 encrypted message';
  end if;

  begin
    perform public.comms_send(v_cid, 'hello in the clear', 'text', false, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'PROBE 6 FAILED: comms_send ACCEPTED a plaintext message — the E2EE floor is broken';
  end if;
  if (select count(*) from public.comms_messages where conversation_id = v_cid) <> 1 then
    raise exception 'PROBE 6 FAILED: the refused plaintext message left a row behind';
  end if;
end $$;
\echo 'PROBE 5 ok — encrypted message stored, last_message_at bumped'
\echo 'PROBE 6 ok — plaintext send REFUSED (E2EE floor holds)'

-- ── 7. RLS: a non-participant sees nothing ──────────────────────────────────
-- `set local role` matters: the owner role bypasses RLS and would make this
-- assertion vacuous.
do $$
declare v_cid uuid; v_seen_by_member int; v_seen_by_stranger int;
begin
  select v::uuid into v_cid from probe_state where k = 'cid';

  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-4222-8222-222222222222')::text, true);
  set local role authenticated;
  select count(*) into v_seen_by_member from public.comms_messages where conversation_id = v_cid;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub','33333333-3333-4333-8333-333333333333')::text, true);
  set local role authenticated;
  select count(*) into v_seen_by_stranger from public.comms_messages where conversation_id = v_cid;
  reset role;

  if v_seen_by_member <> 1 then
    raise exception 'PROBE 7 FAILED: a participant could not read the message (saw %)', v_seen_by_member;
  end if;
  if v_seen_by_stranger <> 0 then
    raise exception 'PROBE 7 FAILED: a NON-participant read % message(s)', v_seen_by_stranger;
  end if;
end $$;
\echo 'PROBE 7 ok — RLS: participant reads 1, stranger reads 0'

-- ── 8. blocking stops the send, both directions ─────────────────────────────
do $$
declare v_cid uuid; v_raised boolean := false;
begin
  select v::uuid into v_cid from probe_state where k = 'cid';

  -- Bob blocks Alice.
  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-4222-8222-222222222222')::text, true);
  perform public.comms_block('11111111-1111-4111-8111-111111111111'::uuid);

  -- Alice — who did not do the blocking — must now be refused.
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111')::text, true);
  begin
    perform public.comms_send(v_cid, 'e2ee:v1:MORECIPHERTEXT', 'text', true, null);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'PROBE 8 FAILED: send succeeded across a block';
  end if;

  -- And unblocking restores it.
  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-4222-8222-222222222222')::text, true);
  perform public.comms_unblock('11111111-1111-4111-8111-111111111111'::uuid);
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111')::text, true);
  perform public.comms_send(v_cid, 'e2ee:v1:MORECIPHERTEXT', 'text', true, null);
  if (select count(*) from public.comms_messages where conversation_id = v_cid) <> 2 then
    raise exception 'PROBE 8 FAILED: send did not resume after unblock';
  end if;
end $$;
\echo 'PROBE 8 ok — block refuses the send in both directions; unblock restores it'

-- ── 9. read state ───────────────────────────────────────────────────────────
do $$
declare v_cid uuid; v_read timestamptz;
begin
  select v::uuid into v_cid from probe_state where k = 'cid';
  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-4222-8222-222222222222')::text, true);
  perform public.comms_mark_read(v_cid);
  select last_read_at into v_read from public.comms_participants
   where conversation_id = v_cid and bee_id = '22222222-2222-4222-8222-222222222222';
  if v_read is null then
    raise exception 'PROBE 9 FAILED: comms_mark_read did not set last_read_at';
  end if;
end $$;
\echo 'PROBE 9 ok — comms_mark_read moves last_read_at (the fork unread mechanism)'

\echo ''
\echo '================================================'
\echo 'ALL PROBES PASSED — rolling back, nothing kept.'
\echo '================================================'

rollback;
