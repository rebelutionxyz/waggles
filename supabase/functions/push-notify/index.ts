// ============================================================================
// WAGGLES fork — push-notify edge function.
//
// WAGGLES_PUSH1 (2026-09-29). NATIVE counterpart of TheMANUAL.tech's
// push-send-message (which sends Web Push via VAPID). React Native uses the Expo
// push service instead, so the transport differs; the SHAPE is mirrored exactly:
// caller-auth check, service-role lookups, verify the message is really the
// caller's, content-blind payload, stale-token cleanup.
//
// CONTENT-BLIND BY CONSTRUCTION: comms_send enforces is_encrypted=true, so this
// function never has plaintext. The payload is a GENERIC "New message" — no
// sender handle, no body preview, nothing. The only routing datum is the
// conversation id in data{}, used by the client to deep-link on tap.
//
// CLIENT-INVOKED, fire-and-forget, right after a successful comms_send
// (src/lib/push.ts → notifyNewMessage), mirroring the constellation's
// push-send / push-send-message client-invoke precedent — NOT a DB trigger.
//
// DEPLOY IS OWNER/LEAD-GATED (DEPLOY AMENDMENT): ships to the FORK project
// fzmuobbboknhvpkqetxn, NOT the constellation. Requires the fork project's own
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. No third-party
// secret: the Expo push endpoint needs no server key for Expo push tokens.
// A self-hoster who doesn't want push simply never deploys this function and
// leaves PUSH_ENABLED false in the client.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "missing authorization" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "invalid token" }, 401);
    const senderId = user.id;

    const { conversation_id, message_id } = await req.json().catch(() => ({}));
    if (!conversation_id || !message_id) {
      return json({ error: "conversation_id and message_id required" }, 400);
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // The message must be real, in this conversation, and actually the caller's —
    // otherwise a bare token + arbitrary ids lets anyone ping a room.
    const { data: msg } = await svc
      .from("comms_messages")
      .select("id, sender_bee_id")
      .eq("id", message_id)
      .eq("conversation_id", conversation_id)
      .maybeSingle();
    if (!msg || msg.sender_bee_id !== senderId) return json({ ok: true, sent: 0 });

    // Every OTHER participant of the conversation.
    const { data: parts } = await svc
      .from("comms_participants")
      .select("bee_id")
      .eq("conversation_id", conversation_id)
      .neq("bee_id", senderId);
    const beeIds = (parts ?? []).map((p: { bee_id: string }) => p.bee_id);
    if (!beeIds.length) return json({ ok: true, sent: 0 });

    const { data: toks } = await svc
      .from("bee_push_tokens")
      .select("token")
      .in("bee_id", beeIds);
    const tokens = (toks ?? []).map((t: { token: string }) => t.token);
    if (!tokens.length) return json({ ok: true, sent: 0 });

    // Content-blind payload: generic text; the conversation id is the only datum,
    // used solely for the deep-link on tap.
    const messages = tokens.map((to) => ({
      to,
      title: "Waggles",
      body: "New message",
      sound: "default",
      channelId: "messages",
      data: { conversation_id },
    }));

    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });
    const result = await resp.json().catch(() => ({}));

    // Expo returns a per-message ticket array; a DeviceNotRegistered error means
    // the token is dead — delete it so the table self-heals.
    const tickets: Array<{ status?: string; details?: { error?: string } }> =
      Array.isArray(result?.data) ? result.data : [];
    const stale: string[] = [];
    tickets.forEach((tk, i) => {
      if (tk?.status === "error" && tk?.details?.error === "DeviceNotRegistered") {
        stale.push(tokens[i]);
      }
    });
    if (stale.length) {
      await svc.from("bee_push_tokens").delete().in("token", stale);
    }

    const sent = tickets.filter((tk) => tk?.status === "ok").length || tokens.length;
    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
