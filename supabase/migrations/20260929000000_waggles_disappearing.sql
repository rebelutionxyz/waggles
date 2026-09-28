-- ============================================================================
-- WAGGLES DISAPPEARING — disappearing messages (WAGGLES_DISAPPEAR1)
--
-- Sits ON TOP of messaging v0.1. The core already ships the STORAGE + write side:
-- comms_conversations.disappear_seconds, comms_messages.expires_at (+ its partial
-- index), and comms_send already stamps expires_at = now()+ttl. What the core
-- DEFERRED (003_rpcs comment: "comms_set_disappearing … needs comms_sweep_expired
-- + a cron") is:
--   1. comms_set_disappearing — set/clear the per-conversation timer;
--   2. comms_sweep_expired    — delete expired messages;
--   3. a 5-minute cron that runs the sweep.
--
-- SOURCE + FORK: both functions + the cron schedule were read out of the
-- constellation read-only on 2026-09-28. NEITHER function needs a fork edit (no
-- bees; auth.uid()+is_comms_participant / a plain DELETE). No -- FORK: lines.
--
-- The client flag DISAPPEARING_ENABLED in src/lib/comms.ts STAYS FALSE.
--
-- APPLY: paste into the fork SQL editor (one BEGIN/COMMIT). pg_cron MUST be enabled
-- in the fork project first (Supabase dashboard → Database → Extensions → pg_cron);
-- if it is not, the migration still applies but the sweep is NOT scheduled and it
-- NOTICEs a reminder — see docs/OWNER_APPLY.md. Then run
-- supabase/probe/disappearing_probe.sql. NOT applied here.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.comms_conversations') IS NULL OR to_regclass('public.comms_messages') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_DISAPPEAR preflight: messaging comms_* tables missing (apply messaging v0.1 first)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='comms_conversations' AND column_name='disappear_seconds') THEN
    RAISE EXCEPTION 'WAGGLES_DISAPPEAR preflight: comms_conversations.disappear_seconds missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='comms_messages' AND column_name='expires_at') THEN
    RAISE EXCEPTION 'WAGGLES_DISAPPEAR preflight: comms_messages.expires_at missing';
  END IF;
  IF to_regprocedure('public.is_comms_participant(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_DISAPPEAR preflight: is_comms_participant(uuid,uuid) missing';
  END IF;
END
$preflight$;

-- ── RPCs (verbatim from the constellation — no fork edit) ─────────────────────────
CREATE OR REPLACE FUNCTION public.comms_set_disappearing(p_conversation_id uuid, p_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if not public.is_comms_participant(p_conversation_id, v_bee) then
    raise exception 'not a participant' using errcode='42501'; end if;
  if p_seconds is not null and (p_seconds < 60 or p_seconds > 2592000) then
    raise exception 'timer out of range (60s..30d)'; end if;
  update public.comms_conversations set disappear_seconds = p_seconds where id = p_conversation_id;
end $function$;

CREATE OR REPLACE FUNCTION public.comms_sweep_expired()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  delete from public.comms_messages where expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $function$;

-- ── GRANTS — set_disappearing is user-callable; sweep is cron/owner-only ──────────
REVOKE EXECUTE ON FUNCTION public.comms_set_disappearing(uuid,integer) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_set_disappearing(uuid,integer) TO authenticated;
-- comms_sweep_expired: NOT granted to anon/authenticated — only the cron (job owner)
-- runs it; a user must never mass-delete. Revoke the default grants by name.
REVOKE EXECUTE ON FUNCTION public.comms_sweep_expired() FROM public, anon, authenticated;

-- ── CRON — run the sweep every 5 minutes (guarded on pg_cron being enabled) ───────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='comms-disappear-sweep') THEN
      PERFORM cron.unschedule('comms-disappear-sweep');
    END IF;
    PERFORM cron.schedule('comms-disappear-sweep', '*/5 * * * *', 'select public.comms_sweep_expired()');
    RAISE NOTICE 'scheduled cron job comms-disappear-sweep (*/5 * * * *)';
  ELSE
    RAISE NOTICE 'pg_cron NOT enabled: enable it, then run  select cron.schedule(''comms-disappear-sweep'', ''*/5 * * * *'', ''select public.comms_sweep_expired()'');  (see OWNER_APPLY)';
  END IF;
END
$cron$;

COMMIT;

-- VERIFICATION: supabase/probe/disappearing_probe.sql.
-- END WAGGLES DISAPPEARING
