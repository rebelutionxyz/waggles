-- ============================================================================
-- WAGGLES PINS — pinned messages (WAGGLES_PINS1)
--
-- Sits ON TOP of messaging v0.1 (db/waggles-core-v0.1/). The core DEFERRED pins
-- (no comms_pins table, no comms_pin/comms_unpin), so this migration CREATES them.
--
-- SOURCE + FORK (VERIFY_LAW exception per the fork-DB convention): the table,
-- constraints, RLS and both functions were read out of the constellation
-- (anxmqiehpyznifqgskzc) read-only on 2026-09-28 and FORKED. The only edit vs the
-- constellation, marked `-- FORK:`, is:
--   1. comms_pins.pinned_by FK  bees(id) -> profiles(id)  (the fork has no bees).
-- comms_pin / comms_unpin need NO edit (auth.uid() + is_comms_participant only).
--
-- The client flag PINS_ENABLED in src/lib/comms.ts STAYS FALSE.
--
-- APPLY: paste into the fork's Supabase SQL editor (one BEGIN/COMMIT). Then run
-- supabase/probe/pins_probe.sql. See docs/OWNER_APPLY.md. NOT applied here.
-- ============================================================================

BEGIN;

-- ── PREFLIGHT ─────────────────────────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_PINS preflight: table public.profiles is missing (apply messaging v0.1 first)';
  END IF;
  IF to_regclass('public.comms_conversations') IS NULL OR to_regclass('public.comms_messages') IS NULL
     OR to_regclass('public.comms_participants') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_PINS preflight: messaging comms_* tables are missing (apply messaging v0.1 first)';
  END IF;
  IF to_regprocedure('public.is_comms_participant(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_PINS preflight: function public.is_comms_participant(uuid,uuid) is missing';
  END IF;
END
$preflight$;

-- ── TABLE ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comms_pins (
  conversation_id uuid        NOT NULL REFERENCES public.comms_conversations(id) ON DELETE CASCADE,
  message_id      uuid        NOT NULL REFERENCES public.comms_messages(id)      ON DELETE CASCADE,
  pinned_by       uuid        NOT NULL REFERENCES public.profiles(id)            ON DELETE CASCADE,  -- FORK: constellation FKs bees(id)
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);

-- ── RLS (read = a participant of the conversation; writes via RPC only) ───────────
ALTER TABLE public.comms_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comms_pins_read ON public.comms_pins;
CREATE POLICY comms_pins_read ON public.comms_pins FOR SELECT USING (
  public.is_comms_participant(conversation_id, auth.uid())
);

-- ── RPCs (verbatim from the constellation — no fork edit) ─────────────────────────
CREATE OR REPLACE FUNCTION public.comms_pin(p_conversation_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if not public.is_comms_participant(p_conversation_id, v_bee) then
    raise exception 'not a participant' using errcode='42501';
  end if;
  if not exists (select 1 from public.comms_messages m
                 where m.id = p_message_id and m.conversation_id = p_conversation_id and m.deleted_at is null) then
    raise exception 'message not found';
  end if;
  if (select count(*) from public.comms_pins where conversation_id = p_conversation_id) >= 50 then
    raise exception 'pin limit reached (50)';
  end if;
  insert into public.comms_pins (conversation_id, message_id, pinned_by)
  values (p_conversation_id, p_message_id, v_bee)
  on conflict do nothing;
end $function$;

CREATE OR REPLACE FUNCTION public.comms_unpin(p_conversation_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bee uuid := auth.uid();
begin
  if v_bee is null then raise exception 'auth required' using errcode='28000'; end if;
  if not public.is_comms_participant(p_conversation_id, v_bee) then
    raise exception 'not a participant' using errcode='42501';
  end if;
  delete from public.comms_pins where conversation_id = p_conversation_id and message_id = p_message_id;
end $function$;

-- ── GRANTS — revoke by name, then grant only what comms.ts needs ──────────────────
REVOKE ALL ON public.comms_pins FROM anon;
REVOKE ALL ON public.comms_pins FROM authenticated;
GRANT SELECT ON public.comms_pins TO authenticated;

REVOKE EXECUTE ON FUNCTION public.comms_pin(uuid,uuid)   FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_unpin(uuid,uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_pin(uuid,uuid)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_unpin(uuid,uuid) TO authenticated;

COMMIT;

-- VERIFICATION: supabase/probe/pins_probe.sql.
-- END WAGGLES PINS
