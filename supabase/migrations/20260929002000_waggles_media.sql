-- ============================================================================
-- WAGGLES MEDIA — E2EE voice notes + images storage (WAGGLES_MEDIA1)
--
-- Voice notes and images are sealed under the conversation content key on the
-- CLIENT (src/lib/media.ts → e2ee.encryptBytes) BEFORE upload, so this bucket
-- ever holds ONLY ciphertext. The (also encrypted) text message carries the
-- storage path; recipients sign a URL, fetch, and decrypt locally.
--
-- This is STORAGE config, not app-schema DDL: it creates a private bucket and
-- RLS on storage.objects. No comms_* table/RPC is touched — the media pointer
-- rides in the existing comms_messages.body (content_type='media', already
-- supported by comms_send's p_content_type).
--
-- FORK NOTES (this bucket does not exist in the constellation, whose media path
-- is the shared 'creator-media' Studio bucket; a self-hostable fork needs its
-- own bucket, so this is NEW, not a mirror — marked `-- FORK:`):
--   1. bucket 'waggles-media', PRIVATE (public=false) — ciphertext is signed-URL
--      only, never world-readable.
--   2. INSERT policy: an authenticated bee may write ONLY under media/<own uid>/*.
--   3. SELECT policy: any authenticated bee may read objects in this bucket
--      (the bytes are ciphertext; the conversation key gates real access, and
--      storage RLS cannot cheaply join comms membership). Signed-URL + private
--      bucket keeps anon out entirely.
--   4. UPDATE/DELETE: owner-only (author can remove their own upload).
--
-- The client flag MEDIA_ENABLED in src/lib/media.ts STAYS FALSE. The owner flips
-- it after applying this + a device smoke test (recording/playback is device-only,
-- unverifiable by tsc — flagged in the report).
--
-- APPLY: paste into the fork SQL editor (one BEGIN/COMMIT). Then run
-- supabase/probe/media_probe.sql. See docs/OWNER_APPLY.md. NOT applied here.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_MEDIA preflight: storage schema missing (not a Supabase project?)';
  END IF;
  IF to_regclass('public.comms_messages') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_MEDIA preflight: public.comms_messages missing (apply messaging v0.1 first)';
  END IF;
END
$preflight$;

-- ── BUCKET (private) ──────────────────────────────────────────────────────────
-- FORK: new bucket; created idempotently so a re-apply is a no-op.
INSERT INTO storage.buckets (id, name, public)
VALUES ('waggles-media', 'waggles-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── RLS policies on storage.objects, scoped to this bucket ──────────────────────
-- storage.objects already has RLS enabled by Supabase; we add bucket-scoped policies.
DROP POLICY IF EXISTS "waggles_media_insert_own" ON storage.objects;
CREATE POLICY "waggles_media_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'waggles-media'
    AND (storage.foldername(name))[1] = 'media'
    AND (storage.foldername(name))[2] = auth.uid()::text   -- FORK: only under own uid
  );

DROP POLICY IF EXISTS "waggles_media_select_auth" ON storage.objects;
CREATE POLICY "waggles_media_select_auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'waggles-media');   -- ciphertext only; CK gates real access

DROP POLICY IF EXISTS "waggles_media_update_own" ON storage.objects;
CREATE POLICY "waggles_media_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'waggles-media' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'waggles-media' AND owner = auth.uid());

DROP POLICY IF EXISTS "waggles_media_delete_own" ON storage.objects;
CREATE POLICY "waggles_media_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'waggles-media' AND owner = auth.uid());

COMMIT;

-- VERIFICATION: supabase/probe/media_probe.sql.
-- END WAGGLES MEDIA
