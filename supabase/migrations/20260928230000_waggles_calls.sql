-- ============================================================================
-- WAGGLES CALLS — E2EE call rooms + sealed call keys (WAGGLES_FORK_DB1)
--
-- A CALLS-ONLY migration that sits ON TOP of the already-applied messaging v0.1
-- (db/waggles-core-v0.1/, applied to the fork by WAGGLES_F4). It adds exactly the
-- surface src/lib/calls.ts (WAGGLES_CALLS1) needs: comms_rooms, comms_room_participants,
-- comms_call_keys, the is_room_participant / room_is_public helpers, and the four RPCs
-- comms_room_create / comms_room_join / comms_room_leave / comms_put_call_keys.
--
-- SOURCE + FORK (VERIFY_LAW exception per WAGGLES_FORK_DB1-ACK): every object below was
-- read out of the constellation project (anxmqiehpyznifqgskzc) read-only on 2026-09-28
-- via information_schema / pg_get_constraintdef / pg_get_functiondef / pg_policies, then
-- FORKED. The only edits vs the constellation, each marked `-- FORK:` inline, are:
--   1. every `bees` FK  ->  `profiles`  (the fork uses profiles, has no `bees`);
--   2. comms_rooms.atom_id: the constellation FKs it to `atoms`; the fork strips the
--      Manual taxonomy, so NO FK (calls.ts always passes p_atom_id = null);
--   3. comms_room_create: the constellation SELECTs the caller handle from `bees` and
--      PERFORM public.notify(...) to ring; removed (fork has no notifications / no bees);
--   4. comms_room_join: the constellation DELETEs the answered ring from `notifications`;
--      removed (fork has no notifications).
-- Nothing else changed. The reuse/cap/advisory-lock/epoch logic is verbatim.
--
-- APPLY: paste this whole file into the fork's Supabase SQL editor (it is wrapped in one
-- BEGIN/COMMIT, so any failure rolls the whole thing back). Then run
-- supabase/probe/calls_probe.sql. See docs/OWNER_APPLY.md. NOT applied by anyone here.
-- ============================================================================

BEGIN;

-- ── PREFLIGHT — fail fast, touch nothing, if a messaging-v0.1 prerequisite is absent ──
DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_CALLS preflight: table public.profiles is missing (apply messaging v0.1 first)';
  END IF;
  IF to_regclass('public.bee_keys') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_CALLS preflight: table public.bee_keys is missing (apply messaging v0.1 first)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='bee_keys'
       AND column_name IN ('bee_id','device_id','public_key')
     GROUP BY table_name HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'WAGGLES_CALLS preflight: public.bee_keys lacks bee_id/device_id/public_key';
  END IF;
  IF to_regclass('public.comms_conversations') IS NULL OR to_regclass('public.comms_participants') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_CALLS preflight: messaging comms_* tables are missing (apply messaging v0.1 first)';
  END IF;
  IF to_regprocedure('public.is_comms_participant(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_CALLS preflight: function public.is_comms_participant(uuid,uuid) is missing';
  END IF;
  IF to_regprocedure('public.comms_is_blocked(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WAGGLES_CALLS preflight: function public.comms_is_blocked(uuid,uuid) is missing';
  END IF;
END
$preflight$;

-- ── TABLES ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comms_rooms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind = ANY (ARRAY['call','space','roulette'])),
  conversation_id  uuid REFERENCES public.comms_conversations(id) ON DELETE SET NULL,
  atom_id          text,                          -- FORK: constellation FKs -> public.atoms; fork has no atoms.
  title            text,
  host_bee_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,   -- FORK: bees -> profiles
  livekit_room     text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'live' CHECK (status = ANY (ARRAY['live','ended'])),
  is_public        boolean NOT NULL DEFAULT false,
  max_participants integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  ended_at         timestamptz,
  call_key_epoch   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.comms_room_participants (
  room_id   uuid NOT NULL REFERENCES public.comms_rooms(id) ON DELETE CASCADE,
  bee_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,   -- FORK: bees -> profiles
  role      text NOT NULL DEFAULT 'listener' CHECK (role = ANY (ARRAY['host','speaker','listener'])),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at   timestamptz,
  PRIMARY KEY (room_id, bee_id)
);

CREATE TABLE IF NOT EXISTS public.comms_call_keys (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_room_id                uuid NOT NULL REFERENCES public.comms_rooms(id) ON DELETE CASCADE,
  key_epoch                   integer NOT NULL DEFAULT 1,
  recipient_bee_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE,   -- FORK: bees -> profiles
  recipient_device_id         text,
  recipient_ephemeral_pubkey  text,
  wrapped_key                 text NOT NULL,
  wrapped_by                  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- FORK: bees -> profiles
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comms_call_keys_recipient_form CHECK (
    ((recipient_bee_id IS NOT NULL) AND (recipient_device_id IS NOT NULL) AND (recipient_ephemeral_pubkey IS NULL))
    OR ((recipient_ephemeral_pubkey IS NOT NULL) AND (recipient_bee_id IS NULL) AND (recipient_device_id IS NULL))
  )
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS comms_rooms_status        ON public.comms_rooms (status, kind);
CREATE INDEX IF NOT EXISTS comms_room_parts_bee      ON public.comms_room_participants (bee_id);
CREATE UNIQUE INDEX IF NOT EXISTS comms_call_keys_bee_uk
  ON public.comms_call_keys (call_room_id, key_epoch, recipient_bee_id, recipient_device_id)
  WHERE (recipient_bee_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS comms_call_keys_guest_uk
  ON public.comms_call_keys (call_room_id, key_epoch, recipient_ephemeral_pubkey)
  WHERE (recipient_ephemeral_pubkey IS NOT NULL);
CREATE INDEX IF NOT EXISTS comms_call_keys_room_epoch_ix ON public.comms_call_keys (call_room_id, key_epoch);

-- ── HELPER FUNCTIONS (verbatim from the constellation; no fork edits) ───────────────
CREATE OR REPLACE FUNCTION public.is_room_participant(p_room_id uuid, p_bee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.comms_room_participants WHERE room_id = p_room_id AND bee_id = p_bee);
$fn$;

CREATE OR REPLACE FUNCTION public.room_is_public(p_room_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.comms_rooms WHERE id = p_room_id AND is_public);
$fn$;

-- ── RPCs ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comms_room_create(
  p_kind text, p_conversation_id uuid DEFAULT NULL, p_atom_id text DEFAULT NULL,
  p_title text DEFAULT NULL, p_is_public boolean DEFAULT NULL, p_max integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_bee uuid := auth.uid(); v_id uuid := gen_random_uuid();
  v_lk text; v_pub boolean; v_existing_id uuid; v_existing_lk text; v_other uuid;
BEGIN
  IF v_bee IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode='28000'; END IF;
  IF p_kind NOT IN ('call','space') THEN RAISE EXCEPTION 'kind must be call|space (roulette via enqueue)'; END IF;

  IF p_kind='call' AND p_conversation_id IS NOT NULL THEN
    IF NOT public.is_comms_participant(p_conversation_id, v_bee) THEN
      RAISE EXCEPTION 'not a participant of that conversation' USING errcode='42501';
    END IF;
    IF (SELECT kind FROM public.comms_conversations WHERE id = p_conversation_id) = 'direct' THEN
      SELECT p2.bee_id INTO v_other FROM public.comms_participants p2
       WHERE p2.conversation_id = p_conversation_id AND p2.bee_id <> v_bee LIMIT 1;
      IF v_other IS NOT NULL AND public.comms_is_blocked(v_bee, v_other) THEN
        RAISE EXCEPTION 'blocked' USING errcode='42501';
      END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0));
    SELECT id, livekit_room INTO v_existing_id, v_existing_lk
      FROM public.comms_rooms
      WHERE kind='call' AND conversation_id = p_conversation_id AND status='live'
      ORDER BY started_at DESC LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      INSERT INTO public.comms_room_participants (room_id, bee_id, role)
        VALUES (v_existing_id, v_bee, 'speaker')
        ON CONFLICT (room_id, bee_id) DO UPDATE SET left_at = NULL, joined_at = now();
      RETURN jsonb_build_object('room_id', v_existing_id, 'livekit_room', v_existing_lk, 'is_public', false, 'reused', true);
    END IF;
  END IF;

  v_lk := 'wg_'||replace(v_id::text,'-','');   -- FORK: 'hc_' prefix -> 'wg_' (cosmetic room name; token fn keys off room_id)
  v_pub := coalesce(p_is_public, p_kind='space');
  INSERT INTO public.comms_rooms (id, kind, conversation_id, atom_id, title, host_bee_id, livekit_room, status, is_public, max_participants, started_at)
  VALUES (v_id, p_kind, p_conversation_id, p_atom_id, p_title, v_bee, v_lk, 'live', v_pub, p_max, now());
  INSERT INTO public.comms_room_participants (room_id, bee_id, role) VALUES (v_id, v_bee, 'host');

  -- FORK: the constellation here did `SELECT handle FROM public.bees` + `PERFORM public.notify(...)`
  -- to ring the other participant. The fork has no notifications table and no `bees`, so the ring
  -- block is removed; the client rings via realtime on the comms_rooms/participants insert.

  RETURN jsonb_build_object('room_id', v_id, 'livekit_room', v_lk, 'is_public', v_pub, 'reused', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.comms_room_join(p_room_id uuid, p_role text DEFAULT 'listener')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_bee uuid := auth.uid(); v_status text; v_pub boolean; v_conv uuid; v_lk text; v_role text; v_kind text; v_max int; v_active int;
BEGIN
  IF v_bee IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode='28000'; END IF;
  SELECT status, is_public, conversation_id, livekit_room, kind, max_participants
    INTO v_status, v_pub, v_conv, v_lk, v_kind, v_max
    FROM public.comms_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;
  IF v_status <> 'live' THEN RAISE EXCEPTION 'room has ended'; END IF;
  IF NOT (v_pub OR (v_conv IS NOT NULL AND public.is_comms_participant(v_conv, v_bee)) OR public.is_room_participant(p_room_id, v_bee)) THEN
    RAISE EXCEPTION 'not allowed to join this room' USING errcode='42501';
  END IF;
  -- Enforce the call cap server-side (client cap in calls.ts is bypassable). Count ACTIVE
  -- participants OTHER than this bee so a rejoin/refresh is never blocked. Default 8.
  IF v_kind = 'call' THEN
    SELECT count(*) INTO v_active FROM public.comms_room_participants
      WHERE room_id = p_room_id AND left_at IS NULL AND bee_id <> v_bee;
    IF v_active >= coalesce(v_max, 8) THEN
      RAISE EXCEPTION '%', format('This call is full — up to %s people can be on a call at once.', coalesce(v_max, 8));
    END IF;
  END IF;
  INSERT INTO public.comms_room_participants (room_id, bee_id, role)
  VALUES (p_room_id, v_bee, coalesce(p_role,'listener'))
  ON CONFLICT (room_id, bee_id) DO UPDATE SET left_at = NULL, joined_at = now();
  -- FORK: the constellation DELETEd the answered call_incoming row from public.notifications
  -- here; the fork has no notifications table, so removed.
  SELECT role INTO v_role FROM public.comms_room_participants
   WHERE room_id = p_room_id AND bee_id = v_bee;
  RETURN jsonb_build_object('room_id', p_room_id, 'livekit_room', v_lk, 'role', v_role);
END; $fn$;

CREATE OR REPLACE FUNCTION public.comms_room_leave(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_bee uuid := auth.uid();
BEGIN
  IF v_bee IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode='28000'; END IF;
  UPDATE public.comms_room_participants SET left_at = now()
   WHERE room_id = p_room_id AND bee_id = v_bee AND left_at IS NULL;
  -- End the room once the last active participant leaves (call/roulette).
  UPDATE public.comms_rooms r SET status='ended', ended_at=now()
   WHERE r.id = p_room_id AND r.status='live' AND r.kind='roulette';
  UPDATE public.comms_rooms r SET status='ended', ended_at=now()
   WHERE r.id = p_room_id AND r.status='live' AND r.kind IN ('call','roulette')
     AND NOT EXISTS (SELECT 1 FROM public.comms_room_participants p WHERE p.room_id=r.id AND p.left_at IS NULL);
  RETURN jsonb_build_object('room_id', p_room_id, 'left', true);
END; $fn$;

CREATE OR REPLACE FUNCTION public.comms_put_call_keys(p_room_id uuid, p_epoch integer, p_wrapped jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_bee uuid := auth.uid(); v_host uuid; v_kind text; v_cur int; v_row jsonb; v_n int := 0;
BEGIN
  IF v_bee IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode='28000'; END IF;
  SELECT host_bee_id, kind, call_key_epoch INTO v_host, v_kind, v_cur
    FROM public.comms_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;
  IF v_kind <> 'call' THEN RAISE EXCEPTION 'not a call room' USING errcode='42501'; END IF;
  IF v_host IS NULL OR v_host <> v_bee THEN
    RAISE EXCEPTION 'only the call host can seal keys' USING errcode='42501'; END IF;
  -- monotonic: an epoch may repeat (re-seal to a late joiner) but never go backwards
  IF coalesce(p_epoch,0) < coalesce(v_cur,0) THEN
    RAISE EXCEPTION 'call key epoch must not go backwards'; END IF;
  FOR v_row IN SELECT jsonb_array_elements(p_wrapped) LOOP
    IF coalesce(nullif(v_row->>'ephemeral_pubkey',''),'') <> '' THEN
      INSERT INTO public.comms_call_keys(call_room_id, key_epoch, recipient_ephemeral_pubkey, wrapped_key, wrapped_by)
        VALUES (p_room_id, coalesce(p_epoch,1), v_row->>'ephemeral_pubkey', v_row->>'wrapped_key', v_bee)
      ON CONFLICT (call_room_id, key_epoch, recipient_ephemeral_pubkey) WHERE recipient_ephemeral_pubkey IS NOT NULL
        DO UPDATE SET wrapped_key = excluded.wrapped_key, wrapped_by = excluded.wrapped_by, created_at = now();
      v_n := v_n + 1;
    ELSIF coalesce(nullif(v_row->>'bee_id',''),'') <> '' THEN
      INSERT INTO public.comms_call_keys(call_room_id, key_epoch, recipient_bee_id, recipient_device_id, wrapped_key, wrapped_by)
        VALUES (p_room_id, coalesce(p_epoch,1), (v_row->>'bee_id')::uuid,
                coalesce(nullif(v_row->>'device_id',''),'legacy'), v_row->>'wrapped_key', v_bee)
      ON CONFLICT (call_room_id, key_epoch, recipient_bee_id, recipient_device_id) WHERE recipient_bee_id IS NOT NULL
        DO UPDATE SET wrapped_key = excluded.wrapped_key, wrapped_by = excluded.wrapped_by, created_at = now();
      v_n := v_n + 1;
    END IF;
  END LOOP;
  UPDATE public.comms_rooms
     SET call_key_epoch = greatest(coalesce(call_key_epoch,0), coalesce(p_epoch,1))
   WHERE id = p_room_id;
  RETURN jsonb_build_object('ok', true, 'count', v_n, 'epoch', coalesce(p_epoch,1));
END; $fn$;

-- ── RLS (read-only policies; ALL writes go through the SECURITY DEFINER RPCs above) ──
ALTER TABLE public.comms_rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_call_keys         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comms_rooms_read ON public.comms_rooms;
CREATE POLICY comms_rooms_read ON public.comms_rooms FOR SELECT USING (
  is_public OR (host_bee_id = auth.uid()) OR public.is_room_participant(id, auth.uid())
  OR ((conversation_id IS NOT NULL) AND public.is_comms_participant(conversation_id, auth.uid()))
);

DROP POLICY IF EXISTS comms_room_parts_read ON public.comms_room_participants;
CREATE POLICY comms_room_parts_read ON public.comms_room_participants FOR SELECT USING (
  public.room_is_public(room_id) OR public.is_room_participant(room_id, auth.uid())
);

DROP POLICY IF EXISTS call_keys_self_read ON public.comms_call_keys;
CREATE POLICY call_keys_self_read ON public.comms_call_keys FOR SELECT USING (recipient_bee_id = auth.uid());

-- Kept for constellation fidelity; dormant in the fork (no anon table grant below, and the
-- fork ships no guest-call client that mints the call_guest_* JWT claims).
DROP POLICY IF EXISTS call_keys_guest_read ON public.comms_call_keys;
CREATE POLICY call_keys_guest_read ON public.comms_call_keys FOR SELECT USING (
  (recipient_ephemeral_pubkey IS NOT NULL)
  AND (recipient_ephemeral_pubkey = (auth.jwt() ->> 'call_guest_pubkey'))
  AND ((call_room_id)::text = (auth.jwt() ->> 'call_guest_room'))
);

-- ── GRANTS — revoke from anon/authenticated by NAME, then grant only what calls.ts needs ──
-- Tables: authenticated reads (RLS gates the rows); writes only via the definer RPCs. Anon: nothing.
REVOKE ALL ON public.comms_rooms, public.comms_room_participants, public.comms_call_keys FROM anon;
REVOKE ALL ON public.comms_rooms, public.comms_room_participants, public.comms_call_keys FROM authenticated;
GRANT SELECT ON public.comms_rooms, public.comms_room_participants, public.comms_call_keys TO authenticated;

-- Helper fns (RLS evaluates these as the querying role): authenticated only.
REVOKE EXECUTE ON FUNCTION public.is_room_participant(uuid,uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.room_is_public(uuid)          FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.is_room_participant(uuid,uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.room_is_public(uuid)          TO authenticated;

-- RPCs: only calls.ts's four, only for authenticated.
REVOKE EXECUTE ON FUNCTION public.comms_room_create(text,uuid,text,text,boolean,integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_room_join(uuid,text)                              FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_room_leave(uuid)                                  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.comms_put_call_keys(uuid,integer,jsonb)                 FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_room_create(text,uuid,text,text,boolean,integer) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_room_join(uuid,text)                              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_room_leave(uuid)                                  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.comms_put_call_keys(uuid,integer,jsonb)                 TO authenticated;

COMMIT;
