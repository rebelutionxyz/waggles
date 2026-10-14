-- WAGGLES_ROOMLIFECYCLE2 — background reaper every 2 min (defense in depth; the
-- create-time reap already self-heals on the next call). Requires pg_cron.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('waggles-rooms-reap', '*/2 * * * *', $$SELECT public.comms_rooms_reap()$$);
