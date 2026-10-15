-- WAGGLES_WEBCALLS1 fix (2026-10-14): publish comms_room_participants so a host
-- (native or web) is notified when a joiner's participant row appears and can
-- reseal the call key to include that joiner's device. Without this the host
-- never reseals on join → a joiner (esp. the web endpoint) gets no sealed CCK →
-- "could not establish encryption".
ALTER TABLE public.comms_room_participants REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comms_room_participants;
