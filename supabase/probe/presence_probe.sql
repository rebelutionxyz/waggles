-- ============================================================================
-- WAGGLES PRESENCE — post-apply probe. RUN AFTER 20260929001000_waggles_presence.sql.
-- Read-only. Ends with "WAGGLES_PRESENCE PROBE: ALL PASS".
-- ============================================================================
DO $probe$
BEGIN
  -- 1. table + PK bee_id -> profiles.
  IF to_regclass('public.bee_presence') IS NULL THEN RAISE EXCEPTION 'FAIL: bee_presence missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bee_presence'::regclass AND contype='f'
                  AND pg_get_constraintdef(oid) ILIKE '%bee_id%REFERENCES profiles(id)%') THEN
    RAISE EXCEPTION 'FAIL: bee_presence.bee_id does not reference profiles(id)'; END IF;
  RAISE NOTICE 'PASS: bee_presence exists; bee_id -> profiles(id)';

  -- 2. RLS enabled, NO policies (write-only via the ping), no client table access.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.bee_presence'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on bee_presence'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bee_presence') THEN
    RAISE EXCEPTION 'FAIL: bee_presence has a policy (constellation has none — write-only via the ping)'; END IF;
  IF has_table_privilege('anon', 'public.bee_presence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.bee_presence', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: a client role has SELECT on bee_presence'; END IF;
  RAISE NOTICE 'PASS: RLS on, no policies, no client table SELECT (write-only via the ping)';

  -- 3. bee_presence_ping: exists, SECDEF, anon revoked + authenticated granted.
  IF to_regprocedure('public.bee_presence_ping()') IS NULL THEN
    RAISE EXCEPTION 'FAIL: bee_presence_ping is missing'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='bee_presence_ping') THEN
    RAISE EXCEPTION 'FAIL: bee_presence_ping is not SECURITY DEFINER'; END IF;
  IF has_function_privilege('anon', 'public.bee_presence_ping()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute bee_presence_ping'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.bee_presence_ping()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute bee_presence_ping'; END IF;
  RAISE NOTICE 'PASS: bee_presence_ping exists, SECURITY DEFINER, anon revoked + authenticated granted';

  RAISE NOTICE 'WAGGLES_PRESENCE PROBE: ALL PASS';
END
$probe$;
