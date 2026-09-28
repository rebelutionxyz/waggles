-- ============================================================================
-- WAGGLES REPORTING — post-apply probe. RUN AFTER 20260929000500_waggles_reporting.sql.
-- Read-only. Ends with "WAGGLES_REPORT PROBE: ALL PASS".
-- ============================================================================
DO $probe$
BEGIN
  -- 1. table + both bee FKs -> profiles (fork edit).
  IF to_regclass('public.comms_reports') IS NULL THEN RAISE EXCEPTION 'FAIL: comms_reports missing'; END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid='public.comms_reports'::regclass AND contype='f'
         AND pg_get_constraintdef(oid) ILIKE '%REFERENCES profiles(id)%') < 2 THEN
    RAISE EXCEPTION 'FAIL: comms_reports reporter/reported FKs do not both reference profiles(id)'; END IF;
  RAISE NOTICE 'PASS: comms_reports exists; reporter/reported -> profiles(id)';

  -- 2. RLS on; anon no access; there is an insert-own policy and NO client read policy.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.comms_reports'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on comms_reports'; END IF;
  IF has_table_privilege('anon', 'public.comms_reports', 'SELECT')
     OR has_table_privilege('anon', 'public.comms_reports', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: anon has table access to comms_reports'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comms_reports' AND cmd='INSERT') THEN
    RAISE EXCEPTION 'FAIL: no insert-own policy on comms_reports'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comms_reports' AND cmd='SELECT') THEN
    RAISE EXCEPTION 'FAIL: comms_reports has a client SELECT policy (fork is write-only for clients)'; END IF;
  RAISE NOTICE 'PASS: RLS on; anon no access; insert-own present; no client read policy (operator reads out of band)';

  -- 3. comms_report exists, SECDEF, anon revoked + authenticated granted.
  IF to_regprocedure('public.comms_report(uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: comms_report is missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='comms_report' AND p.prosecdef=false) THEN
    RAISE EXCEPTION 'FAIL: comms_report is not SECURITY DEFINER'; END IF;
  IF has_function_privilege('anon', 'public.comms_report(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute comms_report'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.comms_report(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute comms_report'; END IF;
  RAISE NOTICE 'PASS: comms_report exists, SECURITY DEFINER, anon revoked + authenticated granted';

  RAISE NOTICE 'WAGGLES_REPORT PROBE: ALL PASS';
END
$probe$;
