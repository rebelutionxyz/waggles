-- ============================================================================
-- WAGGLES CORE v0.1 — 003 RPCs
--
-- WAGGLES_F1 (2026-09-15). Every body below was read out of the constellation
-- project with `pg_get_functiondef()` on 2026-09-15 and then edited. Each
-- function carries a FORK note naming exactly what changed from the original
-- and why; anything without a FORK note is the constellation body verbatim.
--
-- ── WHICH RPCs ARE HERE, AND WHICH ARE NOT ──────────────────────────────────
-- WAGGLES_FORK_PLAN v0.1 §1.4 lists 25 RPCs the TALK client calls. This bundle
-- extracts the subset the MVP — E2EE 1:1 TEXT — actually needs:
--
--   comms_start_direct          open (or find) a 1:1
--   comms_send                  send, E2EE enforced
--   comms_edit_message          sender-only edit
--   comms_delete_message        sender-only tombstone
--   comms_mark_read             the whole unread mechanism now
--   comms_leave                 exit, and reap the empty conversation
--   comms_block / comms_unblock the safety floor `comms_send` enforces
--   bee_register_key            per-device X25519 public key
--   comms_put_conversation_keys the wrapped conversation key
--   comms_is_blocked            internal predicate, used by the two above
--   (is_comms_participant lives in 002 — RLS needs it before any policy runs)
--
-- DELIBERATELY EXCLUDED, with the pass that owns each:
--   comms_create_group, comms_group_add, comms_group_remove,
--   comms_group_set_add_policy ....... groups; not MVP (§2.2)
--   comms_react, comms_pin, comms_unpin ... not text core; a later UI pass
--   comms_mention_notify ............. needs groups AND `notifications`, which
--                                      the fork strips outright
--   comms_set_disappearing ........... needs `comms_sweep_expired` + a cron; the
--                                      column and index ship in 001 so adding it
--                                      later is a function, not a table rewrite
--   comms_push_subscribe ............. F5 (own VAPID pair)
--   comms_room_*, comms_call_* ....... F6 (own LiveKit project), and gated on
--                                      the Safari/iPhone E2EE matrix
--   comms_report ..................... moderation is an operator policy, and on
--                                      a self-hosted instance the operator IS
--                                      the user. Shipping a report queue nobody
--                                      reads would be worse than shipping none.
--
-- `comms_mark_read` and `comms_leave` are NOT in the plan's list of 25 — the
-- plan enumerated the TALK web client's `.rpc()` call sites, and TALK does not
-- call either. They are included anyway because without `comms_mark_read` the
-- fork has no unread state at all (see `comms_send` below) and without
-- `comms_leave` a 1:1 has no exit. Both are constellation bodies, unmodified
-- apart from the `bees` → `profiles` rename where it appears.
--
-- ── EXECUTE GRANTS ──────────────────────────────────────────────────────────
-- At the end of this file, revoked from PUBLIC *and* from `anon` BY NAME, then
-- granted to `authenticated`. Naming the role matters: a role-level grant from
-- ALTER DEFAULT PRIVILEGES is not removed by `REVOKE ... FROM PUBLIC`. Verify
-- with `select proacl from pg_proc where proname = '…'` after applying.
-- ============================================================================

-- ── predicates ──────────────────────────────────────────────────────────────

create or replace function public.comms_is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.comms_blocks
     where (blocker_bee_id = a and blocked_bee_id = b)
        or (blocker_bee_id = b and blocked_bee_id = a)
  );
$$;

-- ── E2EE key material ───────────────────────────────────────────────────────

-- Constellation body, verbatim. No fork changes: it already references only
-- `bee_keys`, which the fork keeps under its own name.
create or replace function public.bee_register_key(
  p_device_id  text,
  p_public_key text,
  p_key_algo   text default 'x25519'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if char_length(coalesce(p_device_id,'')) < 1 then raise exception 'device_id required'; end if;
  if char_length(coalesce(p_public_key,'')) < 1 then raise exception 'public_key required'; end if;
  insert into public.bee_keys (bee_id, device_id, public_key, key_algo, created_at, updated_at)
    values (v_bee, p_device_id, p_public_key, coalesce(p_key_algo,'x25519'), now(), now())
  on conflict (bee_id, device_id) do update
    set public_key = excluded.public_key, key_algo = excluded.key_algo, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- Constellation body, verbatim. No fork changes.
--
-- READ THE `where v_target = v_bee` ON THE CONFLICT CLAUSE BEFORE TOUCHING IT.
-- It is not a typo and it is not dead code: it means a participant may INSERT a
-- wrapped key for any other participant (that is how you hand someone the
-- conversation key at all), but may only OVERWRITE their own. Without it, any
-- member of a conversation could replace another member's wrapped key with one
-- sealed to a key the attacker holds, and that member's client would then
-- decrypt the conversation with an attacker-chosen CK. Preserve it exactly.
create or replace function public.comms_put_conversation_keys(
  p_conversation_id uuid,
  p_epoch           integer,
  p_wrapped         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid(); v_row jsonb; v_target uuid; v_dev text; v_n int := 0;
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if not public.is_comms_participant(p_conversation_id, v_bee) then
    raise exception 'not a participant' using errcode='42501'; end if;
  for v_row in select jsonb_array_elements(p_wrapped) loop
    v_target := (v_row->>'bee_id')::uuid;
    v_dev    := coalesce(nullif(v_row->>'device_id',''), 'legacy');
    if public.is_comms_participant(p_conversation_id, v_target) then
      insert into public.comms_conversation_keys(conversation_id, bee_id, device_id, epoch, wrapped_key, wrapped_by)
        values (p_conversation_id, v_target, v_dev, coalesce(p_epoch,1), v_row->>'wrapped_key', v_bee)
      on conflict (conversation_id, bee_id, device_id, epoch) do update
        set wrapped_key = excluded.wrapped_key, wrapped_by = excluded.wrapped_by, created_at = now()
        where v_target = v_bee;
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'count', v_n);
end; $$;

-- ── conversations ───────────────────────────────────────────────────────────

-- FORK CHANGE: `public.bees` → `public.profiles` in the recipient-exists check.
-- Nothing else. The de-duplication query ("a direct conversation containing
-- exactly these two and no one else") is the constellation's, unaltered.
create or replace function public.comms_start_direct(p_other uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid(); v_cid uuid; v_created boolean := false;
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if p_other is null or p_other = v_bee then raise exception 'invalid recipient'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'recipient not found'; end if;
  if public.comms_is_blocked(v_bee, p_other) then
    raise exception 'blocked' using errcode='42501'; end if;
  select c.id into v_cid from public.comms_conversations c
   where c.kind='direct'
     and exists (select 1 from public.comms_participants p where p.conversation_id=c.id and p.bee_id=v_bee)
     and exists (select 1 from public.comms_participants p where p.conversation_id=c.id and p.bee_id=p_other)
     and (select count(*) from public.comms_participants p where p.conversation_id=c.id)=2
   limit 1;
  if v_cid is null then
    insert into public.comms_conversations (kind, created_by) values ('direct', v_bee) returning id into v_cid;
    insert into public.comms_participants (conversation_id, bee_id, role)
      values (v_cid, v_bee, 'owner'), (v_cid, p_other, 'member');
    v_created := true;
  end if;
  return jsonb_build_object('conversation_id', v_cid, 'created', v_created);
end; $$;

-- FORK CHANGE — ONE DELETION, AND IT IS THE BIGGEST SEMANTIC CHANGE IN THIS
-- BUNDLE. The constellation body ends with a loop over every unmuted
-- participant calling `public.notify(…, '/comms/'||conversation_id)`, which
-- writes a row into the constellation-wide `notifications` inbox and points at
-- a constellation route. The fork has neither table nor route
-- (WAGGLES_FORK_PLAN v0.1 §1.4: `notifications` is STRIP), so the loop is gone.
--
-- CONSEQUENCE, STATED PLAINLY RATHER THAN DISCOVERED LATER: the fork has no
-- server-side fan-out on send. Unread is derived by the client from
-- `comms_participants.last_read_at` against `comms_conversations.last_message_at`
-- — both of which this function still maintains. Actual push notification is F5
-- and will hang off this same point.
--
-- EVERYTHING ELSE IS VERBATIM, and the first check is the load-bearing one:
-- `is_encrypted = false` is refused outright. This fork is E2EE-always, exactly
-- as TALK is. Combined with 002 (no INSERT policy on `comms_messages`), this is
-- the only way a message row can come into existence — so "plaintext cannot be
-- stored" is enforced, not merely intended.
create or replace function public.comms_send(
  p_conversation_id uuid,
  p_body            text,
  p_content_type    text default 'text',
  p_is_encrypted    boolean default false,
  p_reply_to        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid(); v_id uuid; v_reply uuid := null; v_ttl integer; v_kind text; v_other uuid;
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if not coalesce(p_is_encrypted, false) then
    raise exception 'plaintext messages are disabled — update your app' using errcode='22023';
  end if;
  if not public.is_comms_participant(p_conversation_id, v_bee) then
    raise exception 'not a participant' using errcode='42501'; end if;
  if char_length(coalesce(p_body,'')) < 1 then raise exception 'empty message'; end if;
  select kind, disappear_seconds into v_kind, v_ttl
    from public.comms_conversations where id = p_conversation_id;
  if v_kind = 'direct' then
    select bee_id into v_other from public.comms_participants
     where conversation_id = p_conversation_id and bee_id <> v_bee limit 1;
    if v_other is not null and public.comms_is_blocked(v_bee, v_other) then
      raise exception 'blocked' using errcode='42501';
    end if;
  end if;
  if p_reply_to is not null then
    select id into v_reply from public.comms_messages
     where id = p_reply_to and conversation_id = p_conversation_id;
  end if;
  insert into public.comms_messages (conversation_id, sender_bee_id, body, content_type, is_encrypted, reply_to_message_id, expires_at)
  values (p_conversation_id, v_bee, p_body, coalesce(p_content_type,'text'), true, v_reply,
          case when v_ttl is null then null else now() + make_interval(secs => v_ttl) end)
  returning id into v_id;
  update public.comms_conversations set last_message_at = now() where id = p_conversation_id;
  return jsonb_build_object('message_id', v_id);
end; $$;

-- Constellation body, verbatim.
create or replace function public.comms_edit_message(p_message_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid(); v_sender uuid; v_deleted timestamptz;
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if char_length(coalesce(p_body,'')) < 1 then raise exception 'empty message'; end if;
  select sender_bee_id, deleted_at into v_sender, v_deleted
    from public.comms_messages where id = p_message_id;
  if not found then raise exception 'message not found'; end if;
  if v_sender <> v_bee then raise exception 'only the sender can edit' using errcode='42501'; end if;
  if v_deleted is not null then raise exception 'cannot edit a removed message'; end if;
  update public.comms_messages set body = p_body, edited_at = now() where id = p_message_id;
  return jsonb_build_object('ok', true, 'message_id', p_message_id);
end; $$;

-- Constellation body, verbatim. Note it is a TOMBSTONE, not a delete: the row
-- survives with `deleted_at` set and `body` emptied, so the other side's client
-- can render "removed" rather than have a message silently vanish from the
-- middle of a thread.
create or replace function public.comms_delete_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid(); v_sender uuid;
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  select sender_bee_id into v_sender from public.comms_messages where id = p_message_id;
  if not found then raise exception 'message not found'; end if;
  if v_sender <> v_bee then raise exception 'only the sender can remove' using errcode='42501'; end if;
  update public.comms_messages set deleted_at = now(), body = '' where id = p_message_id;
  return jsonb_build_object('ok', true, 'message_id', p_message_id);
end; $$;

-- Constellation body, verbatim.
create or replace function public.comms_mark_read(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  update public.comms_participants set last_read_at = now()
   where conversation_id = p_conversation_id and bee_id = v_bee;
  return jsonb_build_object('conversation_id', p_conversation_id, 'read_at', now());
end; $$;

-- Constellation body, verbatim. The second DELETE reaps a conversation once the
-- last participant has left — on a 1:1 that is the second leave, and it takes
-- the messages and wrapped keys with it via ON DELETE CASCADE.
create or replace function public.comms_leave(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  delete from public.comms_participants where conversation_id = p_conversation_id and bee_id = v_bee;
  delete from public.comms_conversations c where c.id = p_conversation_id
    and not exists (select 1 from public.comms_participants p where p.conversation_id = c.id);
  return jsonb_build_object('conversation_id', p_conversation_id, 'left', true);
end; $$;

-- ── blocking ────────────────────────────────────────────────────────────────

-- FORK CHANGE: the constellation body then calls
-- `public.contacts__mark_blocked(v_bee, p_bee)` inside an exception-swallowing
-- block, to flag the row in the constellation CONTACTS spine (CONTACTS_MF v0.5
-- §5, "mark, never delete"). The fork has no contacts spine, so the call is
-- gone. Nothing else changed — and note the block itself was already written
-- before that call, so removing it cannot weaken blocking.
create or replace function public.comms_block(p_bee uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if p_bee is null or p_bee = v_bee then raise exception 'invalid bee'; end if;
  insert into public.comms_blocks (blocker_bee_id, blocked_bee_id) values (v_bee, p_bee)
    on conflict do nothing;
end; $$;

-- Constellation body, verbatim.
create or replace function public.comms_unblock(p_bee uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  delete from public.comms_blocks where blocker_bee_id = v_bee and blocked_bee_id = p_bee;
end; $$;

-- ── EXECUTE grants ──────────────────────────────────────────────────────────
-- Revoke from PUBLIC and from `anon` BY NAME, then grant to `authenticated`.
-- Every function here begins by requiring `auth.uid()`, so an anon grant would
-- only ever produce an 'auth required' error — but a signed-out caller should
-- not be able to reach the function body at all.

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.is_comms_participant(uuid, uuid)',
    'public.comms_is_blocked(uuid, uuid)',
    'public.bee_register_key(text, text, text)',
    'public.comms_put_conversation_keys(uuid, integer, jsonb)',
    'public.comms_start_direct(uuid)',
    'public.comms_send(uuid, text, text, boolean, uuid)',
    'public.comms_edit_message(uuid, text)',
    'public.comms_delete_message(uuid)',
    'public.comms_mark_read(uuid)',
    'public.comms_leave(uuid)',
    'public.comms_block(uuid)',
    'public.comms_unblock(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- `handle_new_profile` is a trigger function: it must NOT be callable by anyone.
revoke all on function public.handle_new_profile() from public;
revoke all on function public.handle_new_profile() from anon;
revoke all on function public.handle_new_profile() from authenticated;
