-- ============================================================================
-- WAGGLES MEDIA — post-apply probe. RUN AFTER 20260929002000_waggles_media.sql.
-- Read-only. Ends with "WAGGLES_MEDIA PROBE: ALL PASS".
-- ============================================================================
DO $probe$
BEGIN
  -- 1. bucket exists and is PRIVATE.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'waggles-media') THEN
    RAISE EXCEPTION 'FAIL: bucket waggles-media missing'; END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'waggles-media') THEN
    RAISE EXCEPTION 'FAIL: bucket waggles-media is public (must be private — ciphertext is signed-URL only)'; END IF;
  RAISE NOTICE 'PASS: bucket waggles-media exists and is private';

  -- 2. all four policies present on storage.objects.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                  AND policyname='waggles_media_insert_own') THEN
    RAISE EXCEPTION 'FAIL: insert policy missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                  AND policyname='waggles_media_select_auth') THEN
    RAISE EXCEPTION 'FAIL: select policy missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                  AND policyname='waggles_media_update_own') THEN
    RAISE EXCEPTION 'FAIL: update policy missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                  AND policyname='waggles_media_delete_own') THEN
    RAISE EXCEPTION 'FAIL: delete policy missing'; END IF;
  RAISE NOTICE 'PASS: insert/select/update/delete policies present';

  -- 3. insert policy is scoped to authenticated + own uid folder (not anon, not open).
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
              AND policyname='waggles_media_insert_own' AND 'anon' = ANY(roles)) THEN
    RAISE EXCEPTION 'FAIL: insert policy grants anon'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                  AND policyname='waggles_media_insert_own' AND with_check ILIKE '%auth.uid()%') THEN
    RAISE EXCEPTION 'FAIL: insert policy does not restrict to own uid'; END IF;
  RAISE NOTICE 'PASS: insert policy authenticated-only, scoped to own uid folder';

  RAISE NOTICE 'WAGGLES_MEDIA PROBE: ALL PASS';
END
$probe$;
