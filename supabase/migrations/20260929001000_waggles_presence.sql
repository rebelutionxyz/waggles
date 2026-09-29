-- ============================================================================
-- WAGGLES PRESENCE — online status (WAGGLES_PRESENCE1)
--
-- Sits ON TOP of messaging v0.1. The core DEFERRED presence, so this CREATES
-- bee_presence + bee_presence_ping.
--
-- SOURCE + FORK (read out of the constellation read-only 2026-09-28). Edit,
-- marked `-- FORK:`:
--   1. bee_presence.bee_id FK  bees(id) -> profiles(id).
-- bee_presence_ping needs NO edit (auth.uid() upsert into bee_presence).
--
-- FIDELITY NOTE (not a deviation — matched exactly): in the constellation
-- bee_presence has RLS ENABLED and NO policies, so it is WRITE-ONLY via the
-- SECURITY DEFINER ping; there is NO client read path for presence there either.
-- This fork mirrors that. Consequence: the client can PING (heartbeat, already
-- wired in app/chats.tsx, gated on PRESENCE_ENABLED) but cannot yet DISPLAY
-- others' status — surfacing presence needs a read policy or a read RPC that the
-- constellation does not define. Flagged in the report, NOT invented here.
--
-- The client flag PRESENCE_ENABLED in src/lib/comms.ts STAYS FALSE.
--
-- APPLY: paste into the fork SQL editor (one BEGIN/COMMIT). Then run
-- supabase/probe/presence_probe.sql. See docs/OWNER_APPLY.md. NOT applied here.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_PRESENCE preflight: public.profiles missing (apply messaging v0.1 first)';
  END IF;
END
$preflight$;

-- ── TABLE ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bee_presence (
  bee_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,  -- FORK: bees(id)
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  show_presence boolean     NOT NULL DEFAULT true
);

-- ── RLS: enabled, NO policies (write-only via the SECURITY DEFINER ping; matches
--    the constellation exactly — a non-owner cannot read/write directly). ──
ALTER TABLE public.bee_presence ENABLE ROW LEVEL SECURITY;

-- ── RPC (verbatim from the constellation — no fork edit) ──────────────────────────
CREATE OR REPLACE FUNCTION public.bee_presence_ping()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.bee_presence (bee_id, last_seen_at)
  select auth.uid(), now() where auth.uid() is not null
  on conflict (bee_id) do update set last_seen_at = now();
$function$;

-- ── GRANTS — no client table access (RLS-deny + no grant); ping is user-callable ──
REVOKE ALL ON public.bee_presence FROM anon;
REVOKE ALL ON public.bee_presence FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bee_presence_ping() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.bee_presence_ping() TO authenticated;

COMMIT;

-- VERIFICATION: supabase/probe/presence_probe.sql.
-- END WAGGLES PRESENCE
