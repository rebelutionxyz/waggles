-- ============================================================================
-- WAGGLES DISAPPEARING — post-apply probe. RUN AFTER 20260929000000_waggles_disappearing.sql.
-- Read-only. Ends with "WAGGLES_DISAPPEAR PROBE: ALL PASS".
-- ============================================================================
DO $probe$
BEGIN
  -- 1. storage columns present (core-provided).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='comms_conversations' AND column_name='disappear_seconds') THEN
    RAISE EXCEPTION 'FAIL: comms_conversations.disappear_seconds missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='comms_messages' AND column_name='expires_at') THEN
    RAISE EXCEPTION 'FAIL: comms_messages.expires_at missing'; END IF;
  RAISE NOTICE 'PASS: disappear_seconds + expires_at present';

  -- 2. comms_set_disappearing: exists, SECDEF, anon revoked + authenticated granted.
  IF to_regprocedure('public.comms_set_disappearing(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: comms_set_disappearing is missing'; END IF;
  IF has_function_privilege('anon', 'public.comms_set_disappearing(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute comms_set_disappearing'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.comms_set_disappearing(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute comms_set_disappearing'; END IF;
  RAISE NOTICE 'PASS: comms_set_disappearing exists, anon revoked + authenticated granted';

  -- 3. comms_sweep_expired: exists, SECDEF, and NOT executable by anon/authenticated (cron-only).
  IF to_regprocedure('public.comms_sweep_expired()') IS NULL THEN
    RAISE EXCEPTION 'FAIL: comms_sweep_expired is missing'; END IF;
  IF has_function_privilege('anon', 'public.comms_sweep_expired()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.comms_sweep_expired()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: comms_sweep_expired is executable by a client (must be cron-only)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('comms_set_disappearing','comms_sweep_expired') AND p.prosecdef=false) THEN
    RAISE EXCEPTION 'FAIL: a disappearing RPC is not SECURITY DEFINER'; END IF;
  RAISE NOTICE 'PASS: comms_sweep_expired exists, SECDEF, client EXECUTE revoked (cron-only)';

  -- 4. the sweep cron is scheduled (only checkable if pg_cron is enabled).
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='comms-disappear-sweep') THEN
      RAISE EXCEPTION 'FAIL: pg_cron is enabled but the comms-disappear-sweep job is not scheduled';
    END IF;
    RAISE NOTICE 'PASS: comms-disappear-sweep cron job scheduled';
  ELSE
    RAISE WARNING 'pg_cron NOT enabled — expired messages will NOT be swept until you enable pg_cron + schedule comms_sweep_expired (see OWNER_APPLY). Client-side expiry hiding still applies.';
  END IF;

  RAISE NOTICE 'WAGGLES_DISAPPEAR PROBE: ALL PASS';
END
$probe$;
