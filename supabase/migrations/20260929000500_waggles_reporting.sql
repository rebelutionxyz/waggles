-- ============================================================================
-- WAGGLES REPORTING — report a bee (WAGGLES_REPORT1)
--
-- Sits ON TOP of messaging v0.1. The core DEFERRED reporting, so this CREATES
-- comms_reports + the comms_report RPC.
--
-- SOURCE + FORK (read out of the constellation read-only 2026-09-28). Edits, each
-- marked `-- FORK:`:
--   1. reporter_bee_id / reported_bee_id FKs  bees(id) -> profiles(id).
--   2. The constellation's `comms_reports_admin_read` RLS reads `bees.is_admin` to
--      let platform admins SELECT reports. The FORK has no `bees` and no admin
--      concept (self-host): it OMITS that client read policy entirely. Reports are
--      WRITE-ONLY for clients (insert-own); the self-host OPERATOR reads them out of
--      band (Supabase dashboard / service role, which bypasses RLS). Documented, not
--      a silent drop.
-- comms_report needs NO edit (auth.uid() + an insert; no bees reference).
--
-- The client flag REPORTING_ENABLED in src/lib/comms.ts STAYS FALSE.
--
-- APPLY: paste into the fork SQL editor (one BEGIN/COMMIT). Then run
-- supabase/probe/reporting_probe.sql. See docs/OWNER_APPLY.md. NOT applied here.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_REPORT preflight: public.profiles missing (apply messaging v0.1 first)';
  END IF;
  IF to_regclass('public.comms_conversations') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_REPORT preflight: comms_conversations missing (apply messaging v0.1 first)';
  END IF;
END
$preflight$;

-- ── TABLE ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comms_reports (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_bee_id  uuid        NOT NULL REFERENCES public.profiles(id)            ON DELETE CASCADE,  -- FORK: bees(id)
  reported_bee_id  uuid        NOT NULL REFERENCES public.profiles(id)            ON DELETE CASCADE,  -- FORK: bees(id)
  conversation_id  uuid            NULL REFERENCES public.comms_conversations(id) ON DELETE SET NULL,
  reason           text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: a bee may INSERT its OWN report; no client SELECT (operator reads out of band) ──
ALTER TABLE public.comms_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comms_reports_insert_own ON public.comms_reports;
CREATE POLICY comms_reports_insert_own ON public.comms_reports FOR INSERT
  WITH CHECK (reporter_bee_id = auth.uid());
-- FORK: no comms_reports_admin_read (no bees.is_admin in the fork). Clients cannot
-- read reports; the self-host operator reads via the dashboard / service role.

-- ── RPC (verbatim from the constellation — no fork edit) ──────────────────────────
CREATE OR REPLACE FUNCTION public.comms_report(p_bee uuid, p_reason text, p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if p_bee is null or p_bee = v_bee then raise exception 'invalid bee'; end if;
  insert into public.comms_reports (reporter_bee_id, reported_bee_id, conversation_id, reason)
  values (v_bee, p_bee, p_conversation_id, coalesce(nullif(trim(p_reason),''), 'reported'));
end $function$;

-- ── GRANTS — revoke by name; the RPC writes (SECURITY DEFINER), so no table INSERT grant needed ──
REVOKE ALL ON public.comms_reports FROM anon;
REVOKE ALL ON public.comms_reports FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_report(uuid,text,uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_report(uuid,text,uuid) TO authenticated;

COMMIT;

-- VERIFICATION: supabase/probe/reporting_probe.sql.
-- END WAGGLES REPORTING
