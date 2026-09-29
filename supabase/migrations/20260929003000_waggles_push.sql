-- ============================================================================
-- WAGGLES PUSH — content-blind push notification tokens (WAGGLES_PUSH1)
--
-- Sits ON TOP of messaging v0.1. Stores Expo push tokens per device and exposes
-- subscribe/unsubscribe RPCs. The SEND path is the `push-notify` edge function
-- (client-invoked, fire-and-forget after comms_send) — NOT a DB trigger, mirroring
-- the constellation's push-send/push-send-message client-invoke precedent.
--
-- CONTENT-BLIND: this stores only device tokens; no message content ever touches
-- it, and the edge function it feeds sends a generic "New message" payload.
--
-- FORK NOTES (the constellation's push table is `push_subscriptions` shaped for
-- Web Push — endpoint/p256dh/auth/origin; a NATIVE fork needs Expo push tokens
-- instead, so this table is NEW, not a mirror — marked `-- FORK:`):
--   1. bee_push_tokens.bee_id FK  bees(id) -> profiles(id).
--   2. token is the Expo push token (ExponentPushToken[...]) — UNIQUE, so a
--      re-register upserts rather than duplicating.
--   3. no notify()/notifications rows (fork stripped them, like every WAGGLES pass).
--
-- The client flag PUSH_ENABLED in src/lib/push.ts STAYS FALSE. The owner flips it
-- after applying this AND LEAD deploys the push-notify edge function. Self-hosters
-- who don't want push simply never deploy the function / leave the flag false.
--
-- APPLY: paste into the fork SQL editor (one BEGIN/COMMIT). Then run
-- supabase/probe/push_probe.sql. See docs/OWNER_APPLY.md. NOT applied here.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_PUSH preflight: public.profiles missing (apply messaging v0.1 first)';
  END IF;
END
$preflight$;

-- ── TABLE ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bee_push_tokens (
  bee_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,  -- FORK: bees(id)
  token       text        NOT NULL,
  platform    text        NOT NULL DEFAULT 'unknown',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token)   -- one row per device token; re-register upserts
);
CREATE INDEX IF NOT EXISTS bee_push_tokens_bee_idx ON public.bee_push_tokens (bee_id);

-- ── RLS: a bee manages only its OWN tokens; the edge function reads via service role ──
ALTER TABLE public.bee_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bee_push_tokens_select_own" ON public.bee_push_tokens;
CREATE POLICY "bee_push_tokens_select_own" ON public.bee_push_tokens
  FOR SELECT TO authenticated USING (bee_id = auth.uid());

-- INSERT/UPDATE/DELETE happen through the SECURITY DEFINER RPCs below, so no
-- write policies are granted to the client role directly.

-- ── RPCs (user-callable; SECURITY DEFINER; auth.uid() is the owner) ───────────────
CREATE OR REPLACE FUNCTION public.comms_push_subscribe(p_token text, p_platform text DEFAULT 'unknown')
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.bee_push_tokens (bee_id, token, platform, updated_at)
  select auth.uid(), p_token, coalesce(p_platform, 'unknown'), now()
  where auth.uid() is not null and p_token is not null and length(p_token) > 0
  on conflict (token) do update
    set bee_id = auth.uid(), platform = coalesce(p_platform, 'unknown'), updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION public.comms_push_unsubscribe(p_token text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from public.bee_push_tokens where token = p_token and bee_id = auth.uid();
$function$;

-- ── GRANTS — revoke by NAMED role (not PUBLIC), then grant minimum to authenticated ──
REVOKE ALL ON public.bee_push_tokens FROM anon;
REVOKE ALL ON public.bee_push_tokens FROM authenticated;   -- SELECT flows via the policy; no direct write
GRANT  SELECT ON public.bee_push_tokens TO authenticated;

REVOKE EXECUTE ON FUNCTION public.comms_push_subscribe(text, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.comms_push_unsubscribe(text)      FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.comms_push_subscribe(text, text)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_push_unsubscribe(text)      TO authenticated;

COMMIT;

-- VERIFICATION: supabase/probe/push_probe.sql.
-- END WAGGLES PUSH
