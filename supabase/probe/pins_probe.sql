-- ============================================================================
-- WAGGLES PINS — post-apply probe. RUN AFTER 20260928235000_waggles_pins.sql.
-- Read-only: asserts, raises on failure, NOTICEs PASS. Ends with
-- "WAGGLES_PINS PROBE: ALL PASS" when the surface is applied + locked.
-- ============================================================================
DO $probe$
DECLARE fn text;
BEGIN
  -- 1. table + PK (conversation_id, message_id).
  IF to_regclass('public.comms_pins') IS NULL THEN RAISE EXCEPTION 'FAIL: comms_pins is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.comms_pins'::regclass AND contype='p'
      AND pg_get_constraintdef(oid)='PRIMARY KEY (conversation_id, message_id)'
  ) THEN RAISE EXCEPTION 'FAIL: comms_pins PK is not (conversation_id, message_id)'; END IF;
  RAISE NOTICE 'PASS: comms_pins exists with the (conversation_id, message_id) PK';

  -- 2. pinned_by -> profiles (fork edit).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.comms_pins'::regclass AND contype='f'
      AND pg_get_constraintdef(oid) ILIKE '%pinned_by%REFERENCES profiles(id)%'
  ) THEN RAISE EXCEPTION 'FAIL: comms_pins.pinned_by does not reference profiles(id)'; END IF;
  RAISE NOTICE 'PASS: pinned_by -> profiles(id) (fork edit applied)';

  -- 3. RLS on; anon no SELECT; read policy participant-scoped (not USING true).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.comms_pins'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on comms_pins'; END IF;
  IF has_table_privilege('anon', 'public.comms_pins', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon has SELECT on comms_pins'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comms_pins' AND coalesce(qual,'')='true') THEN
    RAISE EXCEPTION 'FAIL: comms_pins has an unrestricted read policy'; END IF;
  RAISE NOTICE 'PASS: RLS enabled; anon no SELECT; read policy participant-scoped';

  -- 4. both RPCs exist, SECURITY DEFINER, anon revoked + authenticated granted.
  FOREACH fn IN ARRAY ARRAY['public.comms_pin(uuid,uuid)', 'public.comms_unpin(uuid,uuid)'] LOOP
    IF to_regprocedure(fn) IS NULL THEN RAISE EXCEPTION 'FAIL: RPC % is missing', fn; END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can execute %', fn; END IF;
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: authenticated cannot execute %', fn; END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN ('comms_pin','comms_unpin') AND p.prosecdef=false
  ) THEN RAISE EXCEPTION 'FAIL: a pin RPC is not SECURITY DEFINER'; END IF;
  RAISE NOTICE 'PASS: comms_pin + comms_unpin exist, SECURITY DEFINER, anon revoked + authenticated granted';

  RAISE NOTICE 'WAGGLES_PINS PROBE: ALL PASS';
END
$probe$;
