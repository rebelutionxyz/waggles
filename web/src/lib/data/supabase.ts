/* ============================================================
   REBELUTION.talk - the LIVE implementation of `TalkData`.

   Reads the SAME rows the in-Manual messenger uses - `comms_conversations`,
   `comms_participants` (joined to `bees` for handle/name), `comms_messages` -
   through the SAME `TalkData` interface the mock impl fulfils. ZERO new
   tables (TALK_CONCEPT v0.1). RLS decides who can see what; this file adds no
   visibility guard of its own.

   E2E HONESTY (HARD LAW - do not soften this): `comms_messages.body` is
   ciphertext for any `is_encrypted` row. TALK_E2E1 ported the Manual's real
   device-key/unwrap client (`lib/e2ee.ts`) - see the header comment there for
   the full model. This file NEVER introduces a plaintext path or a weaker key
   flow than the Manual's messenger: every write goes through the SAME
   `comms_send` RPC the Manual calls (`lib/comms.ts:sendEncrypted`), never a
   raw table insert, and a message this device cannot decrypt is reported
   honestly (`undecryptable` or `keyPending` - see contract.ts for why those
   are two different things) rather than guessed or silently dropped.
   ============================================================ */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActionResult,
  ConversationKind,
  SendResult,
  StartDirectResult,
  TalkConversation,
  TalkData,
  TalkFilter,
  TalkFollow,
  TalkMediaKind,
  TalkMediaPayload,
  TalkMessage,
  TalkOutgoingFile,
  TalkParticipant,
  TalkPin,
} from '@/lib/contract';
import { canAuthenticate, getClient } from '@/lib/supabase/client';
import {
  decryptBody,
  decryptBytes,
  encryptBody,
  encryptBytes,
  establishConversationKey,
  getConversationKey,
  isEncryptedBody,
  resealConversationKey,
} from '@/lib/e2ee';

/**
 * TALK_MEDIA1: TALK's OWN storage bucket, proposed (not applied - see
 * db/proposed/) as `talk-media`, never `creator-media` - same "keep deploys
 * independent" reasoning TALK_E2E1's header comment gives for verbatim-
 * copying e2ee.ts rather than importing it cross-repo. Every object under
 * this bucket is CIPHERTEXT (encryptBytes output) - the bucket's own
 * allowlist is `application/octet-stream` ONLY, so unlike the Manual's
 * `creator-media` (whose allowlist has no octet-stream entry, forcing voice
 * notes to lie about their mime type as a workaround), nothing here needs to
 * disguise itself as a real media type. The true mime rides inside the
 * encrypted pointer (`TalkMediaPayload.mime`) for playback either way.
 */
const TALK_MEDIA_BUCKET = 'talk-media';
const TALK_MEDIA_UPLOAD_TYPE = 'application/octet-stream';

/**
 * TALK_STUDIOSAVE1: the SAME bucket TheMANUAL.tech's own Creator Studio
 * library uses (`src/lib/media.ts`'s `MEDIA_BUCKET` there) - deliberately
 * NOT `talk-media` (that bucket holds only ciphertext, per the header
 * comment above). A saved file is the Bee's own plaintext copy in the same
 * per-Bee `library/{bee_id}/*` shelf every Astra's Studio picker already
 * reads from - no new bucket, matching the dispatch's own instruction.
 */
const STUDIO_MEDIA_BUCKET = 'creator-media';

/** Minimal mime->extension map for a saved Studio copy's storage path -
    mirrors TheMANUAL.tech's media.ts `extFor`, scoped to the mime types
    TALK's own media kinds actually produce (see TalkMediaKind). */
function extForStudioMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'weba',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
  };
  return map[mime] ?? 'bin';
}

function parseMediaPayload(body: string): TalkMediaPayload | null {
  try {
    const p = JSON.parse(body) as Partial<TalkMediaPayload>;
    if (
      typeof p.url === 'string' &&
      /^https?:\/\//i.test(p.url) &&
      typeof p.mime === 'string' &&
      (p.kind === 'image' || p.kind === 'video' || p.kind === 'audio' || p.kind === 'document')
    ) {
      return {
        url: p.url,
        kind: p.kind,
        name: typeof p.name === 'string' ? p.name : 'attachment',
        mime: p.mime,
        dur: typeof p.dur === 'number' && Number.isFinite(p.dur) ? p.dur : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Shared by sendMedia/sendVoice: seal bytes, upload ciphertext, seal+send the pointer. */
async function sendSealedMedia(
  client: SupabaseClient,
  myId: string,
  conversationId: string,
  bytes: Uint8Array,
  media: Omit<TalkMediaPayload, 'url'>,
): Promise<SendResult> {
  const ck = await getConversationKey(myId, conversationId).catch(() => null);
  if (!ck) {
    return {
      ok: false,
      reason:
        'Encryption is still linking this device - open this chat in the Manual messenger ' +
        'once, then try again here.',
    };
  }
  const sealed = await encryptBytes(ck, bytes);
  const cipherBlob = new Blob([sealed.slice().buffer as ArrayBuffer], { type: TALK_MEDIA_UPLOAD_TYPE });
  const path = `library/${myId}/talk-${crypto.randomUUID()}.bin`;
  const { error: upErr } = await client.storage
    .from(TALK_MEDIA_BUCKET)
    .upload(path, cipherBlob, { contentType: TALK_MEDIA_UPLOAD_TYPE, upsert: false });
  if (upErr) return { ok: false, reason: upErr.message?.trim() || 'Could not upload that file.' };
  const url = client.storage.from(TALK_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  const payload: TalkMediaPayload = { ...media, url };
  const enc = await encryptBody(ck, JSON.stringify(payload));
  const { data, error } = await client.rpc('comms_send', {
    p_conversation_id: conversationId,
    p_body: enc,
    p_content_type: 'media',
    p_is_encrypted: true,
    p_reply_to: null,
  });
  if (error) return { ok: false, reason: error.message?.trim() || 'Could not send that file.' };
  const messageId = (data as { message_id?: string } | null)?.message_id ?? '';
  if (messageId) ringMessagePush(client, conversationId, messageId);
  const message: TalkMessage = {
    id: messageId,
    conversationId,
    senderBeeId: myId,
    senderHandle: '', // never rendered for `mine: true` (MessageBubble.tsx)
    body: '',
    undecryptable: false,
    keyPending: false,
    createdAt: new Date().toISOString(),
    mine: true,
    editedAt: null,
    deletedAt: null,
    reactions: [],
    media: payload,
  };
  return { ok: true, message };
}

function db(): SupabaseClient {
  return getClient();
}

/** Shared by decryptMediaToObjectUrl/saveMediaToStudio: fetch the ciphertext
    at `media.url` and decrypt it under the conversation key. Throws an
    honest, user-facing message on either failure - never a guess. */
async function decryptMediaBytes(
  client: SupabaseClient,
  myId: string,
  conversationId: string,
  media: TalkMediaPayload,
): Promise<Uint8Array> {
  const ck = await getConversationKey(myId, conversationId).catch(() => null);
  if (!ck) throw new Error('Encryption is still linking this device - try again in a moment.');
  const res = await fetch(media.url);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const sealed = new Uint8Array(await res.arrayBuffer());
  return decryptBytes(ck, sealed);
}

/**
 * TALK_MSGPUSH1 — off-site alert to the OTHER participants' registered
 * devices, best-effort, mirroring `lib/calls.ts`'s `ringOtherDevices`
 * (`functions.invoke('push-send', …).catch(() => {})`) exactly: a message
 * send must never fail or feel slower because a push notification's
 * network round-trip is slow or the function errors. `push-send-message`
 * is PROPOSED, NOT DEPLOYED this pass (see its own file header) — this
 * call is real client code, ready the moment that function ships; until
 * then `functions.invoke` 404s and the `.catch(() => {})` silently absorbs
 * it, exactly like every other not-yet-deployed edge function this
 * constellation's clients already call ahead of its own deploy.
 */
function ringMessagePush(client: SupabaseClient, conversationId: string, messageId: string): void {
  client.functions
    .invoke('push-send-message', { body: { conversation_id: conversationId, message_id: messageId } })
    .catch(() => {});
}

function fail(error: { message?: string } | null, fallback: string): never {
  const message = error?.message?.trim();
  throw new Error(message && message.length ? message : fallback);
}

function normKind(k: string): ConversationKind {
  return k === 'group' ? 'group' : 'direct';
}

/** A `bees` embed can come back as an object or a one-item array depending on the FK hint. */
function oneBee(row: unknown): { handle: string; name: string | null } | null {
  const b = Array.isArray(row) ? row[0] : row;
  if (!b || typeof b !== 'object') return null;
  const rec = b as { handle?: string; name?: string | null };
  return rec.handle ? { handle: rec.handle, name: rec.name ?? null } : null;
}

async function myBeeId(client: SupabaseClient): Promise<string | null> {
  if (!canAuthenticate()) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

interface ParticipantRow {
  conversation_id: string;
  bee_id: string;
  last_read_at: string | null;
  muted: boolean | null;
  role: string | null;
  bees: unknown;
}

/** Participants (+ handle/name/role) for a batch of conversation ids, grouped. */
async function participantsByConversation(
  client: SupabaseClient,
  ids: string[],
): Promise<Map<string, TalkParticipant[]>> {
  const out = new Map<string, TalkParticipant[]>();
  if (ids.length === 0) return out;
  const { data, error } = await client
    .from('comms_participants')
    .select('conversation_id, bee_id, last_read_at, muted, role, bees(handle, name)')
    .in('conversation_id', ids);
  if (error) fail(error, 'Could not load conversation participants.');
  for (const row of (data ?? []) as unknown as ParticipantRow[]) {
    const bee = oneBee(row.bees);
    const list = out.get(row.conversation_id) ?? [];
    list.push({
      beeId: row.bee_id,
      handle: bee?.handle ?? 'bee',
      name: bee?.name ?? null,
      role: row.role === 'owner' ? 'owner' : 'member',
    });
    out.set(row.conversation_id, list);
  }
  return out;
}

/** Latest message per conversation, for the list preview - '' whenever it is ciphertext.
    TALK_E2E1 scope note: previews stay undecrypted (unchanged from TALK1) - the approved
    plan for this pass was listMessages/canSend/sendMessage; decrypting previews too is a
    natural small follow-up, not folded in here. */
async function latestPreviews(
  client: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await client
    .from('comms_messages')
    .select('conversation_id, body, is_encrypted, deleted_at, created_at')
    .in('conversation_id', ids)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) fail(error, 'Could not load recent messages.');
  for (const row of (data ?? []) as {
    conversation_id: string;
    body: string | null;
    is_encrypted: boolean;
    deleted_at: string | null;
  }[]) {
    if (out.has(row.conversation_id)) continue; // first row per id, thanks to the ORDER BY above
    if (row.deleted_at) {
      out.set(row.conversation_id, '');
    } else {
      out.set(row.conversation_id, row.is_encrypted ? '' : row.body ?? '');
    }
  }
  return out;
}

async function loadConversations(
  client: SupabaseClient,
  ids: string[],
  myId: string | null,
): Promise<TalkConversation[]> {
  if (ids.length === 0) return [];
  const [{ data, error }, participants, previews, myReads] = await Promise.all([
    client
      .from('comms_conversations')
      .select('id, kind, title, created_by, last_message_at, members_can_add, disappear_seconds')
      .in('id', ids),
    participantsByConversation(client, ids),
    latestPreviews(client, ids),
    myId
      ? client
          .from('comms_participants')
          .select('conversation_id, last_read_at, muted')
          .eq('bee_id', myId)
          .in('conversation_id', ids)
      : Promise.resolve({ data: [] as { conversation_id: string; last_read_at: string | null; muted: boolean | null }[] }),
  ]);
  if (error) fail(error, 'Could not load your conversations.');

  const readAt = new Map<string, string | null>();
  const mutedBy = new Map<string, boolean>();
  for (const r of (myReads.data ?? []) as { conversation_id: string; last_read_at: string | null; muted: boolean | null }[]) {
    readAt.set(r.conversation_id, r.last_read_at);
    mutedBy.set(r.conversation_id, !!r.muted);
  }

  return ((data ?? []) as {
    id: string;
    kind: string;
    title: string | null;
    created_by: string | null;
    last_message_at: string | null;
    members_can_add: boolean | null;
    disappear_seconds: number | null;
  }[])
    .map((row) => {
      const lastMessageAt = row.last_message_at;
      const lastRead = readAt.get(row.id) ?? null;
      const unread = Boolean(
        lastMessageAt && (!lastRead || Date.parse(lastMessageAt) > Date.parse(lastRead)),
      );
      return {
        id: row.id,
        kind: normKind(row.kind),
        title: row.title,
        participants: participants.get(row.id) ?? [],
        createdBy: row.created_by,
        lastMessageAt,
        lastMessagePreview: previews.get(row.id) ?? '',
        unread,
        membersCanAdd: !!row.members_can_add,
        disappearSeconds: row.disappear_seconds ?? null,
        muted: mutedBy.get(row.id) ?? false,
      } satisfies TalkConversation;
    })
    .sort((a, b) => Date.parse(b.lastMessageAt ?? '') - Date.parse(a.lastMessageAt ?? ''));
}

/**
 * TALK_E2E1 - ported from `TheMANUAL.tech/src/lib/comms.ts:syncConversationKey`.
 * Call whenever a thread opens (here: at the top of `listMessages`, the one
 * place every screen already calls when a conversation is selected).
 *
 * Creator mints on first open (or on THIS device's first-ever open of a
 * conversation it created before this device existed); a member who already
 * holds the key re-seals so late key-publishers - including a bee's very own
 * `rebelution.talk` device, the first time it shows up in `bee_keys` - get
 * access. Best-effort throughout (matches the source: a reseal/establish
 * failure here must never block reading whatever this device CAN already
 * decrypt) - never surfaced as a thrown error to the caller.
 */
async function ensureConversationKeySynced(
  myId: string,
  conversation: { id: string; createdBy: string | null; participants: TalkParticipant[] },
): Promise<void> {
  const members = conversation.participants.map((p) => p.beeId);
  try {
    const ck = await getConversationKey(myId, conversation.id);
    if (ck) {
      if (members.length <= 25) {
        try {
          await resealConversationKey(myId, conversation.id, members);
        } catch {
          /* best-effort, matches comms.ts's own swallow */
        }
      }
      return;
    }
    if (conversation.createdBy === myId) {
      try {
        await establishConversationKey(myId, conversation.id, members);
      } catch {
        /* locked out on this device - recovery (rekeyConversation) is not
           built here; the conversation just stays keyPending until a device
           that DOES hold the key reseals to this one. */
      }
    }
    // else: another member holds the key and will seal to us on their next open.
  } catch {
    /* getConversationKey itself failed (network, RLS) - leave keyPending;
       listMessages below re-derives the same state independently. */
  }
}

export const supabaseTalkData: TalkData = {
  async listConversations(filter: TalkFilter = {}) {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return []; // signed out - the door hands into sign-in, never a fake list

    const { data: mine, error } = await client
      .from('comms_participants')
      .select('conversation_id')
      .eq('bee_id', myId);
    if (error) fail(error, 'Could not load your conversations.');
    const ids = ((mine ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id);

    let rows = await loadConversations(client, ids, myId);
    if (filter.kind === 'dm') rows = rows.filter((c) => c.kind === 'direct');
    if (filter.kind === 'group') rows = rows.filter((c) => c.kind === 'group');
    if (filter.search?.trim()) {
      const t = filter.search.trim().toLowerCase();
      rows = rows.filter(
        (c) =>
          (c.title ?? '').toLowerCase().includes(t) ||
          c.participants.some((p) => p.handle.toLowerCase().includes(t)),
      );
    }
    return rows;
  },

  async getConversation(id) {
    const client = db();
    const myId = await myBeeId(client);
    const rows = await loadConversations(client, [id], myId);
    return rows[0] ?? null;
  },

  async listMessages(conversationId) {
    const client = db();
    const myId = await myBeeId(client);
    const participants = await participantsByConversation(client, [conversationId]);
    const members = participants.get(conversationId) ?? [];
    const handleOf = new Map(members.map((p) => [p.beeId, p.handle]));

    let ck: Uint8Array | null = null;
    if (myId) {
      const { data: convRow } = await client
        .from('comms_conversations')
        .select('created_by')
        .eq('id', conversationId)
        .maybeSingle();
      await ensureConversationKeySynced(myId, {
        id: conversationId,
        createdBy: (convRow as { created_by: string | null } | null)?.created_by ?? null,
        participants: members,
      });
      ck = await getConversationKey(myId, conversationId).catch(() => null);
    }

    const { data, error } = await client
      .from('comms_messages')
      .select(
        'id, conversation_id, sender_bee_id, body, content_type, is_encrypted, deleted_at, edited_at, created_at, comms_reactions(bee_id, emoji)',
      )
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) fail(error, 'Could not load this conversation.');

    const rows = (data ?? []) as {
      id: string;
      conversation_id: string;
      sender_bee_id: string;
      body: string | null;
      content_type: string | null;
      is_encrypted: boolean;
      deleted_at: string | null;
      edited_at: string | null;
      created_at: string;
      comms_reactions: unknown;
    }[];

    const out: TalkMessage[] = [];
    for (const row of rows) {
      let body = '';
      let media: TalkMediaPayload | null = null;
      let undecryptable = false;
      let keyPending = false;
      const raw = row.body ?? '';
      const isCiphertext = row.is_encrypted && !row.deleted_at && isEncryptedBody(raw);
      if (row.deleted_at) {
        // tombstone - nothing to show, and never a decrypt attempt on it.
      } else if (isCiphertext) {
        if (!ck) {
          keyPending = true; // no key on THIS device yet - see e2ee.ts's header comment
        } else {
          try {
            const decrypted = await decryptBody(ck, raw);
            if (row.content_type === 'media') {
              // TALK_MEDIA1: the pointer JSON was itself the encrypted body -
              // a malformed/unparseable pointer renders as `undecryptable`,
              // never a guessed attachment.
              const parsed = parseMediaPayload(decrypted);
              if (parsed) media = parsed;
              else undecryptable = true;
            } else {
              body = decrypted;
            }
          } catch {
            undecryptable = true; // key present, decrypt genuinely failed
          }
        }
      } else {
        body = raw; // legacy/unencrypted row, if any ever existed
      }
      const reactionRows = (
        Array.isArray(row.comms_reactions) ? row.comms_reactions : []
      ) as { bee_id: string; emoji: string }[];
      const byEmoji = new Map<string, { count: number; mine: boolean }>();
      for (const r of reactionRows) {
        const cur = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
        cur.count += 1;
        if (myId && r.bee_id === myId) cur.mine = true;
        byEmoji.set(r.emoji, cur);
      }
      out.push({
        id: row.id,
        conversationId: row.conversation_id,
        senderBeeId: row.sender_bee_id,
        senderHandle: handleOf.get(row.sender_bee_id) ?? 'bee',
        body,
        undecryptable,
        keyPending,
        createdAt: row.created_at,
        mine: row.sender_bee_id === myId,
        editedAt: row.edited_at ?? null,
        deletedAt: row.deleted_at ?? null,
        reactions: Array.from(byEmoji, ([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
        media,
      } satisfies TalkMessage);
    }
    return out;
  },

  canSend() {
    // Can this device even attempt E2E? (browser context - ensureIdentity
    // needs `window`/IndexedDB, which SSR never has.) Whether a SPECIFIC
    // conversation's key is actually resolvable yet is a per-conversation
    // question, answered honestly by sendMessage below rather than baked
    // into this static, contract-wide capability check.
    return canAuthenticate();
  },

  async sendMessage(conversationId, body): Promise<SendResult> {
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, reason: 'Message is empty.' };
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to send a message.' };

    const ck = await getConversationKey(myId, conversationId).catch(() => null);
    if (!ck) {
      return {
        ok: false,
        reason:
          'Encryption is still linking this device - open this chat in the Manual messenger ' +
          'once, then try again here.',
      };
    }

    const enc = await encryptBody(ck, trimmed);
    const { data, error } = await client.rpc('comms_send', {
      p_conversation_id: conversationId,
      p_body: enc,
      p_content_type: 'text',
      p_is_encrypted: true,
      p_reply_to: null,
    });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not send that message.' };

    const messageId = (data as { message_id?: string } | null)?.message_id ?? '';
    if (messageId) ringMessagePush(client, conversationId, messageId);
    const message: TalkMessage = {
      id: messageId,
      conversationId,
      senderBeeId: myId,
      senderHandle: '', // never rendered for `mine: true` (MessageBubble.tsx)
      body: trimmed,
      undecryptable: false,
      keyPending: false,
      createdAt: new Date().toISOString(),
      mine: true,
      editedAt: null,
      deletedAt: null,
      reactions: [],
      media: null,
    };
    return { ok: true, message };
  },

  async findBeeByHandle(handle) {
    const clean = handle.trim().replace(/^@/, '').toLowerCase();
    if (!clean) return null;
    const client = db();
    const { data, error } = await client
      .from('bees')
      .select('id, handle, name')
      .eq('handle', clean)
      .maybeSingle();
    if (error) fail(error, 'Could not look up that handle.');
    const row = data as { id: string; handle: string; name: string | null } | null;
    return row ? { beeId: row.id, handle: row.handle, name: row.name, role: 'member' } : null;
  },

  async startDirect(otherBeeId): Promise<StartDirectResult> {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to start a conversation.' };

    // TALK_STARTDM1 - same RPC comms.ts:startDirect calls: idempotent per
    // (viewer, other) pair, so re-running this for a pair that already has a
    // DM returns that SAME conversation, never a duplicate.
    const { data, error } = await client.rpc('comms_start_direct', { p_other: otherBeeId });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not start that conversation.' };
    const row = data as { conversation_id?: string; created?: boolean } | null;
    const conversationId = row?.conversation_id;
    if (!conversationId) {
      return { ok: false, reason: 'comms_start_direct returned no conversation id.' };
    }

    // Best-effort key setup, exactly like comms.ts:startDirect - a failure
    // here never fails the call; ensureConversationKeySynced (above) retries
    // the next time this conversation's thread opens.
    try {
      if (row?.created) {
        await establishConversationKey(myId, conversationId, [myId, otherBeeId]);
      } else {
        const ck = await getConversationKey(myId, conversationId).catch(() => null);
        if (ck) await resealConversationKey(myId, conversationId, [myId, otherBeeId]);
      }
    } catch {
      /* best-effort - see comment above */
    }

    return { ok: true, conversationId };
  },

  async listFollows(): Promise<TalkFollow[]> {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return [];
    const { data, error } = await client
      .from('bee_follows')
      .select('followed_bee_id')
      .eq('follower_bee_id', myId);
    if (error) fail(error, 'Could not load who you follow.');
    const ids = Array.from(
      new Set(((data ?? []) as { followed_bee_id: string }[]).map((r) => r.followed_bee_id)),
    );
    if (!ids.length) return [];
    const { data: bs, error: bErr } = await client.from('bees').select('id, handle, name').in('id', ids);
    if (bErr) fail(bErr, 'Could not load who you follow.');
    return ((bs ?? []) as { id: string; handle: string; name: string | null }[]).map((b) => ({
      beeId: b.id,
      handle: b.handle,
      name: b.name,
    }));
  },

  async createGroup(title, memberBeeIds): Promise<StartDirectResult> {
    const clean = title.trim();
    if (!clean) return { ok: false, reason: 'Give the group a name.' };
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to create a group.' };
    const { data, error } = await client.rpc('comms_create_group', {
      p_title: clean,
      p_member_bees: memberBeeIds,
    });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not create that group.' };
    const conversationId = (data as { conversation_id?: string } | null)?.conversation_id;
    if (!conversationId) return { ok: false, reason: 'comms_create_group returned no conversation id.' };
    try {
      await establishConversationKey(myId, conversationId, [myId, ...memberBeeIds]);
    } catch {
      /* best-effort, same as startDirect above */
    }
    return { ok: true, conversationId };
  },

  async addGroupMember(conversationId, beeId): Promise<ActionResult> {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to manage this group.' };
    const { error } = await client.rpc('comms_group_add', {
      p_conversation_id: conversationId,
      p_bee_id: beeId,
    });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not add that Bee.' };
    // Best-effort re-seal, mirrors comms.ts:addGroupMember.
    try {
      const ck = await getConversationKey(myId, conversationId).catch(() => null);
      if (ck) {
        const { data } = await client.from('comms_participants').select('bee_id').eq('conversation_id', conversationId);
        const members = ((data ?? []) as { bee_id: string }[]).map((r) => r.bee_id);
        if (members.length) await resealConversationKey(myId, conversationId, members);
      }
    } catch {
      /* best-effort - syncConversationKey retries on next open */
    }
    return { ok: true };
  },

  async removeGroupMember(conversationId, beeId): Promise<ActionResult> {
    const client = db();
    const { error } = await client.rpc('comms_group_remove', {
      p_conversation_id: conversationId,
      p_bee_id: beeId,
    });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not remove that Bee.' };
    return { ok: true };
  },

  async setGroupAddPolicy(conversationId, allowed): Promise<ActionResult> {
    const client = db();
    const { error } = await client.rpc('comms_group_set_add_policy', {
      p_conversation_id: conversationId,
      p_allowed: allowed,
    });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not change that setting.' };
    return { ok: true };
  },

  async toggleReaction(messageId, _conversationId, emoji): Promise<ActionResult> {
    const client = db();
    // comms_react TOGGLES server-side (reference: lib/comms.ts:toggleReaction) -
    // this call always just asks for `emoji` on `messageId`; add vs. remove is
    // the server's own decision, never guessed client-side.
    const { error } = await client.rpc('comms_react', { p_message_id: messageId, p_emoji: emoji });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not react to that message.' };
    return { ok: true };
  },

  async listPins(conversationId): Promise<TalkPin[]> {
    const client = db();
    const { data, error } = await client
      .from('comms_pins')
      .select('message_id, pinned_by, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false });
    if (error) fail(error, 'Could not load pinned messages.');
    return ((data ?? []) as { message_id: string; pinned_by: string; created_at: string }[]).map((r) => ({
      messageId: r.message_id,
      pinnedBy: r.pinned_by,
      createdAt: r.created_at,
    }));
  },

  async togglePin(conversationId, messageId, pinned): Promise<ActionResult> {
    const client = db();
    // 50-pin cap (KNOW_SPEC/TALK_GROUPS1): comms_pin enforces it server-side;
    // a rejection here is returned as `reason`, never swallowed to console.
    const { error } = pinned
      ? await client.rpc('comms_unpin', { p_conversation_id: conversationId, p_message_id: messageId })
      : await client.rpc('comms_pin', { p_conversation_id: conversationId, p_message_id: messageId });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not update that pin.' };
    return { ok: true };
  },

  async editMessage(messageId, conversationId, newBody): Promise<ActionResult> {
    const trimmed = newBody.trim();
    if (!trimmed) return { ok: false, reason: 'Message is empty.' };
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to edit a message.' };
    const ck = await getConversationKey(myId, conversationId).catch(() => null);
    if (!ck) return { ok: false, reason: 'Encryption is still linking this device - try again in a moment.' };
    const enc = await encryptBody(ck, trimmed);
    const { error } = await client.rpc('comms_edit_message', { p_message_id: messageId, p_body: enc });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not edit that message.' };
    return { ok: true };
  },

  async unsendMessage(messageId): Promise<ActionResult> {
    const client = db();
    const { error } = await client.rpc('comms_delete_message', { p_message_id: messageId });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not unsend that message.' };
    return { ok: true };
  },

  async notifyMentions(conversationId, messageId, beeIds): Promise<void> {
    if (!beeIds.length) return;
    const client = db();
    // Best-effort, mirrors comms.ts:notifyMentions - never blocks the send it follows.
    try {
      await client.rpc('comms_mention_notify', {
        p_conversation_id: conversationId,
        p_message_id: messageId,
        p_bee_ids: beeIds,
      });
    } catch {
      /* best-effort */
    }
  },

  async setMuted(conversationId, muted): Promise<ActionResult> {
    const client = db();
    const { error } = await client.rpc('comms_set_mute', { p_conversation_id: conversationId, p_muted: muted });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not change notifications for this chat.' };
    return { ok: true };
  },

  async setDisappearing(conversationId, seconds): Promise<ActionResult> {
    const client = db();
    const { error } = await client.rpc('comms_set_disappearing', {
      p_conversation_id: conversationId,
      p_seconds: seconds,
    });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not change the disappearing timer.' };
    return { ok: true };
  },

  async listMyBlocks(): Promise<Set<string>> {
    const client = db();
    const { data, error } = await client.from('comms_blocks').select('blocked_bee_id');
    if (error) fail(error, 'Could not load your blocked Bees.');
    return new Set(((data ?? []) as { blocked_bee_id: string }[]).map((r) => r.blocked_bee_id));
  },

  async blockBee(beeId): Promise<ActionResult> {
    const client = db();
    const { error } = await client.rpc('comms_block', { p_bee: beeId });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not block that Bee.' };
    return { ok: true };
  },

  async unblockBee(beeId): Promise<ActionResult> {
    const client = db();
    const { error } = await client.rpc('comms_unblock', { p_bee: beeId });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not unblock that Bee.' };
    return { ok: true };
  },

  async reportBee(beeId, reason, conversationId): Promise<ActionResult> {
    if (!reason.trim()) return { ok: false, reason: 'Say why you are reporting this Bee.' };
    const client = db();
    const { error } = await client.rpc('comms_report', {
      p_bee: beeId,
      p_reason: reason.trim(),
      p_conversation_id: conversationId ?? null,
    });
    if (error) return { ok: false, reason: error.message?.trim() || 'Could not file that report.' };
    return { ok: true };
  },

  async sendMedia(conversationId, file: TalkOutgoingFile): Promise<SendResult> {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to send a file.' };
    return sendSealedMedia(client, myId, conversationId, file.bytes, {
      kind: file.kind,
      name: file.name,
      mime: file.mime,
    });
  },

  async sendVoice(conversationId, audio, mime, durationSeconds): Promise<SendResult> {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to send a voice message.' };
    const bytes = new Uint8Array(await audio.arrayBuffer());
    return sendSealedMedia(client, myId, conversationId, bytes, {
      kind: 'audio' as TalkMediaKind,
      name: 'Voice message',
      mime,
      dur: Math.max(1, Math.round(durationSeconds)),
    });
  },

  async decryptMediaToObjectUrl(conversationId, media): Promise<string> {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) throw new Error('Sign in to view this file.');
    const plain = await decryptMediaBytes(client, myId, conversationId, media);
    const blob = new Blob([plain.slice().buffer as ArrayBuffer], {
      type: media.mime || 'application/octet-stream',
    });
    return URL.createObjectURL(blob);
  },

  async saveMediaToStudio(conversationId, media): Promise<ActionResult> {
    const client = db();
    const myId = await myBeeId(client);
    if (!myId) return { ok: false, reason: 'Sign in to save this file.' };
    let plain: Uint8Array;
    try {
      plain = await decryptMediaBytes(client, myId, conversationId, media);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'Could not decrypt that file.' };
    }
    const blob = new Blob([plain.slice().buffer as ArrayBuffer], {
      type: media.mime || 'application/octet-stream',
    });
    const path = `library/${myId}/${crypto.randomUUID()}.${extForStudioMime(media.mime)}`;
    const { error: upErr } = await client.storage
      .from(STUDIO_MEDIA_BUCKET)
      .upload(path, blob, { contentType: media.mime || 'application/octet-stream', upsert: false });
    if (upErr) return { ok: false, reason: upErr.message?.trim() || 'Could not save that file to Studio.' };
    const { error } = await client.from('media_assets').insert({
      bee_id: myId,
      kind: media.kind,
      bucket: STUDIO_MEDIA_BUCKET,
      storage_path: path,
      file_name: media.name,
      mime_type: media.mime || 'application/octet-stream',
      byte_size: blob.size,
      duration_seconds: media.dur ?? null,
      // TALK_MF v0.6-QUESTION's own wording: a deliberate save brings a file
      // IN from outside the Library, the same shape as a MiniWaves import -
      // matches media_assets_source_check (no 'bee-save'/'talk' value exists,
      // and none was added; 'import' is the closest exact fit already there).
      source: 'import',
    });
    if (error) {
      // No orphaned storage object on a failed metadata insert - same
      // cleanup TheMANUAL.tech's own uploadToLibrary does.
      await client.storage.from(STUDIO_MEDIA_BUCKET).remove([path]);
      return { ok: false, reason: error.message?.trim() || 'Could not save that file to Studio.' };
    }
    return { ok: true };
  },
};
