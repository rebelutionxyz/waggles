-- ============================================================================
-- WAGGLES GROUPS — group conversations (WAGGLES_GROUPS1)
--
-- A GROUPS-ONLY migration that sits ON TOP of the already-applied messaging v0.1
-- (db/waggles-core-v0.1/, applied to the fork by WAGGLES_F4). The core already
-- ships everything groups need in the SCHEMA: comms_conversations.kind
-- ('direct'|'group'), .title, .created_by (-> profiles), .members_can_add, and
-- comms_participants.role ('owner'|'member'|…) with RLS. So this migration adds
-- NO tables and NO columns — only the four group RPCs, forked from the
-- constellation, plus their grants.
--
-- SOURCE + FORK (VERIFY_LAW exception per the fork-DB convention): every function
-- below was read out of the constellation project (anxmqiehpyznifqgskzc) read-only
-- on 2026-09-28 via pg_get_functiondef, then FORKED. The only edits vs the
-- constellation, each marked `-- FORK:` inline, are:
--   1. the membership existence check `FROM public.bees` -> `public.profiles`
--      (the fork uses profiles, has no `bees`). Two call sites (create_group, group_add).
-- Nothing else changed — owner/member roles, members_can_add policy, and the
-- "removing from participants cuts RLS access" behaviour are verbatim.
--
-- The client flag GROUPS_ENABLED in src/lib/comms.ts STAYS FALSE; groups do not
-- light up in the UI until the owner applies this migration AND flips the flag.
--
-- APPLY: paste this whole file into the fork's Supabase SQL editor (one BEGIN/COMMIT,
-- so any failure rolls the whole thing back). Then run supabase/probe/groups_probe.sql.
-- See docs/OWNER_APPLY.md. NOT applied by anyone here.
-- ============================================================================

BEGIN;

-- ── PREFLIGHT — fail fast if a messaging-v0.1 prerequisite is absent ──────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_GROUPS preflight: table public.profiles is missing (apply messaging v0.1 first)';
  END IF;
  IF to_regclass('public.comms_conversations') IS NULL OR to_regclass('public.comms_participants') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_GROUPS preflight: messaging comms_* tables are missing (apply messaging v0.1 first)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='comms_conversations' AND column_name='members_can_add'
  ) THEN
    RAISE EXCEPTION 'WAGGLES_GROUPS preflight: comms_conversations.members_can_add is missing (messaging v0.1 too old)';
  END IF;
END
$preflight$;

-- ── RPCs (forked from the constellation; only the bees->profiles edits marked) ────────

CREATE OR REPLACE FUNCTION public.comms_create_group(p_title text, p_member_bees uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_bee uuid := auth.uid(); v_cid uuid; v_m uuid;
BEGIN
  IF v_bee IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode='28000'; END IF;
  IF char_length(coalesce(p_title,'')) < 1 THEN RAISE EXCEPTION 'title required'; END IF;
  INSERT INTO public.comms_conversations (kind, title, created_by) VALUES ('group', p_title, v_bee) RETURNING id INTO v_cid;
  INSERT INTO public.comms_participants (conversation_id, bee_id, role) VALUES (v_cid, v_bee, 'owner');
  IF p_member_bees IS NOT NULL THEN
    FOREACH v_m IN ARRAY p_member_bees LOOP
      -- FORK: constellation checks public.bees; the fork has profiles, not bees.
      IF v_m <> v_bee AND EXISTS (SELECT 1 FROM public.profiles WHERE id=v_m) THEN
        INSERT INTO public.comms_participants (conversation_id, bee_id, role) VALUES (v_cid, v_m, 'member')
        ON CONFLICT (conversation_id, bee_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('conversation_id', v_cid);
END; $function$;

CREATE OR REPLACE FUNCTION public.comms_group_add(p_conversation_id uuid, p_bee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bee  uuid := auth.uid();
  v_kind text;
  v_role text;
  v_open boolean;
begin
  if v_bee is null then raise exception 'auth required' using errcode = '28000'; end if;

  select c.kind, c.members_can_add, p.role
    into v_kind, v_open, v_role
    from public.comms_conversations c
    join public.comms_participants p
      on p.conversation_id = c.id and p.bee_id = v_bee
    where c.id = p_conversation_id;

  if not found then raise exception 'not a participant of this group' using errcode = '42501'; end if;
  if v_kind <> 'group' then raise exception 'can only add members to a group'; end if;

  -- Owner can always add; other members only when the owner has opened it up.
  if v_role <> 'owner' and not coalesce(v_open, false) then
    raise exception 'only the group owner can add members' using errcode = '42501';
  end if;

  if p_bee_id = v_bee then raise exception 'you are already a member'; end if;
  -- FORK: constellation checks public.bees; the fork has profiles, not bees.
  if not exists (select 1 from public.profiles where id = p_bee_id) then raise exception 'bee not found'; end if;

  insert into public.comms_participants (conversation_id, bee_id, role)
  values (p_conversation_id, p_bee_id, 'member')
  on conflict (conversation_id, bee_id) do nothing;

  return jsonb_build_object('conversation_id', p_conversation_id, 'bee_id', p_bee_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.comms_group_remove(p_conversation_id uuid, p_bee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bee  uuid := auth.uid();
  v_kind text;
  v_role text;
begin
  if v_bee is null then raise exception 'auth required' using errcode = '28000'; end if;

  select c.kind, p.role
    into v_kind, v_role
    from public.comms_conversations c
    join public.comms_participants p
      on p.conversation_id = c.id and p.bee_id = v_bee
    where c.id = p_conversation_id;

  if not found then raise exception 'not a participant of this group' using errcode = '42501'; end if;
  if v_kind <> 'group' then raise exception 'not a group'; end if;
  if v_role <> 'owner' then raise exception 'only the owner can remove members' using errcode = '42501'; end if;
  if p_bee_id = v_bee then raise exception 'the owner cannot remove themselves — leave the group instead'; end if;

  -- Removing from participants cuts their RLS access to the thread immediately.
  -- (Not key-rotating: they keep an unusable content key but can no longer fetch
  -- any ciphertext.) Never remove an owner row.
  delete from public.comms_participants
   where conversation_id = p_conversation_id and bee_id = p_bee_id and role <> 'owner';

  return jsonb_build_object('conversation_id', p_conversation_id, 'removed', p_bee_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.comms_group_set_add_policy(p_conversation_id uuid, p_allowed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '28000'; end if;
  select role into v_role from public.comms_participants
    where conversation_id = p_conversation_id and bee_id = auth.uid();
  if v_role is null then raise exception 'not a participant' using errcode = '42501'; end if;
  if v_role <> 'owner' then raise exception 'only the owner can change this' using errcode = '42501'; end if;
  update public.comms_conversations set members_can_add = coalesce(p_allowed, false)
    where id = p_conversation_id and kind = 'group';
  return jsonb_build_object('conversation_id', p_conversation_id, 'members_can_add', coalesce(p_allowed, false));
end;
$function$;

-- ── GRANTS — revoke from public/anon/authenticated by NAME, then grant only comms.ts's calls ──
REVOKE EXECUTE ON FUNCTION public.comms_create_group(text,uuid[])          FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_group_add(uuid,uuid)              FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_group_remove(uuid,uuid)           FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_group_set_add_policy(uuid,boolean) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_create_group(text,uuid[])          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_group_add(uuid,uuid)              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_group_remove(uuid,uuid)           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_group_set_add_policy(uuid,boolean) TO authenticated;

COMMIT;

-- No new tables → RLS is inherited from messaging v0.1 (comms_conversations /
-- comms_participants read policies already scope a bee to their own conversations,
-- and all writes go through these SECURITY DEFINER RPCs). VERIFICATION: see
-- supabase/probe/groups_probe.sql.
-- END WAGGLES GROUPS
