-- ============================================================================
-- WAGGLES PUSH — post-apply probe. RUN AFTER 20260929003000_waggles_push.sql.
-- Read-only. Ends with "WAGGLES_PUSH PROBE: ALL PASS".
-- ============================================================================
DO $probe$
BEGIN
  -- 1. table + FK bee_id -> profiles + PK on token.
  IF to_regclass('public.bee_push_tokens') IS NULL THEN RAISE EXCEPTION 'FAIL: bee_push_tokens missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bee_push_tokens'::regclass AND contype='f'
                  AND pg_get_constraintdef(oid) ILIKE '%bee_id%REFERENCES profiles(id)%') THEN
    RAISE EXCEPTION 'FAIL: bee_push_tokens.bee_id does not reference profiles(id)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bee_push_tokens'::regclass AND contype='p'
                  AND pg_get_constraintdef(oid) ILIKE '%(token)%') THEN
    RAISE EXCEPTION 'FAIL: bee_push_tokens PK is not on (token)'; END IF;
  RAISE NOTICE 'PASS: bee_push_tokens exists; bee_id -> profiles(id); PK (token)';

  -- 2. RLS on; own-row SELECT policy; no anon SELECT.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.bee_push_tokens'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on bee_push_tokens'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bee_push_tokens'
                  AND policyname='bee_push_tokens_select_own') THEN
    RAISE EXCEPTION 'FAIL: own-row SELECT policy missing'; END IF;
  IF has_table_privilege('anon', 'public.bee_push_tokens', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can SELECT bee_push_tokens'; END IF;
  RAISE NOTICE 'PASS: RLS on, own-row SELECT policy, anon has no SELECT';

  -- 3. RPCs exist, SECDEF, anon revoked + authenticated granted.
  IF to_regprocedure('public.comms_push_subscribe(text, text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: comms_push_subscribe missing'; END IF;
  IF to_regprocedure('public.comms_push_unsubscribe(text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: comms_push_unsubscribe missing'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='comms_push_subscribe') THEN
    RAISE EXCEPTION 'FAIL: comms_push_subscribe is not SECURITY DEFINER'; END IF;
  IF has_function_privilege('anon', 'public.comms_push_subscribe(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute comms_push_subscribe'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.comms_push_subscribe(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute comms_push_subscribe'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.comms_push_unsubscribe(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot execute comms_push_unsubscribe'; END IF;
  RAISE NOTICE 'PASS: subscribe/unsubscribe exist, SECDEF, anon revoked + authenticated granted';

  RAISE NOTICE 'WAGGLES_PUSH PROBE: ALL PASS';
END
$probe$;
