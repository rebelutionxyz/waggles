-- ============================================================================
-- WAGGLES MUTE — per-participant conversation mute (WAGGLES_MUTE1)
--
-- Sits ON TOP of messaging v0.1. Like groups, this adds NO tables/columns — the
-- core already has comms_participants.muted (boolean, default false). The feature
-- is the single RPC comms_set_mute, forked from the constellation.
--
-- SOURCE + FORK: comms_set_mute was read out of the constellation read-only on
-- 2026-09-28 via pg_get_functiondef and FORKED. It needs NO edit (auth.uid() +
-- is_comms_participant + an UPDATE on comms_participants; no bees reference).
--
-- The client flag MUTE_ENABLED in src/lib/comms.ts STAYS FALSE.
--
-- APPLY: paste into the fork SQL editor (one BEGIN/COMMIT). Then run
-- supabase/probe/mute_probe.sql. See docs/OWNER_APPLY.md. NOT applied here.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.comms_participants') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_MUTE preflight: comms_participants is missing (apply messaging v0.1 first)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='comms_participants' AND column_name='muted'
  ) THEN
    RAISE EXCEPTION 'WAGGLES_MUTE preflight: comms_participants.muted is missing (messaging v0.1 too old)';
  END IF;
  IF to_regprocedure('public.is_comms_participant(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_MUTE preflight: is_comms_participant(uuid,uuid) is missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.comms_set_mute(p_conversation_id uuid, p_muted boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if not public.is_comms_participant(p_conversation_id, v_bee) then
    raise exception 'not a participant' using errcode='42501'; end if;
  update public.comms_participants set muted = coalesce(p_muted, false)
   where conversation_id = p_conversation_id and bee_id = v_bee;
  return jsonb_build_object('ok', true, 'muted', coalesce(p_muted, false));
end; $function$;

REVOKE EXECUTE ON FUNCTION public.comms_set_mute(uuid,boolean) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_set_mute(uuid,boolean) TO authenticated;

COMMIT;

-- No new tables/columns → RLS inherited (a bee only ever updates its OWN participant
-- row, enforced inside the SECURITY DEFINER RPC). VERIFICATION: supabase/probe/mute_probe.sql.
-- END WAGGLES MUTE
