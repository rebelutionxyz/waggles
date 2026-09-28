-- ============================================================================
-- WAGGLES REACTIONS — post-apply probe. RUN AFTER 20260928234000_waggles_reactions.sql.
-- Read-only: asserts, raises on any failure, NOTICEs PASS lines. Ends with
-- "WAGGLES_REACTIONS PROBE: ALL PASS" when the surface is applied + locked.
-- (A two-account runtime test — react/unreact, count updates — is the owner's.)
-- ============================================================================
DO $probe$
BEGIN
  -- 1. the table exists with the toggle PK (message_id, bee_id, emoji).
  IF to_regclass('public.comms_reactions') IS NULL THEN
    RAISE EXCEPTION 'FAIL: table public.comms_reactions is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.comms_reactions'::regclass AND contype='p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (message_id, bee_id, emoji)'
  ) THEN
    RAISE EXCEPTION 'FAIL: comms_reactions PK is not (message_id, bee_id, emoji)'; END IF;
  RAISE NOTICE 'PASS: comms_reactions exists with the (message_id, bee_id, emoji) PK';

  -- 2. bee_id FKs profiles (the fork), not bees.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.comms_reactions'::regclass AND contype='f'
       AND pg_get_constraintdef(oid) ILIKE '%bee_id%REFERENCES profiles(id)%'
  ) THEN
    RAISE EXCEPTION 'FAIL: comms_reactions.bee_id does not reference profiles(id)'; END IF;
  RAISE NOTICE 'PASS: bee_id -> profiles(id) (fork edit applied)';

  -- 3. RLS on; anon has no table SELECT; the read policy is participant-scoped (not USING true).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.comms_reactions'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on comms_reactions'; END IF;
  IF has_table_privilege('anon', 'public.comms_reactions', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon has SELECT on comms_reactions'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comms_reactions' AND coalesce(qual,'')='true'
  ) THEN
    RAISE EXCEPTION 'FAIL: comms_reactions has an unrestricted (USING true) read policy'; END IF;
  RAISE NOTICE 'PASS: RLS enabled; anon no SELECT; read policy participant-scoped';

  -- 4. comms_react exists, SECURITY DEFINER, anon revoked + authenticated granted.
  IF to_regprocedure('public.comms_react(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: RPC comms_react(uuid,text) is missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='comms_react' AND p.prosecdef=false
  ) THEN
    RAISE EXCEPTION 'FAIL: comms_react is not SECURITY DEFINER'; END IF;
  IF has_function_privilege('anon', 'public.comms_react(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute comms_react'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.comms_react(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute comms_react'; END IF;
  RAISE NOTICE 'PASS: comms_react exists, SECURITY DEFINER, anon revoked + authenticated granted';

  RAISE NOTICE 'WAGGLES_REACTIONS PROBE: ALL PASS';
END
$probe$;
