/* ============================================================
   REBELUTION.talk - the contract.
   The single seam every screen renders against. `data/mock.ts` fulfils it for
   local work and the owner walkthrough; `data/supabase.ts` reads the SAME live
   tables the in-Manual messenger uses - `comms_conversations`,
   `comms_participants`, `comms_messages` - via the SAME `TalkData` interface.
   Screens NEVER import fixture data directly.

   ZERO NEW TABLES (TALK_CONCEPT v0.1 W-24 gate). This is a READ + FRAME seam
   over the existing comms_* schema, not a second messaging engine.

   E2E HONESTY (HARD LAW): the live impl never introduces a plaintext path or a
   weaker key flow than the Manual's messenger. `comms_messages.body` is
   ciphertext; TALK_E2E1 ported the Manual's real device-key/unwrap client
   (`lib/e2ee.ts`) so `data/supabase.ts` decrypts/sends for real. Two distinct
   honest "can't show you the text yet" states now exist instead of one
   blanket `undecryptable` - see `TalkMessage.keyPending` above for why they
   are not the same thing, and never fake either one (no fake decrypt, no
   silent write, no `canSend()` that lies about a specific conversation's
   readiness). The mock impl shows the FULL intended UX (for the walkthrough)
   with real-looking plaintext and a working composer.
   ============================================================ */

export type ConversationKind = 'direct' | 'group';

export interface TalkParticipant {
  beeId: string;
  /** Rendered WITH a leading @ - never the viewer's own handle (SHELL v1.5). */
  handle: string;
  name: string | null;
  /** TALK_GROUPS1: 'owner' | 'member' - owner-only actions (remove member, set
      add policy) gate on this. Defaults to 'member' where the source has no
      role column (never invented as 'owner'). */
  role: 'owner' | 'member';
}

/**
 * One conversation, mapped from `comms_conversations` (+ its participants).
 * HONESTY RULE: never invent a preview. `lastMessagePreview` is '' when the
 * body is ciphertext this surface cannot read yet.
 */
export interface TalkConversation {
  id: string;
  kind: ConversationKind;
  /** Group title, or null for a direct DM (title is derived from the other participant). */
  title: string | null;
  participants: TalkParticipant[];
  /** The Bee who created this conversation. TALK_E2E1: needed to decide whether
      THIS device may mint the conversation key (creator) or may only reseal an
      existing one (member) — see `ensureConversationKeySynced` in data/supabase.ts. */
  createdBy: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  unread: boolean;
  /** TALK_GROUPS1: may a non-owner member add people to this group? Groups only. */
  membersCanAdd: boolean;
  /** TALK_GROUPS1: disappearing-messages timer in seconds, applied to future
      sends only (Signal semantics). null = off. */
  disappearSeconds: number | null;
  /** TALK_GROUPS1: muted BY THE VIEWER - suppresses their own notifications. */
  muted: boolean;
}

export interface TalkReaction {
  emoji: string;
  count: number;
  /** Did the viewer react with this emoji? */
  mine: boolean;
}

export interface TalkMessage {
  id: string;
  conversationId: string;
  senderBeeId: string;
  senderHandle: string;
  /** '' when `undecryptable` or `keyPending` - never a guessed or placeholder body. */
  body: string;
  /**
   * TALK_E2E1: this device HAS the E2E client and a conversation key, tried to
   * decrypt, and failed (corrupted ciphertext, wrong key). Distinct from
   * `keyPending` below - conflating the two was TALK1's own gap (a plaintext
   * `undecryptable: true` covered both "no client" and "no key yet").
   */
  undecryptable: boolean;
  /**
   * TALK_E2E1: this device has no `comms_conversation_keys` row for this
   * conversation yet - the real cross-origin consequence of `rebelution.talk`
   * being a device IndexedDB has never seen before (see e2ee.ts's header
   * comment). NOT the same as `undecryptable` - an honest "still linking this
   * device" state, not a decrypt failure. Resolves itself once an existing
   * device reseals to this one (opening the conversation in the Manual, or -
   * for a brand-new conversation - `ensureConversationKeySynced` minting/
   * resealing on this device's own next thread-open).
   */
  keyPending: boolean;
  createdAt: string;
  /** Sent by the viewer. */
  mine: boolean;
  /** TALK_GROUPS1: set by comms_edit_message; null = never edited. */
  editedAt: string | null;
  /** TALK_GROUPS1: set by comms_delete_message (unsend); a tombstone renders
      "Message unsent", never the old body. */
  deletedAt: string | null;
  /** TALK_GROUPS1: reaction summary, grouped by emoji. */
  reactions: TalkReaction[];
  /** TALK_MEDIA1: set for an attachment/voice message; `body` is '' when set.
      null for an ordinary text message. */
  media: TalkMediaPayload | null;
}

export interface TalkFilter {
  search?: string;
  /** TALK_GROUPS1: undefined = All. 'following' is handled entirely in the UI
      (it lists Bees, not conversations) and is never passed here. */
  kind?: 'dm' | 'group';
}

export interface SendResult {
  ok: boolean;
  /** Present when ok=false - an honest reason, surfaced to the composer, never a silent drop. */
  reason?: string;
  message?: TalkMessage;
}

export interface StartDirectResult {
  ok: boolean;
  /** Present when ok=false - an honest reason, surfaced to the New Message panel. */
  reason?: string;
  conversationId?: string;
}

/**
 * TALK_GROUPS1: the shared result shape for every mutating action below
 * (group management, reactions, pins, edit/unsend, mute, disappearing,
 * block/report). Same honesty law as SendResult/StartDirectResult - a
 * failure (including the DB-enforced 50-pin cap) is a reason string the
 * caller surfaces in the UI, never a console.warn that hides it.
 */
export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface TalkPin {
  messageId: string;
  pinnedBy: string;
  createdAt: string;
}

/**
 * TALK_MEDIA1: an attachment pointer, decrypted like any other message body
 * (the pointer JSON is sealed under the conversation key, same as the
 * reference's `CommsMediaPayload`). UNLIKE the reference, `url` here always
 * points at CIPHERTEXT bytes — every kind, not just voice notes (TALK_MF
 * v0.4 ruling: file-level encryption for all attachments during the port).
 * A message with this set has no useful `body`.
 */
export type TalkMediaKind = 'image' | 'video' | 'audio' | 'document';

export interface TalkMediaPayload {
  url: string;
  kind: TalkMediaKind;
  name: string;
  /** Original mime type — needed to reconstruct a playable/viewable Blob
      after decrypt; the uploaded ciphertext's own declared type is unrelated
      (see TALK_MEDIA_BUCKET's allowlist note in data/supabase.ts). */
  mime: string;
  /** Voice notes only, whole seconds. */
  dur?: number;
}

/** Raw bytes to encrypt-and-send, already read off a File/Blob by the caller
    (keeps TalkData a pure data seam — it never touches <input type=file>). */
export interface TalkOutgoingFile {
  bytes: Uint8Array;
  mime: string;
  name: string;
  kind: TalkMediaKind;
}

/** TALK_GROUPS1: one row for the Following tab (people-picker into a DM). */
export interface TalkFollow {
  beeId: string;
  handle: string;
  name: string | null;
}

/* ---------------- The provider interface ----------------
   One interface, two implementations. Adding a method here is a contract
   change - it lands in BOTH implementations or neither. */

export interface TalkData {
  listConversations(filter?: TalkFilter): Promise<TalkConversation[]>;
  getConversation(id: string): Promise<TalkConversation | null>;
  listMessages(conversationId: string): Promise<TalkMessage[]>;
  /** Whether this data source can actually deliver a send end-to-end right now. */
  canSend(): boolean;
  sendMessage(conversationId: string, body: string): Promise<SendResult>;
  /**
   * TALK_STARTDM1. Exact-handle lookup (leading `@` optional, case-insensitive)
   * - never a fuzzy/partial match, so "starting a DM" always means one
   * specific Bee, not a guess. Null when no Bee has that handle.
   */
  findBeeByHandle(handle: string): Promise<TalkParticipant | null>;
  /**
   * TALK_STARTDM1. Idempotent per (viewer, other) pair - calling this twice
   * for the same two Bees returns the SAME conversation, never a duplicate
   * (mirrors `comms_start_direct`'s own contract). Best-effort key setup
   * happens inside the implementation; a key-setup failure never fails the
   * call itself - `ensureConversationKeySynced` (data/supabase.ts) retries on
   * the conversation's next open, same as the Manual's own `syncConversationKey`.
   */
  startDirect(otherBeeId: string): Promise<StartDirectResult>;

  /* -------- TALK_GROUPS1: batch 1, existing comms_* RPCs only -------- */

  /** Bees the viewer follows - powers the Following tab's people-picker. */
  listFollows(): Promise<TalkFollow[]>;

  /** `comms_create_group`. Best-effort key mint mirrors `startDirect`. */
  createGroup(title: string, memberBeeIds: string[]): Promise<StartDirectResult>;
  /** `comms_group_add`, owner-only (RLS enforces; a non-owner call returns ok:false). */
  addGroupMember(conversationId: string, beeId: string): Promise<ActionResult>;
  /** `comms_group_remove`, owner-only. */
  removeGroupMember(conversationId: string, beeId: string): Promise<ActionResult>;
  /** `comms_group_set_add_policy`, owner-only. */
  setGroupAddPolicy(conversationId: string, allowed: boolean): Promise<ActionResult>;

  /** `comms_react` - toggles the viewer's own reaction with this emoji. */
  toggleReaction(messageId: string, conversationId: string, emoji: string): Promise<ActionResult>;

  listPins(conversationId: string): Promise<TalkPin[]>;
  /** `comms_pin`/`comms_unpin`. The 50-pin cap is DB-enforced; a rejection
      surfaces here as `reason`, never swallowed. */
  togglePin(conversationId: string, messageId: string, pinned: boolean): Promise<ActionResult>;

  /** `comms_edit_message` - re-encrypts under the conversation key, own messages only. */
  editMessage(messageId: string, conversationId: string, newBody: string): Promise<ActionResult>;
  /** `comms_delete_message` - soft-delete/tombstone, own messages only. */
  unsendMessage(messageId: string): Promise<ActionResult>;

  /** `comms_mention_notify` - best-effort; never blocks the send it follows. */
  notifyMentions(conversationId: string, messageId: string, beeIds: string[]): Promise<void>;

  /** `comms_set_mute` - viewer-only setting. */
  setMuted(conversationId: string, muted: boolean): Promise<ActionResult>;
  /** `comms_set_disappearing` - a shared conversation setting, any member may set it. */
  setDisappearing(conversationId: string, seconds: number | null): Promise<ActionResult>;

  /** Bee ids the viewer has blocked. */
  listMyBlocks(): Promise<Set<string>>;
  blockBee(beeId: string): Promise<ActionResult>;
  unblockBee(beeId: string): Promise<ActionResult>;
  reportBee(beeId: string, reason: string, conversationId?: string | null): Promise<ActionResult>;

  /* -------- TALK_MEDIA1: attachments + voice notes, file-level encrypted -------- */

  /** Encrypt `file.bytes` under the conversation key, upload the ciphertext,
      then send the sealed pointer as a `content_type='media'` message.
      Mirrors sendMessage's honesty contract — a failure returns `{ok:false,
      reason}`, never a thrown error the composer has to guess at. */
  sendMedia(conversationId: string, file: TalkOutgoingFile): Promise<SendResult>;
  /** Record → seal → upload → send, for a voice note specifically (kind is
      always 'audio', `dur` is always set). */
  sendVoice(
    conversationId: string,
    audio: Blob,
    mime: string,
    durationSeconds: number,
  ): Promise<SendResult>;
  /** Fetch the ciphertext at `media.url`, decrypt it under the conversation
      key, and return a local object URL for playback/display. Caller MUST
      `URL.revokeObjectURL` it when done (same contract as the Manual's
      `decryptMediaToObjectUrl`). */
  decryptMediaToObjectUrl(conversationId: string, media: TalkMediaPayload): Promise<string>;

  /** TALK_STUDIOSAVE1 (TALK_MF v0.8 RULED, per v0.6-QUESTION's guardrails):
      decrypts `media` the SAME way `decryptMediaToObjectUrl` does, then
      uploads the PLAINTEXT into the Bee's own Studio library (the same
      `creator-media` bucket + `media_assets` row TheMANUAL.tech's own
      `uploadToLibrary` writes) — deliberately taking a copy OUT of the
      encrypted conversation. The original message/attachment is never
      touched. Caller MUST get the Bee's explicit per-file confirmation
      BEFORE calling this (see MediaBubble's save-confirm UI) — this method
      does not itself ask; it only executes what was already confirmed. */
  saveMediaToStudio(conversationId: string, media: TalkMediaPayload): Promise<ActionResult>;
}

/* ============================================================
   Display helpers - deterministic so SSR and hydration agree.
   ============================================================ */

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

const DAY_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "2:45 PM" for today, else "Tue, Aug 25". '' when there is no timestamp. */
export function talkTimeLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const sameDay = new Date(t).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  return sameDay ? TIME_FMT.format(new Date(t)) : DAY_FMT.format(new Date(t));
}

/**
 * The name shown for a conversation row. A group shows its own title; a
 * direct DM derives from the other participant (never the viewer's own
 * handle) so the list never renders a conversation that looks empty.
 */
export function conversationTitle(conv: TalkConversation, myBeeId: string | null | undefined): string {
  if (conv.kind === 'group') return conv.title ?? 'Untitled group';
  const other = conv.participants.find((p) => p.beeId !== myBeeId);
  return other ? `@${other.handle}` : conv.title ?? 'Conversation';
}

/** Two-letter initials for the avatar fallback. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}
