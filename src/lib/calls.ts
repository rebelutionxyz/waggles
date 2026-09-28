/* ============================================================
   Waggles — calls data layer (WAGGLES_CALLS1). Direct-RPC over the fork's own
   comms_* schema (WAGGLES_CONCEPT v0.10: separate entity, shared tech). Mirrors
   REBELUTION.talk's calls.ts room + CCK client, adapted to Waggles' getSupabase()
   client and the CCK crypto already in ./e2ee (CALL_KEY_LIB1, byte-identical).

   E2EE HARD-ON: the media key is a per-call CCK (generateCallKey), sealed to
   ROOM participants' device keys (sealCallKeyTo → comms_put_call_keys) and fed to
   LiveKit's key provider as callKeyToLiveKit(cck). A device with no sealed key
   REFUSES to join — never a plaintext call (WAGGLES_CONCEPT metadata-truth + the
   TALK E2EE-or-nothing posture). Nothing here points at the constellation; every
   call goes through the operator's OWN fork backend + LiveKit (the token edge fn).

   LIVE ONLY — off a live host these throw, never a silent fallback.
   ============================================================ */

import { getSupabase } from './supabase';
import {
  callKeyToLiveKit,
  ensureIdentity,
  generateCallKey,
  getDeviceId,
  openCallKey,
  sealCallKeyTo,
} from './e2ee';

/** Group-call ceiling (CALLS_MULTI_MF v0.1 §C; parity with TALK_MULTI1). */
export const CALL_MAX_PARTICIPANTS = 8;

export interface RoomToken {
  token: string;
  url: string;
  canPublish: boolean;
}

async function myBeeId(): Promise<string> {
  const { data } = await getSupabase().auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error('Sign in to start a call.');
  return id;
}

/** base64 (standard, padded) -> bytes; public keys are plain base64. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Create a call room (comms_room_create). conversationId null = a standalone
 *  room (e.g. a 1:1 started from a thread reuses its conversation). Host auto-added. */
export async function createCallRoom(
  conversationId: string | null,
  kind: 'call' = 'call',
): Promise<{ roomId: string; livekitRoom: string; host: boolean }> {
  const { data, error } = await getSupabase().rpc('comms_room_create', {
    p_kind: kind,
    p_conversation_id: conversationId,
    p_atom_id: null,
    p_title: null,
    p_is_public: false,
    p_max: CALL_MAX_PARTICIPANTS,
  });
  if (error) throw error;
  const r = data as { room_id: string; livekit_room: string; reused?: boolean };
  if (!r?.room_id) throw new Error('comms_room_create returned no room id.');
  // reused=true means a live room already existed (someone else is host) → I join;
  // reused=false means I created it → I am the host (I seal the first key).
  return { roomId: r.room_id, livekitRoom: r.livekit_room, host: !r.reused };
}

export async function joinRoom(roomId: string, role = 'speaker'): Promise<void> {
  const { error } = await getSupabase().rpc('comms_room_join', { p_room_id: roomId, p_role: role });
  if (error) throw error;
}

export async function leaveRoom(roomId: string): Promise<void> {
  await getSupabase().rpc('comms_room_leave', { p_room_id: roomId });
}

/** Mint a room-scoped LiveKit token via the fork's livekit-token edge fn. The
 *  caller must already be a comms_room_participants row. */
export async function getRoomToken(roomId: string): Promise<RoomToken> {
  const { data, error } = await getSupabase().functions.invoke('livekit-token', {
    body: { room_id: roomId },
  });
  if (error) throw error;
  const r = data as { token?: string; url?: string; can_publish?: boolean; error?: string } | null;
  if (!r?.token) throw new Error(r?.error || 'no token returned');
  return { token: r.token, url: r.url ?? '', canPublish: !!r.can_publish };
}

/** Current sealed-key epoch for a room (0 = nothing sealed yet). */
export async function currentCallEpoch(roomId: string): Promise<number> {
  const { data } = await getSupabase()
    .from('comms_rooms')
    .select('call_key_epoch')
    .eq('id', roomId)
    .maybeSingle();
  return (data as { call_key_epoch?: number } | null)?.call_key_epoch ?? 0;
}

/** Every bee_id currently in the room (left_at IS NULL) — the seal target set. */
export async function roomMemberBeeIds(roomId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('comms_room_participants')
    .select('bee_id')
    .eq('room_id', roomId)
    .is('left_at', null);
  if (error || !data) return [];
  return [...new Set((data as { bee_id: string }[]).map((r) => r.bee_id))];
}

/**
 * HOST: mint a fresh CCK, seal it to every CURRENT room participant's device
 * keys at `epoch`, persist via comms_put_call_keys, and return the LiveKit key
 * string. Reseal (epoch+1) on join keys a newcomer; on leave/kick it drops them
 * (roomMemberBeeIds is left_at IS NULL) = forward secrecy. Throws if no keys.
 */
export async function hostSealRoomCallKey(roomId: string, hostBeeId: string, epoch: number): Promise<string> {
  const memberIds = await roomMemberBeeIds(roomId);
  const ids = [...new Set([hostBeeId, ...memberIds])];
  const { data: keyRows, error } = await getSupabase()
    .from('bee_keys')
    .select('bee_id, device_id, public_key')
    .in('bee_id', ids);
  if (error) throw error;
  const rows = (keyRows ?? []) as { bee_id: string; device_id: string | null; public_key: string }[];
  if (!rows.length) throw new Error('No device keys to seal the call key to.');
  const cck = await generateCallKey();
  const pubkeys = rows.map((r) => b64ToBytes(r.public_key));
  const wrappedKeys = await sealCallKeyTo(pubkeys, cck);
  const wrapped = rows.map((r, i) => ({ bee_id: r.bee_id, device_id: r.device_id ?? 'legacy', wrapped_key: wrappedKeys[i] }));
  const { error: putErr } = await getSupabase().rpc('comms_put_call_keys', {
    p_room_id: roomId,
    p_epoch: epoch,
    p_wrapped: wrapped,
  });
  if (putErr) throw putErr;
  return callKeyToLiveKit(cck);
}

/**
 * JOINER: read my sealed row for the CURRENT epoch and open it to the LiveKit key
 * string. null = no row sealed to this device yet (a rotation the host has not
 * finished, or not a member) — the caller polls briefly; NEVER a plaintext join.
 */
export async function fetchMyCallKey(roomId: string, meBeeId: string): Promise<{ key: string; epoch: number } | null> {
  const epoch = await currentCallEpoch(roomId);
  if (epoch < 1) return null;
  const deviceId = await getDeviceId();
  const { data } = await getSupabase()
    .from('comms_call_keys')
    .select('wrapped_key')
    .eq('call_room_id', roomId)
    .eq('key_epoch', epoch)
    .eq('recipient_bee_id', meBeeId)
    .in('recipient_device_id', [deviceId, 'legacy'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const wrapped = (data as { wrapped_key?: string } | null)?.wrapped_key;
  if (!wrapped) return null;
  const id = await ensureIdentity(meBeeId);
  const cck = await openCallKey(wrapped, id.publicKey, id.privateKey);
  if (!cck) return null;
  return { key: await callKeyToLiveKit(cck), epoch };
}

export async function awaitMyCallKey(
  roomId: string,
  meBeeId: string,
  tries = 10,
  gapMs = 300,
): Promise<{ key: string; epoch: number } | null> {
  for (let i = 0; i < tries; i++) {
    const got = await fetchMyCallKey(roomId, meBeeId);
    if (got) return got;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
}

// ── incoming-call ring (WAGGLES_CALL_RING1) ──────────────────────────────────
// The fork has no notifications (stripped in the calls migration). Instead the
// callee learns of a call via realtime on comms_rooms: RLS lets a CONVERSATION
// MEMBER read the room (comms_rooms_read: is_comms_participant(conversation_id)),
// so a live 'call' room created by someone else in a shared conversation is
// delivered here. The caller is filtered out client-side (host_bee_id === me).

export interface IncomingCallEvent {
  roomId: string;
  hostBeeId: string;
  status: string;
  kind: string;
  startedAt: string;
}

export function subscribeIncomingCalls(
  meBeeId: string,
  onEvent: (e: IncomingCallEvent) => void,
): { close: () => void } {
  const ch = getSupabase()
    .channel(`incoming-calls:${meBeeId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comms_rooms' },
      (payload: { new?: Record<string, unknown> }) => {
        const r = (payload.new ?? {}) as {
          id?: string;
          host_bee_id?: string;
          status?: string;
          kind?: string;
          started_at?: string;
        };
        if (!r.id) return;
        onEvent({
          roomId: r.id,
          hostBeeId: r.host_bee_id ?? '',
          status: r.status ?? '',
          kind: r.kind ?? '',
          startedAt: r.started_at ?? '',
        });
      },
    )
    .subscribe();
  return { close: () => void getSupabase().removeChannel(ch) };
}

/** The caller's @handle for the ring, or null. */
export async function callerHandle(hostBeeId: string): Promise<string | null> {
  if (!hostBeeId) return null;
  const { data } = await getSupabase().from('profiles').select('handle').eq('id', hostBeeId).maybeSingle();
  return (data as { handle?: string } | null)?.handle ?? null;
}

export { myBeeId };
