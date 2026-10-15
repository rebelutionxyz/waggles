/* ============================================================
   Waggles web — calls data layer (WAGGLES_WEBCALLS1, 2026-10-14).

   Ported from REBELUTION.talk/src/lib/calls.ts, rewired to the Waggles fork
   backend:
     - The incoming-call RING is comms_rooms realtime (the fork has NO
       notifications table; mirrors the native app's subscribeIncomingCalls):
       RLS lets a conversation member read a 'call' room created in that
       conversation, so a live room insert reaches the callee.
     - Room lifecycle is WAGGLES_ROOMLIFECYCLE1/2: comms_room_create returns an
       explicit `host` flag (host-presence reuse), the host seals at
       currentEpoch+1 (monotonic), and a live participant heartbeats
       comms_room_heartbeat so a closed tab/app is reaped.
   E2EE hard-on: a device with no sealed CCK REFUSES to join — never plaintext.
   LIVE ONLY — off a live backend every export throws or no-ops.
   ============================================================ */

import { DATA_SOURCE } from '@/lib/data/provider';
import { getBrowserClient } from '@/lib/supabase/client';
import {
  callKeyToLiveKit,
  ensureIdentity,
  generateCallKey,
  getConversationKey,
  getDeviceId,
  openCallKey,
  sealCallKeyTo,
} from '@/lib/e2ee';

const LIVE_ONLY = 'Calls are only available on the live deployment.';

/** Group-call ceiling (parity with native CALL_MAX_PARTICIPANTS + TALK_MULTI1). */
export const CALL_MAX_PARTICIPANTS = 8;

function req() {
  return getBrowserClient();
}

export interface RoomToken {
  token: string;
  url: string;
  canPublish: boolean;
}

/** base64 (standard, padded) -> bytes; public keys are plain base64. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pre-flight: does THIS device have the conversation key (is it linked)? A
 *  host with no conversation key can't be trusted to seal; refuse up front. */
export async function hasCallEncryption(conversationId: string, myBeeId: string): Promise<boolean> {
  const ck = await getConversationKey(myBeeId, conversationId).catch(() => null);
  return ck !== null;
}

/** Start (or reuse) a call room bound to a conversation. Returns the server's
 *  explicit host flag (WAGGLES_ROOMLIFECYCLE1): true = I seal; false = I join a
 *  live room someone present hosts. */
export async function createCallRoom(
  conversationId: string,
  mode: 'video' | 'audio' = 'video',
): Promise<{ roomId: string; host: boolean }> {
  if (DATA_SOURCE !== 'live') throw new Error(LIVE_ONLY);
  const { data, error } = await req().rpc('comms_room_create', {
    p_kind: 'call',
    p_conversation_id: conversationId,
    p_atom_id: null,
    p_title: mode,
    p_is_public: null,
    p_max: CALL_MAX_PARTICIPANTS,
  });
  if (error) throw error;
  const r = data as { room_id?: string; reused?: boolean; host?: boolean } | null;
  if (!r?.room_id) throw new Error('comms_room_create returned no room id.');
  const host = typeof r.host === 'boolean' ? r.host : !r.reused;
  return { roomId: r.room_id, host };
}

export async function joinRoom(
  roomId: string,
  role: 'host' | 'speaker' | 'listener' = 'speaker',
): Promise<void> {
  if (DATA_SOURCE !== 'live') throw new Error(LIVE_ONLY);
  const { error } = await req().rpc('comms_room_join', { p_room_id: roomId, p_role: role });
  if (error) throw error;
}

export async function leaveRoom(roomId: string): Promise<void> {
  if (DATA_SOURCE !== 'live') return;
  await req().rpc('comms_room_leave', { p_room_id: roomId }).then(() => {}, () => {});
}

/** Liveness heartbeat (WAGGLES_ROOMLIFECYCLE2) — ping every ~15s from the call
 *  screen so a crashed/closed tab is reaped and never strands a future caller. */
export async function roomHeartbeat(roomId: string): Promise<void> {
  if (DATA_SOURCE !== 'live') return;
  await req().rpc('comms_room_heartbeat', { p_room_id: roomId }).then(() => {}, () => {});
}

/** Mint a LiveKit token for a room (caller must already be a participant). */
export async function getRoomToken(roomId: string): Promise<RoomToken> {
  if (DATA_SOURCE !== 'live') throw new Error(LIVE_ONLY);
  const client = req();
  const { data: roomRow } = await client
    .from('comms_rooms')
    .select('max_participants')
    .eq('id', roomId)
    .maybeSingle();
  const cap =
    (roomRow as { max_participants?: number | null } | null)?.max_participants ??
    CALL_MAX_PARTICIPANTS;
  const { count } = await client
    .from('comms_room_participants')
    .select('bee_id', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .is('left_at', null);
  if (typeof count === 'number' && count > cap) {
    throw new Error(`This call is full — up to ${cap} people can be on a call at once.`);
  }
  const { data, error } = await client.functions.invoke('livekit-token', {
    body: { room_id: roomId },
  });
  if (error) throw error;
  const r = data as { token?: string; url?: string; can_publish?: boolean; error?: string } | null;
  if (!r?.token) throw new Error(r?.error || 'no token returned');
  return { token: r.token, url: r.url ?? '', canPublish: !!r.can_publish };
}

export async function conversationIsGroup(conversationId: string): Promise<boolean> {
  if (DATA_SOURCE !== 'live') return false;
  const { data } = await req()
    .from('comms_conversations')
    .select('kind')
    .eq('id', conversationId)
    .maybeSingle();
  return (data as { kind?: string } | null)?.kind === 'group';
}

/** beeId -> @handle for the in-call roster (profiles.handle; the fork has no
 *  `bees` table). Best-effort — an empty map just means generic labels. */
export async function listRoomHandles(roomId: string): Promise<Record<string, string>> {
  if (DATA_SOURCE !== 'live') return {};
  const { data: parts } = await req()
    .from('comms_room_participants')
    .select('bee_id')
    .eq('room_id', roomId);
  const ids = [...new Set(((parts ?? []) as { bee_id: string }[]).map((r) => r.bee_id))];
  if (!ids.length) return {};
  const { data: profs } = await req().from('profiles').select('id, handle').in('id', ids);
  const map: Record<string, string> = {};
  for (const p of (profs ?? []) as { id: string; handle: string | null }[]) {
    if (p.handle) map[p.id] = p.handle;
  }
  return map;
}

// ── CCK (per-call sealed media key) — bee participants ───────────────────────

export async function listConversationMemberBeeIds(conversationId: string): Promise<string[]> {
  if (DATA_SOURCE !== 'live') return [];
  const { data, error } = await req()
    .from('comms_participants')
    .select('bee_id')
    .eq('conversation_id', conversationId);
  if (error || !data) return [];
  return [...new Set((data as { bee_id: string }[]).map((r) => r.bee_id))];
}

export async function currentCallEpoch(roomId: string): Promise<number> {
  if (DATA_SOURCE !== 'live') return 0;
  const { data } = await req()
    .from('comms_rooms')
    .select('call_key_epoch')
    .eq('id', roomId)
    .maybeSingle();
  return (data as { call_key_epoch?: number } | null)?.call_key_epoch ?? 0;
}

/** HOST: mint a fresh CCK, seal it to every conversation member's device keys at
 *  `epoch`, persist via comms_put_call_keys, return the LiveKit setKey string.
 *  comms_put_call_keys enforces host-only + monotonic epoch. */
export async function hostSealNewCallKey(
  conversationId: string,
  roomId: string,
  myBeeId: string,
  epoch: number,
): Promise<string> {
  if (DATA_SOURCE !== 'live') throw new Error(LIVE_ONLY);
  const memberIds = await listConversationMemberBeeIds(conversationId);
  const ids = [...new Set([myBeeId, ...memberIds])];
  const { data: keyRows, error } = await req()
    .from('bee_keys')
    .select('bee_id, device_id, public_key')
    .in('bee_id', ids);
  if (error) throw error;
  const rows = (keyRows ?? []) as { bee_id: string; device_id: string | null; public_key: string }[];
  if (!rows.length) throw new Error('No device keys to seal the call key to.');
  const cck = await generateCallKey();
  const pubkeys = rows.map((r) => b64ToBytes(r.public_key));
  const wrappedKeys = await sealCallKeyTo(pubkeys, cck);
  const wrapped = rows.map((r, i) => ({
    bee_id: r.bee_id,
    device_id: r.device_id ?? 'legacy',
    wrapped_key: wrappedKeys[i],
  }));
  const { error: putErr } = await req().rpc('comms_put_call_keys', {
    p_room_id: roomId,
    p_epoch: epoch,
    p_wrapped: wrapped,
  });
  if (putErr) throw putErr;
  return callKeyToLiveKit(cck);
}

/** JOINER: read my sealed row for the current epoch and open it. null = not yet
 *  sealed to this device (host still sealing, or not a member) — poll; never
 *  falls back to plaintext. */
export async function fetchMyCallKey(
  roomId: string,
  myBeeId: string,
): Promise<{ key: string; epoch: number } | null> {
  if (DATA_SOURCE !== 'live') return null;
  const epoch = await currentCallEpoch(roomId);
  if (epoch < 1) return null;
  const deviceId = await getDeviceId();
  const { data } = await req()
    .from('comms_call_keys')
    .select('wrapped_key')
    .eq('call_room_id', roomId)
    .eq('key_epoch', epoch)
    .eq('recipient_bee_id', myBeeId)
    .in('recipient_device_id', [deviceId, 'legacy'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const wrapped = (data as { wrapped_key?: string } | null)?.wrapped_key;
  if (!wrapped) return null;
  const id = await ensureIdentity(myBeeId);
  const cck = await openCallKey(wrapped, id.publicKey, id.privateKey);
  if (!cck) return null;
  return { key: await callKeyToLiveKit(cck), epoch };
}

export async function awaitMyCallKey(
  roomId: string,
  myBeeId: string,
  tries = 12,
  gapMs = 300,
): Promise<{ key: string; epoch: number } | null> {
  for (let i = 0; i < tries; i++) {
    const got = await fetchMyCallKey(roomId, myBeeId);
    if (got) return got;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
}

// ── incoming-call ring (comms_rooms realtime; no notifications table) ─────────

export interface IncomingCallEvent {
  roomId: string;
  hostBeeId: string;
  status: string;
  kind: string;
  conversationId: string | null;
  title: string | null;
  startedAt: string;
}

export function subscribeIncomingCalls(
  onEvent: (e: IncomingCallEvent) => void,
): { close: () => void } {
  const client = getBrowserClient();
  let live = true;
  void client.auth.getSession().then(({ data }) => {
    if (!live || !data.session?.access_token) return;
    client.realtime.setAuth(data.session.access_token);
  });
  const ch = client
    .channel(`incoming-calls:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comms_rooms' },
      (payload: { new?: Record<string, unknown> }) => {
        const r = (payload.new ?? {}) as {
          id?: string;
          host_bee_id?: string;
          status?: string;
          kind?: string;
          conversation_id?: string;
          title?: string;
          started_at?: string;
        };
        if (!r.id) return;
        onEvent({
          roomId: r.id,
          hostBeeId: r.host_bee_id ?? '',
          status: r.status ?? '',
          kind: r.kind ?? '',
          conversationId: r.conversation_id ?? null,
          title: r.title ?? null,
          startedAt: r.started_at ?? '',
        });
      },
    )
    .subscribe();
  return { close: () => { live = false; void client.removeChannel(ch); } };
}

/** The caller's @handle for the ring, or null. */
export async function callerHandle(hostBeeId: string): Promise<string | null> {
  if (!hostBeeId) return null;
  const { data } = await req().from('profiles').select('handle').eq('id', hostBeeId).maybeSingle();
  return (data as { handle?: string } | null)?.handle ?? null;
}
