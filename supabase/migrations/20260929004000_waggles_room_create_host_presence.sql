-- WAGGLES_ROOMLIFECYCLE1 (2026-10-14)
-- Fix comms_room_create reuse so the creator is never stranded on the joiner path
-- with no host-sealed key. Only the host can seal the call CCK
-- (comms_put_call_keys enforces host_bee_id = auth.uid()), so reuse must key on
-- HOST PRESENCE, not "a live row exists":
--   * caller IS the room's host              -> resume as host (host:true); client
--                                               reseals at currentEpoch+1.
--   * host present (left_at IS NULL) & != me -> genuine live room; join as speaker
--                                               (host:false); host reseals on roster.
--   * host gone                              -> dead room (app closed/crashed left it
--                                               status='live'); end it + mark lingering
--                                               participants left, fall through to a
--                                               FRESH room the caller hosts.
-- The RETURN now always carries an explicit 'host' boolean the client trusts.
CREATE OR REPLACE FUNCTION public.comms_room_create(p_kind text, p_conversation_id uuid DEFAULT NULL::uuid, p_atom_id text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_is_public boolean DEFAULT NULL::boolean, p_max integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bee uuid := auth.uid(); v_id uuid := gen_random_uuid();
  v_lk text; v_pub boolean; v_existing_id uuid; v_existing_lk text; v_other uuid;
  v_existing_host uuid; v_host_present boolean;
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
    SELECT id, livekit_room, host_bee_id INTO v_existing_id, v_existing_lk, v_existing_host
      FROM public.comms_rooms
      WHERE kind='call' AND conversation_id = p_conversation_id AND status='live'
      ORDER BY started_at DESC LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_host = v_bee THEN
        INSERT INTO public.comms_room_participants (room_id, bee_id, role)
          VALUES (v_existing_id, v_bee, 'host')
          ON CONFLICT (room_id, bee_id) DO UPDATE SET left_at = NULL, joined_at = now();
        RETURN jsonb_build_object('room_id', v_existing_id, 'livekit_room', v_existing_lk,
          'is_public', false, 'reused', true, 'host', true);
      END IF;

      SELECT EXISTS(
        SELECT 1 FROM public.comms_room_participants
         WHERE room_id = v_existing_id AND bee_id = v_existing_host AND left_at IS NULL
      ) INTO v_host_present;

      IF v_host_present THEN
        INSERT INTO public.comms_room_participants (room_id, bee_id, role)
          VALUES (v_existing_id, v_bee, 'speaker')
          ON CONFLICT (room_id, bee_id) DO UPDATE SET left_at = NULL, joined_at = now();
        RETURN jsonb_build_object('room_id', v_existing_id, 'livekit_room', v_existing_lk,
          'is_public', false, 'reused', true, 'host', false);
      END IF;

      UPDATE public.comms_rooms SET status='ended', ended_at=now() WHERE id = v_existing_id;
      UPDATE public.comms_room_participants SET left_at = now()
        WHERE room_id = v_existing_id AND left_at IS NULL;
    END IF;
  END IF;

  v_lk := 'wg_'||replace(v_id::text,'-','');
  v_pub := coalesce(p_is_public, p_kind='space');
  INSERT INTO public.comms_rooms (id, kind, conversation_id, atom_id, title, host_bee_id, livekit_room, status, is_public, max_participants, started_at)
  VALUES (v_id, p_kind, p_conversation_id, p_atom_id, p_title, v_bee, v_lk, 'live', v_pub, p_max, now());
  INSERT INTO public.comms_room_participants (room_id, bee_id, role) VALUES (v_id, v_bee, 'host');

  RETURN jsonb_build_object('room_id', v_id, 'livekit_room', v_lk, 'is_public', v_pub, 'reused', false, 'host', true);
END;
$function$;
