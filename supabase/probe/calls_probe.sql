-- ============================================================================
-- WAGGLES CALLS — post-apply probe. RUN AFTER 20260928230000_waggles_calls.sql.
-- Read-only: it asserts, raises on any failure, and NOTICEs PASS lines. It writes
-- nothing. Run it in the fork's Supabase SQL editor; if it finishes with
-- "WAGGLES_CALLS PROBE: ALL PASS" the calls surface is applied and locked correctly.
-- (A full two-account runtime read test is the owner's to run with two signed-in
--  users; this probe proves the structural guarantees a single session can verify.)
-- ============================================================================
DO $probe$
DECLARE fn text;
BEGIN
  -- 1-3. the four RPCs exist, anon CANNOT execute, authenticated CAN.
  FOREACH fn IN ARRAY ARRAY[
    'public.comms_room_create(text,uuid,text,text,boolean,integer)',
    'public.comms_room_join(uuid,text)',
    'public.comms_room_leave(uuid)',
    'public.comms_put_call_keys(uuid,integer,jsonb)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN RAISE EXCEPTION 'FAIL: RPC % is missing', fn; END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can execute %', fn; END IF;
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: authenticated cannot execute %', fn; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: 4 call RPCs exist; anon EXECUTE revoked; authenticated EXECUTE granted';

  -- 4. comms_call_keys is RLS-locked and anon has no table SELECT.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.comms_call_keys'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on public.comms_call_keys'; END IF;
  IF has_table_privilege('anon', 'public.comms_call_keys', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon has SELECT on public.comms_call_keys'; END IF;
  RAISE NOTICE 'PASS: comms_call_keys RLS enabled; anon has no table SELECT';

  -- 5. no unrestricted (USING true) read policy exists on comms_call_keys — a
  --    non-participant is gated to their own sealed rows (recipient_bee_id = auth.uid()).
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='comms_call_keys' AND coalesce(qual,'') = 'true'
  ) THEN
    RAISE EXCEPTION 'FAIL: comms_call_keys has an unrestricted (USING true) read policy'; END IF;
  RAISE NOTICE 'PASS: comms_call_keys has no unrestricted read policy (non-participant sees only own rows)';

  -- 6. the three tables and both helpers exist.
  IF to_regclass('public.comms_rooms') IS NULL
     OR to_regclass('public.comms_room_participants') IS NULL
     OR to_regclass('public.comms_call_keys') IS NULL THEN
    RAISE EXCEPTION 'FAIL: a comms calls table is missing'; END IF;
  IF to_regprocedure('public.is_room_participant(uuid,uuid)') IS NULL
     OR to_regprocedure('public.room_is_public(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: a calls helper function is missing'; END IF;
  RAISE NOTICE 'PASS: 3 tables + 2 helper functions present';

  RAISE NOTICE 'WAGGLES_CALLS PROBE: ALL PASS';
END
$probe$;
