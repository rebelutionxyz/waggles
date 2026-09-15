/* ============================================================
   REBELUTION.talk - the MOCK implementation of `TalkData`.

   Fixtures for local work AND the owner walkthrough. Mock shows the FULL
   intended UX - a conversation list, a real-looking thread, and a working
   composer that docks to bottom on first send - standing in for the E2E
   decrypt/send wiring the live impl defers this pass (see contract.ts).

   TALK_GROUPS1: extended with in-memory groups/reactions/pins/edit/unsend/
   mentions/mute/disappearing/block/report, same honesty rules as the rest of
   this file - failures return `{ ok: false, reason }`, never a console.warn.
   ============================================================ */

import type {
  ActionResult,
  SendResult,
  StartDirectResult,
  TalkConversation,
  TalkData,
  TalkFilter,
  TalkFollow,
  TalkMediaPayload,
  TalkMessage,
  TalkOutgoingFile,
  TalkParticipant,
  TalkPin,
} from '@/lib/contract';

const MOCK_NOW = Date.parse('2026-08-29T16:00:00Z');
/** Exported so `lib/auth.ts`'s MOCK_SESSION can report the SAME id as the
    fixture's own viewer - TALK_GROUPS1 found that a null `myBeeId` made
    every "who is the OTHER participant" computation (DM title, Safety panel)
    fall back to whichever participant happened to be listed first, which is
    always this fixture's own "you" row. Pre-existing gap this pass closes
    because the new block/report UI depends on it being right. */
export const MY_BEE_ID = 'me-0000-0000-0000-000000000000';
function iso(minutesAgo: number): string {
  return new Date(MOCK_NOW - minutesAgo * 60_000).toISOString();
}

const HONEY = 'aaaaaaaa-0000-0000-0000-000000000001';
const SWARM = 'bbbbbbbb-0000-0000-0000-000000000002';
const RILEY = 'cccccccc-0000-0000-0000-000000000003';

const MAX_PINS = 50;

const CONVERSATIONS: TalkConversation[] = [
  {
    id: HONEY,
    kind: 'direct',
    title: null,
    participants: [
      { beeId: MY_BEE_ID, handle: 'you', name: 'You', role: 'member' },
      { beeId: 'bee-honey', handle: 'honeykeeper', name: 'Honeykeeper', role: 'member' },
    ],
    createdBy: MY_BEE_ID,
    lastMessageAt: iso(4),
    lastMessagePreview: 'Sent the walkthrough notes over - take a look when you get a sec.',
    unread: true,
    membersCanAdd: false,
    disappearSeconds: null,
    muted: false,
  },
  {
    id: SWARM,
    kind: 'group',
    title: 'Builders Swarm',
    participants: [
      { beeId: MY_BEE_ID, handle: 'you', name: 'You', role: 'member' },
      { beeId: 'bee-honey', handle: 'honeykeeper', name: 'Honeykeeper', role: 'owner' },
      { beeId: 'bee-riley', handle: 'riley', name: 'Riley', role: 'member' },
    ],
    createdBy: 'bee-honey',
    lastMessageAt: iso(52),
    lastMessagePreview: 'riley: shipped the door route, /chat is reserved now',
    unread: false,
    membersCanAdd: true,
    disappearSeconds: null,
    muted: false,
  },
  {
    id: RILEY,
    kind: 'direct',
    title: null,
    participants: [
      { beeId: MY_BEE_ID, handle: 'you', name: 'You', role: 'member' },
      { beeId: 'bee-riley', handle: 'riley', name: 'Riley', role: 'member' },
    ],
    createdBy: MY_BEE_ID,
    lastMessageAt: iso(1440),
    lastMessagePreview: 'Sounds good, talk tomorrow',
    unread: false,
    membersCanAdd: false,
    disappearSeconds: null,
    muted: false,
  },
];

const THREADS: Record<string, TalkMessage[]> = {
  [HONEY]: [
    {
      id: 'm1',
      conversationId: HONEY,
      senderBeeId: 'bee-honey',
      senderHandle: 'honeykeeper',
      body: "Hey - Waggles is running in mock mode, want to see it?",
      undecryptable: false,
      keyPending: false,
      createdAt: iso(30),
      mine: false,
      editedAt: null,
      deletedAt: null,
      reactions: [],
      media: null,
    },
    {
      id: 'm2',
      conversationId: HONEY,
      senderBeeId: MY_BEE_ID,
      senderHandle: 'you',
      body: 'Pulling it up now.',
      undecryptable: false,
      keyPending: false,
      createdAt: iso(20),
      mine: true,
      editedAt: null,
      deletedAt: null,
      reactions: [{ emoji: '👍', count: 1, mine: false }],
      media: null,
    },
    {
      id: 'm3',
      conversationId: HONEY,
      senderBeeId: 'bee-honey',
      senderHandle: 'honeykeeper',
      body: 'Sent the walkthrough notes over - take a look when you get a sec.',
      undecryptable: false,
      keyPending: false,
      createdAt: iso(4),
      mine: false,
      editedAt: null,
      deletedAt: null,
      reactions: [],
      media: null,
    },
  ],
  [SWARM]: [
    {
      id: 'm4',
      conversationId: SWARM,
      senderBeeId: 'bee-riley',
      senderHandle: 'riley',
      body: 'shipped the door route, /chat is reserved now',
      undecryptable: false,
      keyPending: false,
      createdAt: iso(52),
      mine: false,
      editedAt: null,
      deletedAt: null,
      reactions: [],
      media: null,
    },
  ],
  [RILEY]: [
    {
      id: 'm5',
      conversationId: RILEY,
      senderBeeId: 'bee-riley',
      senderHandle: 'riley',
      body: 'Sounds good, talk tomorrow',
      undecryptable: false,
      keyPending: false,
      createdAt: iso(1440),
      mine: false,
      editedAt: null,
      deletedAt: null,
      reactions: [],
      media: null,
    },
  ],
};

/** In-memory only - resets on reload. Enough to demo the composer docking. */
const draftThreads: Record<string, TalkMessage[]> = {};

function threadFor(id: string): TalkMessage[] {
  return [...(THREADS[id] ?? []), ...(draftThreads[id] ?? [])];
}

function findMessage(id: string): TalkMessage | null {
  for (const list of [...Object.values(THREADS), ...Object.values(draftThreads)]) {
    const m = list.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}

function findConversation(id: string): TalkConversation | null {
  return CONVERSATIONS.find((c) => c.id === id) ?? null;
}

/**
 * TALK_STARTDM1 - every Bee `findBeeByHandle` can find, including one NOT
 * already in a conversation (`freedomdesk`) - the mock needs to be able to
 * demo the actual gap this pass closes (an inbox with zero conversations),
 * not just re-find bees already on screen.
 */
const KNOWN_BEES: TalkParticipant[] = [
  { beeId: 'bee-honey', handle: 'honeykeeper', name: 'Honeykeeper', role: 'member' },
  { beeId: 'bee-riley', handle: 'riley', name: 'Riley', role: 'member' },
  { beeId: 'bee-freedomdesk', handle: 'freedomdesk', name: 'Freedom Desk', role: 'member' },
];

/** Mock "who I follow" - honeykeeper only, so the Following tab has one real
    row plus an honest empty explanation once picked. */
const FOLLOWS: TalkFollow[] = [{ beeId: 'bee-honey', handle: 'honeykeeper', name: 'Honeykeeper' }];

const PINS: Record<string, TalkPin[]> = {};
const BLOCKS = new Set<string>();

/** TALK_MEDIA1: mock never encrypts anything (same as text messages) - a
    blob: URL stands in directly for "the decrypted file", so
    decryptMediaToObjectUrl can just hand the same url back rather than
    faking a fetch+decrypt round trip. */
function pushMediaMessage(conversationId: string, media: TalkMediaPayload): SendResult {
  const msg: TalkMessage = {
    id: `draft-${Date.now()}`,
    conversationId,
    senderBeeId: MY_BEE_ID,
    senderHandle: 'you',
    body: '',
    undecryptable: false,
    keyPending: false,
    createdAt: new Date().toISOString(),
    mine: true,
    editedAt: null,
    deletedAt: null,
    reactions: [],
    media,
  };
  draftThreads[conversationId] = [...(draftThreads[conversationId] ?? []), msg];
  return { ok: true, message: msg };
}

export const mockTalkData: TalkData = {
  async listConversations(filter: TalkFilter = {}) {
    let rows = [...CONVERSATIONS];
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
    rows.sort((a, b) => Date.parse(b.lastMessageAt ?? '') - Date.parse(a.lastMessageAt ?? ''));
    return rows;
  },

  async getConversation(id) {
    return findConversation(id);
  },

  async listMessages(conversationId) {
    return threadFor(conversationId);
  },

  canSend() {
    return true;
  },

  async sendMessage(conversationId, body): Promise<SendResult> {
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, reason: 'Message is empty.' };
    const msg: TalkMessage = {
      id: `draft-${Date.now()}`,
      conversationId,
      senderBeeId: MY_BEE_ID,
      senderHandle: 'you',
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
    draftThreads[conversationId] = [...(draftThreads[conversationId] ?? []), msg];
    return { ok: true, message: msg };
  },

  async findBeeByHandle(handle) {
    const clean = handle.trim().replace(/^@/, '').toLowerCase();
    if (!clean) return null;
    return KNOWN_BEES.find((b) => b.handle.toLowerCase() === clean) ?? null;
  },

  async startDirect(otherBeeId): Promise<StartDirectResult> {
    const other = KNOWN_BEES.find((b) => b.beeId === otherBeeId);
    if (!other) return { ok: false, reason: 'That Bee could not be found.' };
    // Idempotent, same as the real RPC: an existing direct with this Bee wins.
    const existing = CONVERSATIONS.find(
      (c) => c.kind === 'direct' && c.participants.some((p) => p.beeId === otherBeeId),
    );
    if (existing) return { ok: true, conversationId: existing.id };
    const id = `dm-${otherBeeId}-${Date.now()}`;
    const fresh: TalkConversation = {
      id,
      kind: 'direct',
      title: null,
      participants: [{ beeId: MY_BEE_ID, handle: 'you', name: 'You', role: 'member' }, other],
      createdBy: MY_BEE_ID,
      lastMessageAt: null,
      lastMessagePreview: '',
      unread: false,
      membersCanAdd: false,
      disappearSeconds: null,
      muted: false,
    };
    CONVERSATIONS.unshift(fresh);
    THREADS[id] = [];
    return { ok: true, conversationId: id };
  },

  async listFollows() {
    return FOLLOWS;
  },

  async createGroup(title, memberBeeIds): Promise<StartDirectResult> {
    const clean = title.trim();
    if (!clean) return { ok: false, reason: 'Give the group a name.' };
    const members = memberBeeIds
      .map((id) => KNOWN_BEES.find((b) => b.beeId === id))
      .filter((b): b is TalkParticipant => !!b);
    const id = `group-${Date.now()}`;
    const fresh: TalkConversation = {
      id,
      kind: 'group',
      title: clean,
      participants: [
        { beeId: MY_BEE_ID, handle: 'you', name: 'You', role: 'owner' },
        ...members.map((m) => ({ ...m, role: 'member' as const })),
      ],
      createdBy: MY_BEE_ID,
      lastMessageAt: null,
      lastMessagePreview: '',
      unread: false,
      membersCanAdd: false,
      disappearSeconds: null,
      muted: false,
    };
    CONVERSATIONS.unshift(fresh);
    THREADS[id] = [];
    return { ok: true, conversationId: id };
  },

  async addGroupMember(conversationId, beeId): Promise<ActionResult> {
    const conv = findConversation(conversationId);
    const bee = KNOWN_BEES.find((b) => b.beeId === beeId);
    if (!conv) return { ok: false, reason: 'Conversation not found.' };
    if (!bee) return { ok: false, reason: 'That Bee could not be found.' };
    if (conv.participants.some((p) => p.beeId === beeId)) return { ok: true };
    conv.participants = [...conv.participants, { ...bee, role: 'member' }];
    return { ok: true };
  },

  async removeGroupMember(conversationId, beeId): Promise<ActionResult> {
    const conv = findConversation(conversationId);
    if (!conv) return { ok: false, reason: 'Conversation not found.' };
    conv.participants = conv.participants.filter((p) => p.beeId !== beeId);
    return { ok: true };
  },

  async setGroupAddPolicy(conversationId, allowed): Promise<ActionResult> {
    const conv = findConversation(conversationId);
    if (!conv) return { ok: false, reason: 'Conversation not found.' };
    conv.membersCanAdd = allowed;
    return { ok: true };
  },

  async toggleReaction(messageId, _conversationId, emoji): Promise<ActionResult> {
    const msg = findMessage(messageId);
    if (!msg) return { ok: false, reason: 'Message not found.' };
    const existing = msg.reactions.find((r) => r.emoji === emoji);
    if (existing?.mine) {
      msg.reactions = msg.reactions
        .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r))
        .filter((r) => r.count > 0);
    } else if (existing) {
      msg.reactions = msg.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
    } else {
      msg.reactions = [...msg.reactions, { emoji, count: 1, mine: true }];
    }
    return { ok: true };
  },

  async listPins(conversationId) {
    return PINS[conversationId] ?? [];
  },

  async togglePin(conversationId, messageId, pinned): Promise<ActionResult> {
    const list = PINS[conversationId] ?? [];
    if (pinned) {
      PINS[conversationId] = list.filter((p) => p.messageId !== messageId);
      return { ok: true };
    }
    if (list.length >= MAX_PINS) {
      return { ok: false, reason: `This conversation already has ${MAX_PINS} pinned messages - unpin one first.` };
    }
    PINS[conversationId] = [...list, { messageId, pinnedBy: MY_BEE_ID, createdAt: new Date().toISOString() }];
    return { ok: true };
  },

  async editMessage(messageId, _conversationId, newBody): Promise<ActionResult> {
    const trimmed = newBody.trim();
    if (!trimmed) return { ok: false, reason: 'Message is empty.' };
    const msg = findMessage(messageId);
    if (!msg) return { ok: false, reason: 'Message not found.' };
    if (!msg.mine) return { ok: false, reason: 'You can only edit your own messages.' };
    msg.body = trimmed;
    msg.editedAt = new Date().toISOString();
    return { ok: true };
  },

  async unsendMessage(messageId): Promise<ActionResult> {
    const msg = findMessage(messageId);
    if (!msg) return { ok: false, reason: 'Message not found.' };
    if (!msg.mine) return { ok: false, reason: 'You can only unsend your own messages.' };
    msg.deletedAt = new Date().toISOString();
    msg.body = '';
    return { ok: true };
  },

  async notifyMentions() {
    // Mock: no-op. Notifications have no fixture surface.
  },

  async setMuted(conversationId, muted): Promise<ActionResult> {
    const conv = findConversation(conversationId);
    if (!conv) return { ok: false, reason: 'Conversation not found.' };
    conv.muted = muted;
    return { ok: true };
  },

  async setDisappearing(conversationId, seconds): Promise<ActionResult> {
    const conv = findConversation(conversationId);
    if (!conv) return { ok: false, reason: 'Conversation not found.' };
    conv.disappearSeconds = seconds;
    return { ok: true };
  },

  async listMyBlocks() {
    return new Set(BLOCKS);
  },

  async blockBee(beeId): Promise<ActionResult> {
    BLOCKS.add(beeId);
    return { ok: true };
  },

  async unblockBee(beeId): Promise<ActionResult> {
    BLOCKS.delete(beeId);
    return { ok: true };
  },

  async reportBee(_beeId, reason): Promise<ActionResult> {
    if (!reason.trim()) return { ok: false, reason: 'Say why you are reporting this Bee.' };
    return { ok: true };
  },

  async sendMedia(conversationId, file: TalkOutgoingFile): Promise<SendResult> {
    const blob = new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.mime });
    const media: TalkMediaPayload = {
      url: URL.createObjectURL(blob),
      kind: file.kind,
      name: file.name,
      mime: file.mime,
    };
    return pushMediaMessage(conversationId, media);
  },

  async sendVoice(conversationId, audio, mime, durationSeconds): Promise<SendResult> {
    const media: TalkMediaPayload = {
      url: URL.createObjectURL(audio),
      kind: 'audio',
      name: 'Voice message',
      mime,
      dur: Math.max(1, Math.round(durationSeconds)),
    };
    return pushMediaMessage(conversationId, media);
  },

  async decryptMediaToObjectUrl(_conversationId, media): Promise<string> {
    return media.url;
  },

  async saveMediaToStudio(_conversationId, _media): Promise<ActionResult> {
    return { ok: true };
  },
};
