-- ============================================================================
-- WAGGLES MUTE — post-apply probe. RUN AFTER 20260928235500_waggles_mute.sql.
-- Read-only. Ends with "WAGGLES_MUTE PROBE: ALL PASS".
-- ============================================================================
DO $probe$
BEGIN
  -- 1. the muted column exists (the feature's storage; core-provided).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='comms_participants' AND column_name='muted'
  ) THEN RAISE EXCEPTION 'FAIL: comms_participants.muted is missing'; END IF;
  RAISE NOTICE 'PASS: comms_participants.muted present';

  -- 2. comms_set_mute exists, SECURITY DEFINER, anon revoked + authenticated granted.
  IF to_regprocedure('public.comms_set_mute(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: comms_set_mute(uuid,boolean) is missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='comms_set_mute' AND p.prosecdef=false
  ) THEN RAISE EXCEPTION 'FAIL: comms_set_mute is not SECURITY DEFINER'; END IF;
  IF has_function_privilege('anon', 'public.comms_set_mute(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute comms_set_mute'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.comms_set_mute(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute comms_set_mute'; END IF;
  RAISE NOTICE 'PASS: comms_set_mute exists, SECURITY DEFINER, anon revoked + authenticated granted';

  RAISE NOTICE 'WAGGLES_MUTE PROBE: ALL PASS';
END
$probe$;
