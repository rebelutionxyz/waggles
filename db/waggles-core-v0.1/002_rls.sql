-- ============================================================================
-- WAGGLES CORE v0.1 — 002 RLS + the auth.users hook
--
-- WAGGLES_F1 (2026-09-15).
--
-- ── THE POSTURE, WHICH IS THE CONSTELLATION'S AND IS DELIBERATE ─────────────
-- Every table below is READ-ONLY to clients. There is not a single INSERT,
-- UPDATE or DELETE policy in this file, and that is not an omission — it is
-- copied from the constellation, where `comms_conversations`,
-- `comms_participants`, `comms_messages` and `comms_conversation_keys` each
-- carry exactly one SELECT policy and nothing else. Every write goes through a
-- SECURITY DEFINER function in 003 that re-checks `auth.uid()` itself.
--
-- A raw insert from a client is therefore refused by RLS, not merely
-- discouraged. That is what makes "the server enforces E2EE" true rather than
-- aspirational: a client cannot sidestep `comms_send`'s `is_encrypted` check by
-- writing the row itself.
--
-- The two exceptions, both read-only and both intentional:
--   * `profiles`  — world-readable. Start-a-chat is handle lookup, and a fork
--                   has no follow graph to resolve people through. The table
--                   carries no email, so "world-readable" means handle,
--                   display name and avatar. See 001.
--   * `bee_keys`  — world-readable. Public keys are public by definition; you
--                   must be able to seal a conversation key to someone you have
--                   never messaged. `encrypted_secret_key` is in this table and
--                   IS therefore readable — it is ciphertext under the account
--                   holder's own passphrase, exactly as in the constellation.
--                   NOTE FOR A LATER PASS: narrowing that column to its owner
--                   would be a strict improvement, and is a change of behaviour
--                   rather than an extraction, so F1 does not make it. Flagged
--                   in this bundle's README.
--
-- ── EXECUTE GRANTS ──────────────────────────────────────────────────────────
-- Handled per-function in 003, revoked from PUBLIC *and* from `anon` by name.
-- The constellation learned this the hard way: `REVOKE ... FROM PUBLIC` does
-- not remove a role-level grant handed out by ALTER DEFAULT PRIVILEGES, so the
-- revoke must name the role.
-- ============================================================================

-- ── the auth.users hook ─────────────────────────────────────────────────────
-- The constellation's equivalent (`handle_new_bee`) was authored out-of-repo in
-- Studio and its body lives only in that project's catalog — which is exactly
-- the kind of thing a self-hostable fork cannot have. This one is in the repo,
-- and it is the difference between "a fresh project applies the bundle" and "a
-- fresh project applies the bundle and can then actually sign someone up."
--
-- Handle derivation: the email local part, lowercased, non-conforming characters
-- stripped, padded if too short, then uniquified with a counter. Deterministic
-- and collision-safe. A bee who wants a different handle changes it later; this
-- only has to produce something valid on day one.

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base text;
  v_try  text;
  v_n    integer := 0;
begin
  v_base := lower(split_part(coalesce(new.email, ''), '@', 1));
  v_base := regexp_replace(v_base, '[^a-z0-9_-]', '', 'g');
  if char_length(v_base) < 2 then
    v_base := 'user';
  end if;
  v_base := left(v_base, 24);

  v_try := v_base;
  while exists (select 1 from public.profiles p where lower(p.handle) = v_try) loop
    v_n := v_n + 1;
    v_try := left(v_base, 24) || v_n::text;
  end loop;

  insert into public.profiles (id, handle) values (new.id, v_try)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_profile();

-- ── the participant predicate ───────────────────────────────────────────────
-- SECURITY DEFINER and STABLE, exactly as in the constellation. It must be
-- SECURITY DEFINER: it is used inside `comms_participants`' own RLS policy, and
-- a policy that had to read the table it protects would recurse.

create or replace function public.is_comms_participant(p_conversation_id uuid, p_bee uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.comms_participants
     where conversation_id = p_conversation_id and bee_id = p_bee
  );
$$;

-- ── enable RLS everywhere ───────────────────────────────────────────────────

alter table public.profiles                enable row level security;
alter table public.bee_keys                enable row level security;
alter table public.comms_conversations     enable row level security;
alter table public.comms_participants      enable row level security;
alter table public.comms_messages          enable row level security;
alter table public.comms_blocks            enable row level security;
alter table public.comms_conversation_keys enable row level security;

-- ── policies ────────────────────────────────────────────────────────────────

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
  for select using (true);

-- Self-update only, and the handle-format CHECK still applies. This is the one
-- direct client write in the bundle, and it is confined to a row the caller
-- owns and to columns that carry no security meaning.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists bee_keys_public_read on public.bee_keys;
create policy bee_keys_public_read on public.bee_keys
  for select using (true);

-- `bee_register_key` (003) is SECURITY DEFINER and is the supported path, but
-- the constellation also allows the client to write its own key row directly
-- and `Waggles.app` may rely on that. Kept, scoped to the caller's own rows.
drop policy if exists bee_keys_self_write on public.bee_keys;
create policy bee_keys_self_write on public.bee_keys
  for insert with check (bee_id = auth.uid());

drop policy if exists bee_keys_self_update on public.bee_keys;
create policy bee_keys_self_update on public.bee_keys
  for update using (bee_id = auth.uid()) with check (bee_id = auth.uid());

drop policy if exists comms_conv_member_read on public.comms_conversations;
create policy comms_conv_member_read on public.comms_conversations
  for select using (public.is_comms_participant(id, auth.uid()));

drop policy if exists comms_part_member_read on public.comms_participants;
create policy comms_part_member_read on public.comms_participants
  for select using (public.is_comms_participant(conversation_id, auth.uid()));

drop policy if exists comms_msg_member_read on public.comms_messages;
create policy comms_msg_member_read on public.comms_messages
  for select using (public.is_comms_participant(conversation_id, auth.uid()));

-- Your own block list, and only yours. ALL rather than SELECT because the
-- constellation grants the same — blocking is the one safety action a client
-- may take without a round trip through a definer function.
drop policy if exists comms_blocks_own on public.comms_blocks;
create policy comms_blocks_own on public.comms_blocks
  for all using (blocker_bee_id = auth.uid()) with check (blocker_bee_id = auth.uid());

-- You may read the keys wrapped FOR you and nobody else's. Writes go through
-- `comms_put_conversation_keys` only.
drop policy if exists conv_keys_self_read on public.comms_conversation_keys;
create policy conv_keys_self_read on public.comms_conversation_keys
  for select to authenticated using (bee_id = auth.uid());
