-- ============================================================================
-- WAGGLES GROUPS — post-apply probe. RUN AFTER 20260928233000_waggles_groups.sql.
-- Read-only: it asserts, raises on any failure, and NOTICEs PASS lines. It writes
-- nothing. Run it in the fork's Supabase SQL editor; if it finishes with
-- "WAGGLES_GROUPS PROBE: ALL PASS" the groups surface is applied and locked correctly.
-- (A full multi-account runtime test — owner adds/removes a member, toggles the
--  add-policy — is the owner's to run with signed-in users; this probe proves the
--  structural guarantees a single session can verify.)
-- ============================================================================
DO $probe$
DECLARE fn text;
BEGIN
  -- 1. the four group RPCs exist, anon CANNOT execute, authenticated CAN.
  FOREACH fn IN ARRAY ARRAY[
    'public.comms_create_group(text,uuid[])',
    'public.comms_group_add(uuid,uuid)',
    'public.comms_group_remove(uuid,uuid)',
    'public.comms_group_set_add_policy(uuid,boolean)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN RAISE EXCEPTION 'FAIL: RPC % is missing', fn; END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can execute %', fn; END IF;
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: authenticated cannot execute %', fn; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: 4 group RPCs exist; anon EXECUTE revoked; authenticated EXECUTE granted';

  -- 2. all four are SECURITY DEFINER (all writes go through them; no direct table writes).
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('comms_create_group','comms_group_add','comms_group_remove','comms_group_set_add_policy')
       AND p.prosecdef = false
  ) THEN
    RAISE EXCEPTION 'FAIL: a group RPC is not SECURITY DEFINER'; END IF;
  RAISE NOTICE 'PASS: all 4 group RPCs are SECURITY DEFINER';

  -- 3. the schema groups ride on exists (messaging v0.1): kind, title, created_by, members_can_add.
  IF to_regclass('public.comms_conversations') IS NULL OR to_regclass('public.comms_participants') IS NULL THEN
    RAISE EXCEPTION 'FAIL: messaging comms_* tables are missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='comms_conversations' AND column_name='members_can_add'
  ) THEN
    RAISE EXCEPTION 'FAIL: comms_conversations.members_can_add is missing'; END IF;
  RAISE NOTICE 'PASS: comms_conversations/participants + members_can_add present';

  -- 4. RLS is on the tables groups reuse (writes are RPC-only; reads are participant-scoped).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.comms_conversations'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on public.comms_conversations'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.comms_participants'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on public.comms_participants'; END IF;
  RAISE NOTICE 'PASS: RLS enabled on comms_conversations + comms_participants';

  RAISE NOTICE 'WAGGLES_GROUPS PROBE: ALL PASS';
END
$probe$;
