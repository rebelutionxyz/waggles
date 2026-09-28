-- ============================================================================
-- WAGGLES REACTIONS — message reactions (WAGGLES_REACTIONS1)
--
-- Sits ON TOP of messaging v0.1 (db/waggles-core-v0.1/). Unlike groups, the core
-- DEFERRED reactions (no comms_reactions table), so this migration CREATES the
-- table + its read policy + the comms_react RPC + grants.
--
-- SOURCE + FORK (VERIFY_LAW exception per the fork-DB convention): the table,
-- constraints, RLS and the comms_react function were read out of the constellation
-- (anxmqiehpyznifqgskzc) read-only on 2026-09-28 via information_schema /
-- pg_get_constraintdef / pg_policies / pg_get_functiondef, then FORKED. The only
-- edit vs the constellation, marked `-- FORK:` inline, is:
--   1. comms_reactions.bee_id FK  bees(id) -> profiles(id)  (the fork has no bees).
-- The comms_react RPC needs NO edit (it uses auth.uid() + is_comms_participant only).
--
-- The client flag REACTIONS_ENABLED in src/lib/comms.ts STAYS FALSE; reactions do
-- not light up until the owner applies this migration AND flips the flag.
--
-- APPLY: paste into the fork's Supabase SQL editor (one BEGIN/COMMIT). Then run
-- supabase/probe/reactions_probe.sql. See docs/OWNER_APPLY.md. NOT applied here.
-- ============================================================================

BEGIN;

-- ── PREFLIGHT ─────────────────────────────────────────────────────────────────────
DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_REACTIONS preflight: table public.profiles is missing (apply messaging v0.1 first)';
  END IF;
  IF to_regclass('public.comms_messages') IS NULL OR to_regclass('public.comms_participants') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_REACTIONS preflight: messaging comms_* tables are missing (apply messaging v0.1 first)';
  END IF;
  IF to_regprocedure('public.is_comms_participant(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_REACTIONS preflight: function public.is_comms_participant(uuid,uuid) is missing';
  END IF;
END
$preflight$;

-- ── TABLE ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comms_reactions (
  message_id  uuid        NOT NULL REFERENCES public.comms_messages(id) ON DELETE CASCADE,
  bee_id      uuid        NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,  -- FORK: constellation FKs bees(id)
  emoji       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, bee_id, emoji)
);

-- ── RLS (read = a participant of the message's conversation; writes via RPC only) ──
ALTER TABLE public.comms_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comms_reactions_read ON public.comms_reactions;
CREATE POLICY comms_reactions_read ON public.comms_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.comms_messages m
      JOIN public.comms_participants p ON p.conversation_id = m.conversation_id
     WHERE m.id = comms_reactions.message_id AND p.bee_id = auth.uid()
  )
);

-- ── RPC (verbatim from the constellation — no fork edit) ──────────────────────────
CREATE OR REPLACE FUNCTION public.comms_react(p_message_id uuid, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bee uuid := auth.uid(); v_conv uuid; v_exists boolean;
begin
  if v_bee is null then raise exception 'auth required' using errcode = '28000'; end if;
  if p_emoji is null or length(btrim(p_emoji)) = 0 or length(p_emoji) > 16 then
    raise exception 'invalid emoji';
  end if;
  select conversation_id into v_conv from public.comms_messages where id = p_message_id;
  if not found then raise exception 'message not found'; end if;
  if not public.is_comms_participant(v_conv, v_bee) then
    raise exception 'not a participant' using errcode = '42501';
  end if;
  select true into v_exists from public.comms_reactions
   where message_id = p_message_id and bee_id = v_bee and emoji = p_emoji;
  if coalesce(v_exists, false) then
    delete from public.comms_reactions
     where message_id = p_message_id and bee_id = v_bee and emoji = p_emoji;
    return jsonb_build_object('reacted', false, 'emoji', p_emoji);
  else
    insert into public.comms_reactions (message_id, bee_id, emoji)
      values (p_message_id, v_bee, p_emoji) on conflict do nothing;
    return jsonb_build_object('reacted', true, 'emoji', p_emoji);
  end if;
end;
$function$;

-- ── GRANTS — revoke by name, then grant only what comms.ts needs ──────────────────
REVOKE ALL ON public.comms_reactions FROM anon;
REVOKE ALL ON public.comms_reactions FROM authenticated;
GRANT SELECT ON public.comms_reactions TO authenticated;

REVOKE EXECUTE ON FUNCTION public.comms_react(uuid,text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_react(uuid,text) TO authenticated;

COMMIT;

-- VERIFICATION: supabase/probe/reactions_probe.sql.
-- END WAGGLES REACTIONS
