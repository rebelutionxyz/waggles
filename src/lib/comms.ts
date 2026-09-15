import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase } from './supabase';
import {
  computeSafetyNumber,
  decryptBody,
  encryptBody,
  ensureIdentity,
  establishConversationKey,
  getConversationKey,
  isEncryptedBody,
  rekeyConversation,
  resealConversationKey,
} from './e2ee';

/**
 * COMMS text layer — NATIVE port of TheMANUAL.tech/src/lib/comms.ts.
 *
 * Typed wrappers over the same comms_* RPCs, end-to-end encrypted through the
 * shared e2ee core. Message bodies are sealed under a per-conversation key before
 * they ever reach `comms_send`; the server stores only ciphertext.
 *
 * Scope note (v1 fork): text, blocks, typing, safety numbers and realtime are
 * ported AND live. Reactions, groups, presence, disappearing messages, mute,
 * reporting and pins are ported but GATED OFF — the fork bundle deliberately
 * ships none of their RPCs (WAGGLES_F3-ACK: v1 MVP is E2EE 1:1 text, keep the
 * self-hostable surface minimal). See the capability flags below. Voice
 * messages, media object-URL playback, and LiveKit rooms/roulette (all of which
 * lean on browser Blob/URL/getUserMedia) are intentionally deferred — see README.
 * PINS are ported but GATED OFF against the fork backend, which does not create
 * `comms_pins` (see the Pins section below).
 */

function req() {
  return getSupabase();
}

// biome-ignore lint: supabase embed rows are shaped at runtime
type Row = any;

export interface CommsParticipant {
  beeId: string;
  handle: string;
  name: string | null;
  lastReadAt: string | null;
  muted: boolean;
  role: string;
}

export interface Conversation {
  id: string;
  kind: string;
  title: string | null;
  createdBy: string | null;
  lastMessageAt: string | null;
  membersCanAdd: boolean;
  disappearSeconds: number | null;
  participants: CommsParticipant[];
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface CommsMessage {
  id: string;
  conversationId: string;
  senderBeeId: string;
  body: string;
  contentType: string;
  encrypted: boolean;
  undecryptable: boolean;
  createdAt: string;
  deletedAt: string | null;
  editedAt: string | null;
  expiresAt: string | null;
  replyToId: string | null;
  reactions: ReactionSummary[];
}

// ── current Bee (encryption context) ──
let currentBeeId: string | null = null;
async function myBee(): Promise<string> {
  if (currentBeeId) return currentBeeId;
  const { data } = await req().auth.getUser();
  currentBeeId = data.user?.id ?? null;
  if (!currentBeeId) throw new Error('not signed in');
  return currentBeeId;
}

/** Call once when COMMS mounts: set the current Bee and publish their E2EE key. */
export async function initComms(beeId: string): Promise<void> {
  currentBeeId = beeId;
  await ensureIdentity(beeId);
}

export function forgetCurrentBee(): void {
  currentBeeId = null;
}

export async function syncConversationKey(conversation: Conversation): Promise<void> {
  const bee = await myBee();
  const members = conversation.participants.map((p) => p.beeId);
  const ck = await getConversationKey(bee, conversation.id);
  if (ck) {
    if (members.length <= 25) {
      try {
        await resealConversationKey(bee, conversation.id, members);
      } catch {
        /* best-effort */
      }
    }
    return;
  }
  if (conversation.createdBy === bee) {
    try {
      await establishConversationKey(bee, conversation.id, members);
    } catch {
      /* locked out — recover via resetConversationEncryption */
    }
  }
}

export async function conversationKeyStatus(
  conversation: Conversation,
): Promise<'ok' | 'locked' | 'pending'> {
  const bee = await myBee();
  const ck = await getConversationKey(bee, conversation.id).catch(() => null);
  if (ck) return 'ok';
  const { count } = await req()
    .from('comms_conversation_keys')
    .select('epoch', { count: 'exact', head: true })
    .eq('bee_id', bee)
    .eq('conversation_id', conversation.id);
  return (count ?? 0) > 0 ? 'locked' : 'pending';
}

export async function resetConversationEncryption(conversation: Conversation): Promise<void> {
  const bee = await myBee();
  const members = conversation.participants.map((p) => p.beeId);
  await rekeyConversation(bee, conversation.id, members);
}

export async function conversationSafetyNumber(conversation: Conversation): Promise<string> {
  return computeSafetyNumber(conversation.participants.map((p) => p.beeId));
}

/**
 * The embedded identity row on `comms_participants` (WAGGLES_F2).
 *
 * The fork resolves this through `profiles`, not `bees`: every `bee_id` in the
 * bundle — participants, messages, blocks, keys — is
 * `references public.profiles(id)`, so that is the relationship PostgREST
 * embeds on, and the column is `display_name` rather than `name`.
 *
 * This was a live break, not a tidy-up: the select below embedded
 * `bees(handle, name)`, a table the fork backend does not have, so
 * `listConversations()` — the chats list, i.e. the app's front door — failed
 * outright against the fork. It survived the first `from('bees')` sweep
 * because a PostgREST embed is not a `.from()` call.
 */
type ProfileEmbed =
  | { handle: string; display_name: string | null }
  | { handle: string; display_name: string | null }[]
  | null;
function oneProfile(p: ProfileEmbed) {
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await req()
    .from('comms_conversations')
    .select(
      'id, kind, title, created_by, last_message_at, members_can_add, disappear_seconds, comms_participants(bee_id, role, last_read_at, muted, profiles(handle, display_name))',
    )
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((row: Row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    createdBy: row.created_by,
    lastMessageAt: row.last_message_at,
    membersCanAdd: !!row.members_can_add,
    disappearSeconds: (row.disappear_seconds as number | null) ?? null,
    participants: (row.comms_participants ?? []).map((p: Row) => {
      const b = oneProfile(p.profiles);
      return {
        beeId: p.bee_id,
        handle: b?.handle ?? 'unknown',
        // `display_name` → `name` is mapped here so the CommsParticipant shape
        // and every UI consumer stay unchanged.
        name: b?.display_name ?? null,
        lastReadAt: p.last_read_at,
        muted: !!p.muted,
        role: p.role ?? 'member',
      };
    }),
  }));
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const all = await listConversations();
  return all.find((c) => c.id === conversationId) ?? null;
}

const MESSAGE_COLUMNS =
  // No `comms_reactions` embed: reactions are gated off (WAGGLES_F3-ACK) and
  // the table is not in the fork bundle, so embedding it would fail the WHOLE
  // message query — i.e. reading any conversation at all.
  'id, conversation_id, sender_bee_id, body, content_type, is_encrypted, created_at, deleted_at, edited_at, expires_at, reply_to_message_id';

async function rowsToMessages(conversationId: string, rows: Row[]): Promise<CommsMessage[]> {
  const bee = await myBee().catch(() => null);
  const ck = bee ? await getConversationKey(bee, conversationId).catch(() => null) : null;

  const out: CommsMessage[] = [];
  for (const m of rows) {
    let body: string = m.body ?? '';
    let undecryptable = false;
    if (m.is_encrypted && isEncryptedBody(m.body)) {
      if (ck) {
        try {
          body = await decryptBody(ck, m.body);
        } catch {
          body = '';
          undecryptable = true;
        }
      } else {
        body = '';
        undecryptable = true;
      }
    }
    const rrows = (m.comms_reactions ?? []) as { bee_id: string; emoji: string }[];
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const r of rrows) {
      const cur = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (bee && r.bee_id === bee) cur.mine = true;
      byEmoji.set(r.emoji, cur);
    }
    out.push({
      id: m.id,
      conversationId: m.conversation_id,
      senderBeeId: m.sender_bee_id,
      body,
      contentType: m.content_type,
      encrypted: !!m.is_encrypted,
      undecryptable,
      createdAt: m.created_at,
      deletedAt: m.deleted_at,
      editedAt: m.edited_at ?? null,
      expiresAt: m.expires_at ?? null,
      replyToId: m.reply_to_message_id ?? null,
      reactions: Array.from(byEmoji, ([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
    });
  }
  return out;
}

export async function listMessages(conversationId: string, limit = 200): Promise<CommsMessage[]> {
  const { data, error } = await req()
    .from('comms_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return rowsToMessages(conversationId, (data ?? []) as Row[]);
}

export async function fetchMessagesPage(
  conversationId: string,
  before?: string | null,
  limit = 200,
): Promise<CommsMessage[]> {
  let q = req()
    .from('comms_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data ?? []) as Row[]).slice().reverse();
  return rowsToMessages(conversationId, rows);
}

async function sendEncrypted(
  conversationId: string,
  plaintext: string,
  contentType: string,
  replyTo?: string | null,
): Promise<string> {
  const bee = await myBee();
  const ck = await getConversationKey(bee, conversationId);
  if (!ck) throw new Error('Encryption is still setting up for this conversation — try again in a moment.');
  const enc = await encryptBody(ck, plaintext);
  const { data, error } = await req().rpc('comms_send', {
    p_conversation_id: conversationId,
    p_body: enc,
    p_content_type: contentType,
    p_is_encrypted: true,
    p_reply_to: replyTo ?? null,
  });
  if (error) throw error;
  return (data as Row)?.message_id ?? '';
}

export async function sendMessage(
  conversationId: string,
  body: string,
  contentType: 'text' | 'media' = 'text',
  replyTo?: string | null,
): Promise<string> {
  return sendEncrypted(conversationId, body, contentType, replyTo);
}

export async function editMessage(messageId: string, conversationId: string, newText: string): Promise<void> {
  const bee = await myBee();
  const ck = await getConversationKey(bee, conversationId);
  if (!ck) throw new Error('Encryption is still setting up for this conversation — try again in a moment.');
  const enc = await encryptBody(ck, newText);
  const { error } = await req().rpc('comms_edit_message', { p_message_id: messageId, p_body: enc });
  if (error) throw error;
}

export async function unsendMessage(messageId: string): Promise<void> {
  const { error } = await req().rpc('comms_delete_message', { p_message_id: messageId });
  if (error) throw error;
}

// ── Capabilities absent from the fork backend (WAGGLES_F3-ACK ruling) ──
//
// The fork ships a deliberately MINIMAL self-hostable schema. Nine RPCs this
// client was ported with are NOT in `db/waggles-core-v0.1/`, each excluded on
// purpose with a named owning pass: groups (not MVP), reactions, disappearing
// messages, mute, report (moderation is an operator policy - on a self-hosted
// instance the operator IS the user), and presence.
//
// v1 MVP is E2EE 1:1 TEXT. LEAD ruled: GATE THE CLIENT, do not widen the
// bundle. Every table a self-hoster must run is a cost paid by everyone who
// runs their own Waggles.
//
// Same asymmetry the pins gate uses, for the same reason: a READ fails soft
// (absent data is honestly "none"), a WRITE fails LOUD (never tell a Bee
// something was saved when no RPC existed to save it). Flip these when a
// bundle version ships the functions.
export const GROUPS_ENABLED = false;
export const REACTIONS_ENABLED = false;
export const DISAPPEARING_ENABLED = false;
export const MUTE_ENABLED = false;
export const REPORTING_ENABLED = false;
export const PRESENCE_ENABLED = false;

const NOT_IN_BUILD = (what: string) => new Error(`${what} is not available in this build.`);

export async function toggleReaction(messageId: string, emoji: string): Promise<void> {
  if (!REACTIONS_ENABLED) throw NOT_IN_BUILD('Reactions');
  const { error } = await req().rpc('comms_react', { p_message_id: messageId, p_emoji: emoji });
  if (error) throw error;
}

export async function startDirect(otherBeeId: string): Promise<string> {
  const { data, error } = await req().rpc('comms_start_direct', { p_other: otherBeeId });
  if (error) throw error;
  const id = (data as Row)?.conversation_id;
  if (!id) throw new Error('comms_start_direct returned no conversation id');
  const created = !!(data as Row)?.created;
  const bee = await myBee();
  try {
    if (created) {
      await establishConversationKey(bee, id, [bee, otherBeeId]);
    } else if (await getConversationKey(bee, id)) {
      await resealConversationKey(bee, id, [bee, otherBeeId]);
    }
  } catch {
    /* key setup is best-effort; syncConversationKey retries on open */
  }
  return id;
}

export async function createGroup(title: string, memberBeeIds: string[]): Promise<string> {
  if (!GROUPS_ENABLED) throw NOT_IN_BUILD('Group conversations');
  const { data, error } = await req().rpc('comms_create_group', {
    p_title: title,
    p_member_bees: memberBeeIds,
  });
  if (error) throw error;
  const id = (data as Row)?.conversation_id;
  if (!id) throw new Error('comms_create_group returned no conversation id');
  const bee = await myBee();
  try {
    await establishConversationKey(bee, id, [bee, ...memberBeeIds]);
  } catch {
    /* best-effort */
  }
  return id;
}

export async function addGroupMember(conversationId: string, beeId: string): Promise<void> {
  if (!GROUPS_ENABLED) throw NOT_IN_BUILD('Group conversations');
  const { error } = await req().rpc('comms_group_add', {
    p_conversation_id: conversationId,
    p_bee_id: beeId,
  });
  if (error) throw error;
  const bee = await myBee();
  const ck = await getConversationKey(bee, conversationId).catch(() => null);
  if (!ck) return;
  try {
    const { data } = await req()
      .from('comms_participants')
      .select('bee_id')
      .eq('conversation_id', conversationId);
    const members = (data ?? []).map((r: Row) => r.bee_id as string);
    if (members.length) await resealConversationKey(bee, conversationId, members);
  } catch {
    /* best-effort */
  }
}

export async function removeGroupMember(conversationId: string, beeId: string): Promise<void> {
  if (!GROUPS_ENABLED) throw NOT_IN_BUILD('Group conversations');
  const { error } = await req().rpc('comms_group_remove', {
    p_conversation_id: conversationId,
    p_bee_id: beeId,
  });
  if (error) throw error;
}

export async function setGroupAddPolicy(conversationId: string, allowed: boolean): Promise<void> {
  if (!GROUPS_ENABLED) throw NOT_IN_BUILD('Group conversations');
  const { error } = await req().rpc('comms_group_set_add_policy', {
    p_conversation_id: conversationId,
    p_allowed: allowed,
  });
  if (error) throw error;
}

export async function markRead(conversationId: string): Promise<void> {
  const { error } = await req().rpc('comms_mark_read', { p_conversation_id: conversationId });
  if (error) throw error;
}

export async function setDisappearing(conversationId: string, seconds: number | null): Promise<void> {
  if (!DISAPPEARING_ENABLED) throw NOT_IN_BUILD('Disappearing messages');
  const { error } = await req().rpc('comms_set_disappearing', {
    p_conversation_id: conversationId,
    p_seconds: seconds,
  });
  if (error) throw error;
}

export async function setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
  if (!MUTE_ENABLED) throw NOT_IN_BUILD('Muting a conversation');
  const { error } = await req().rpc('comms_set_mute', { p_conversation_id: conversationId, p_muted: muted });
  if (error) throw error;
}

export async function leaveConversation(conversationId: string): Promise<void> {
  const { error } = await req().rpc('comms_leave', { p_conversation_id: conversationId });
  if (error) throw error;
}

/**
 * IDENTITY TABLE: `profiles`, NOT `bees` (WAGGLES_F2).
 *
 * The fork's own schema bundle (`db/waggles-core-v0.1/001_schema.sql`) renames
 * the constellation's `bees` to `profiles` — its header calls that "the ONLY
 * identity rename in this bundle" — because `profiles` deliberately carries no
 * email, where the constellation's `bees` has a NOT NULL `email` behind a
 * `USING (true)` read policy. These two functions were still querying
 * `from('bees')`, so against the fork backend they would have failed outright:
 * wrong table, and `name` is `display_name` here. Fixed on both counts.
 *
 * The RETURNED shape keeps `name` so callers (`app/new.tsx`) are unchanged —
 * `display_name` is mapped at this boundary rather than rippling a column
 * rename through the UI.
 */
export async function searchBees(q: string): Promise<{ id: string; handle: string; name: string | null }[]> {
  const clean = q.trim().replace(/^@/, '').toLowerCase().replace(/[%_]/g, '');
  if (!clean) return [];
  const { data, error } = await req()
    .from('profiles')
    .select('id, handle, display_name')
    .ilike('handle', `%${clean}%`)
    .order('handle')
    .limit(8);
  if (error) throw error;
  return ((data ?? []) as { id: string; handle: string; display_name: string | null }[]).map((r) => ({
    id: r.id,
    handle: r.handle,
    name: r.display_name,
  }));
}

export async function findBeeByHandle(handle: string): Promise<{ id: string; handle: string } | null> {
  const clean = handle.trim().replace(/^@/, '').toLowerCase();
  if (!clean) return null;
  const { data, error } = await req()
    .from('profiles')
    .select('id, handle')
    .eq('handle', clean)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, handle: data.handle } : null;
}

// ── Blocks & reports ──
export async function listMyBlocks(): Promise<Set<string>> {
  const { data, error } = await req().from('comms_blocks').select('blocked_bee_id');
  if (error) throw error;
  return new Set(((data ?? []) as { blocked_bee_id: string }[]).map((r) => r.blocked_bee_id));
}
export async function blockBee(beeId: string): Promise<void> {
  const { error } = await req().rpc('comms_block', { p_bee: beeId });
  if (error) throw error;
}
export async function unblockBee(beeId: string): Promise<void> {
  const { error } = await req().rpc('comms_unblock', { p_bee: beeId });
  if (error) throw error;
}
export async function reportBee(beeId: string, reason: string, conversationId?: string | null): Promise<void> {
  if (!REPORTING_ENABLED) throw NOT_IN_BUILD('Reporting');
  const { error } = await req().rpc('comms_report', {
    p_bee: beeId,
    p_reason: reason,
    p_conversation_id: conversationId ?? null,
  });
  if (error) throw error;
}

// ── Presence ──
export async function presencePing(): Promise<void> {
  // READ-shaped and fire-and-forget: absent presence is simply no presence.
  if (!PRESENCE_ENABLED) return;
  const { error } = await req().rpc('bee_presence_ping');
  if (error) throw error;
}

// ── Pins — GATED OFF in the fork (WAGGLES_F2-ACK decision 3) ──
//
// The fork's own schema bundle (`db/waggles-core-v0.1/`) deliberately does NOT
// create `comms_pins`, and does not define `comms_pin` / `comms_unpin`:
// `001_schema.sql` lists "reactions, pins, rooms, calls, push, media and
// disappearing messages" as out of scope, and the v1 MVP is E2EE 1:1 text. The
// point is to keep the SELF-HOSTABLE surface small — every table a self-hoster
// must run is a cost paid by everyone who runs their own Waggles.
//
// This client was ported from the constellation, where those objects DO exist,
// so these three functions used to call them unconditionally. Against a fork
// backend that is a guaranteed runtime error, and it is the one client/bundle
// mismatch the WAGGLES_F2 audit turned up (7 of 8 queried tables resolve).
//
// So pins are gated rather than deleted: the bundle stays as F1 ratified it, the
// code survives for the later fork pass that turns them on, and nothing calls a
// table that is not there. Flip `PINS_ENABLED` when a bundle version ships
// `comms_pins`. No UI path reaches these today.
export const PINS_ENABLED = false;

const PINS_OFF = 'Pinned messages are not available in this build.';

export type CommsPin = { messageId: string; pinnedBy: string; createdAt: string };

export async function listPins(conversationId: string): Promise<CommsPin[]> {
  // A read fails SOFT: no pins is the truthful answer for a backend with no
  // pins table, and an empty list keeps any future caller's rendering honest
  // without making it handle an error for a feature it did not ask for.
  if (!PINS_ENABLED) return [];
  const { data, error } = await req()
    .from('comms_pins')
    .select('message_id, pinned_by, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as { message_id: string; pinned_by: string; created_at: string }[]).map((r) => ({
    messageId: r.message_id,
    pinnedBy: r.pinned_by,
    createdAt: r.created_at,
  }));
}

export async function pinMessage(conversationId: string, messageId: string): Promise<void> {
  // A WRITE fails LOUD: silently swallowing it would tell the Bee their message
  // is pinned when nothing was stored anywhere.
  if (!PINS_ENABLED) throw new Error(PINS_OFF);
  const { error } = await req().rpc('comms_pin', { p_conversation_id: conversationId, p_message_id: messageId });
  if (error) throw error;
}

export async function unpinMessage(conversationId: string, messageId: string): Promise<void> {
  if (!PINS_ENABLED) throw new Error(PINS_OFF);
  const { error } = await req().rpc('comms_unpin', { p_conversation_id: conversationId, p_message_id: messageId });
  if (error) throw error;
}

// ── typing (ephemeral broadcast) ──
export interface TypingChannel {
  sendTyping: () => void;
  close: () => void;
}
export function joinTyping(
  conversationId: string,
  me: { beeId: string; handle: string },
  onTyping: (who: { beeId: string; handle: string }) => void,
): TypingChannel | null {
  const client = getSupabase();
  const channel = client.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } });
  channel
    .on('broadcast', { event: 'typing' }, (msg) => {
      const p = (msg as { payload?: { beeId?: string; handle?: string } }).payload;
      if (p?.beeId && p.beeId !== me.beeId) onTyping({ beeId: p.beeId, handle: p.handle ?? 'someone' });
    })
    .subscribe();
  let last = 0;
  return {
    sendTyping: () => {
      const now = Date.now();
      if (now - last < 2000) return;
      last = now;
      channel.send({ type: 'broadcast', event: 'typing', payload: { beeId: me.beeId, handle: me.handle } });
    },
    close: () => {
      client.removeChannel(channel);
    },
  };
}

// ── realtime (postgres_changes, RLS-scoped) ──
export interface RealtimeSub {
  close: () => void;
}
export function subscribeConversation(
  conversationId: string,
  accessToken: string | null,
  onChange: () => void,
): RealtimeSub | null {
  const client = getSupabase();
  if (accessToken) client.realtime.setAuth(accessToken);
  const channel = client
    .channel(`comms:thread:${conversationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comms_messages', filter: `conversation_id=eq.${conversationId}` },
      () => onChange(),
    )
    .subscribe();
  return {
    close: () => {
      client.removeChannel(channel);
    },
  };
}
export function subscribeConversationList(
  accessToken: string | null,
  onChange: () => void,
): RealtimeSub | null {
  const client = getSupabase();
  if (accessToken) client.realtime.setAuth(accessToken);
  const channel = client
    .channel('comms:list')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comms_messages' }, () => onChange())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comms_messages' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comms_participants' }, () => onChange())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comms_conversations' }, () => onChange())
    .subscribe();
  return {
    close: () => {
      client.removeChannel(channel);
    },
  };
}

// ── safety-number verification memory (device-local, AsyncStorage) ──
function snKey(myBeeId: string, conversationId: string): string {
  return `hc_sn_verified:${myBeeId}:${conversationId}`;
}
export async function getVerifiedSafetyNumber(myBeeId: string, conversationId: string): Promise<string | null> {
  return AsyncStorage.getItem(snKey(myBeeId, conversationId));
}
export async function storeVerifiedSafetyNumber(
  myBeeId: string,
  conversationId: string,
  safetyNumber: string,
): Promise<void> {
  await AsyncStorage.setItem(snKey(myBeeId, conversationId), safetyNumber);
}
export async function clearVerifiedSafetyNumber(myBeeId: string, conversationId: string): Promise<void> {
  await AsyncStorage.removeItem(snKey(myBeeId, conversationId));
}

// ── helpers ──
export function hasUnread(conv: Conversation, myBeeId: string | undefined): boolean {
  if (!myBeeId || !conv.lastMessageAt) return false;
  const me = conv.participants.find((p) => p.beeId === myBeeId);
  if (!me) return false;
  return !me.lastReadAt || me.lastReadAt < conv.lastMessageAt;
}
export function conversationTitle(conv: Conversation, myBeeId: string | undefined): string {
  if (conv.kind === 'group') return conv.title || 'Group';
  const others = conv.participants.filter((p) => p.beeId !== myBeeId);
  if (!others.length) return conv.title || 'Conversation';
  return others.map((p) => `@${p.handle}`).join(', ');
}
