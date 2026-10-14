-- WAGGLES_ROOMLIFECYCLE2 (2026-10-14) — participant heartbeat + freshness-based
-- liveness. Closes the "crashed-host-looks-present" hole: a force-closed app stops
-- heart-beating, its participant row goes stale within 45s, and the room is then
-- treated as dead (reaped / recreated) instead of stranding the next caller.
ALTER TABLE public.comms_room_participants
  ADD COLUMN IF NOT EXISTS last_seen timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.comms_room_heartbeat(p_room_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_bee uuid := auth.uid();
BEGIN
  IF v_bee IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode='28000'; END IF;
  UPDATE public.comms_room_participants SET last_seen = now()
   WHERE room_id = p_room_id AND bee_id = v_bee AND left_at IS NULL;
END;
$function$;

-- End any live call/roulette room with NO fresh participant. "No fresh participant"
-- (not "host not fresh") so a live multi-party call whose host crashed is NOT killed
-- out from under the people still on it.
CREATE OR REPLACE FUNCTION public.comms_rooms_reap(p_conversation_id uuid DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(r.id) INTO v_ids
    FROM public.comms_rooms r
   WHERE r.status='live' AND r.kind IN ('call','roulette')
     AND (p_conversation_id IS NULL OR r.conversation_id = p_conversation_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.comms_room_participants p
        WHERE p.room_id = r.id AND p.left_at IS NULL
          AND p.last_seen > now() - interval '45 seconds');
  IF v_ids IS NULL THEN RETURN 0; END IF;
  UPDATE public.comms_rooms SET status='ended', ended_at=now() WHERE id = ANY(v_ids);
  UPDATE public.comms_room_participants SET left_at = now()
   WHERE room_id = ANY(v_ids) AND left_at IS NULL;
  RETURN array_length(v_ids, 1);
END;
$function$;

-- room_join: refresh last_seen on (re)join
CREATE OR REPLACE FUNCTION public.comms_room_join(p_room_id uuid, p_role text DEFAULT 'listener'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  IF v_kind = 'call' THEN
    SELECT count(*) INTO v_active FROM public.comms_room_participants
      WHERE room_id = p_room_id AND left_at IS NULL AND bee_id <> v_bee;
    IF v_active >= coalesce(v_max, 8) THEN
      RAISE EXCEPTION '%', format('This call is full — up to %s people can be on a call at once.', coalesce(v_max, 8));
    END IF;
  END IF;
  INSERT INTO public.comms_room_participants (room_id, bee_id, role)
  VALUES (p_room_id, v_bee, coalesce(p_role,'listener'))
  ON CONFLICT (room_id, bee_id) DO UPDATE SET left_at = NULL, joined_at = now(), last_seen = now();
  SELECT role INTO v_role FROM public.comms_room_participants
   WHERE room_id = p_room_id AND bee_id = v_bee;
  RETURN jsonb_build_object('room_id', p_room_id, 'livekit_room', v_lk, 'role', v_role);
END; $function$;

-- room_create: reap dead rooms for this conversation first, and base the "genuine
-- live" test on a FRESH participant (not just a left_at IS NULL row).
CREATE OR REPLACE FUNCTION public.comms_room_create(p_kind text, p_conversation_id uuid DEFAULT NULL::uuid, p_atom_id text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_is_public boolean DEFAULT NULL::boolean, p_max integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bee uuid := auth.uid(); v_id uuid := gen_random_uuid();
  v_lk text; v_pub boolean; v_existing_id uuid; v_existing_lk text; v_other uuid;
  v_existing_host uuid; v_live boolean;
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
    PERFORM public.comms_rooms_reap(p_conversation_id);
    SELECT id, livekit_room, host_bee_id INTO v_existing_id, v_existing_lk, v_existing_host
      FROM public.comms_rooms
      WHERE kind='call' AND conversation_id = p_conversation_id AND status='live'
      ORDER BY started_at DESC LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_host = v_bee THEN
        INSERT INTO public.comms_room_participants (room_id, bee_id, role)
          VALUES (v_existing_id, v_bee, 'host')
          ON CONFLICT (room_id, bee_id) DO UPDATE SET left_at = NULL, joined_at = now(), last_seen = now();
        RETURN jsonb_build_object('room_id', v_existing_id, 'livekit_room', v_existing_lk,
          'is_public', false, 'reused', true, 'host', true);
      END IF;

      SELECT EXISTS(
        SELECT 1 FROM public.comms_room_participants
         WHERE room_id = v_existing_id AND left_at IS NULL
           AND last_seen > now() - interval '45 seconds'
      ) INTO v_live;

      IF v_live THEN
        INSERT INTO public.comms_room_participants (room_id, bee_id, role)
          VALUES (v_existing_id, v_bee, 'speaker')
          ON CONFLICT (room_id, bee_id) DO UPDATE SET left_at = NULL, joined_at = now(), last_seen = now();
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

GRANT EXECUTE ON FUNCTION public.comms_room_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comms_rooms_reap(uuid) TO authenticated;
