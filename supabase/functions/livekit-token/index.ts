// ============================================================================
// WAGGLES fork — livekit-token edge function.
//
// WAGGLES_CALLS1 (2026-09-28). VERBATIM-mirror of TheMANUAL.tech's livekit-token
// (the constellation copy, recovered pass OPS55) — the fork keeps the SAME comms
// schema + RPC/room shape (WAGGLES_CONCEPT v0.10: separate entity, shared tech),
// so the authorization logic is identical. ZERO .talk / constellation branding;
// it reads only THIS (fork) project's own env.
//
// DEPLOY IS OWNER/LEAD-GATED (DEPLOY AMENDMENT): this function ships to the FORK
// backend project fzmuobbboknhvpkqetxn, NOT the constellation. LEAD applies fork
// DB + deploys fork functions. Required secrets in the fork project (owner sets
// them — the owner is creating a separate Waggles LiveKit Cloud project):
//   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
// plus the project's own SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
// Nothing here points at the constellation — a self-hoster's own project + own
// LiveKit is the only backend this contacts (WAGGLES_FORK_PLAN v0.2 self-host law).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2.15.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LK_KEY = Deno.env.get("LIVEKIT_API_KEY")?.trim();
const LK_SECRET = Deno.env.get("LIVEKIT_API_SECRET")?.trim();
const LK_URL = Deno.env.get("LIVEKIT_URL")?.trim();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!LK_KEY || !LK_SECRET || !LK_URL) {
      return json(
        { error: "LiveKit not configured. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL." },
        503,
      );
    }
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    // 1) Identify the caller from their Supabase JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "invalid token" }, 401);
    const beeId = user.id;

    const { room_id } = await req.json().catch(() => ({}));
    if (!room_id) return json({ error: "room_id required" }, 400);

    // 2) Authorize against the DB with the service role.
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: room, error: rErr } = await svc
      .from("comms_rooms")
      .select("id, livekit_room, status, kind")
      .eq("id", room_id)
      .single();
    if (rErr || !room) return json({ error: "room not found" }, 404);
    if (room.status !== "live") return json({ error: "room ended" }, 409);

    const { data: part } = await svc
      .from("comms_room_participants")
      .select("role, left_at")
      .eq("room_id", room_id)
      .eq("bee_id", beeId)
      .maybeSingle();
    if (!part || part.left_at) return json({ error: "not a participant" }, 403);

    // 3) Role -> publish rights. Listeners subscribe only.
    const canPublish = room.kind === "roulette" ||
      part.role === "host" || part.role === "speaker";

    // 4) Mint the LiveKit token, scoped to this room only.
    const at = new AccessToken(LK_KEY, LK_SECRET, { identity: beeId, ttl: "6h" });
    at.addGrant({
      roomJoin: true,
      room: room.livekit_room,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();

    return json({ token, url: LK_URL, room: room.livekit_room, can_publish: canPublish });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
