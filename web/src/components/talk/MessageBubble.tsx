'use client';

import { useState } from 'react';
import { useTalkData } from '@/lib/data/provider';
import { talkTimeLabel, type TalkConversation, type TalkMessage } from '@/lib/contract';
import styles from './MessageBubble.module.css';

/** Small, fixed reaction set - the reference implementation offers a native
    emoji picker; this restyle keeps the common set rather than pulling in a
    picker library for one control. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

interface MessageBubbleProps {
  message: TalkMessage;
  conversation: TalkConversation;
  myBeeId: string | null;
  pinned: boolean;
  onChanged: () => void;
}

/** Bold every `@handle` that matches a participant - honest highlighting,
    never a guess at a handle that isn't actually in this conversation. */
function renderBody(body: string, handles: string[]) {
  if (handles.length === 0) return body;
  const esc = handles.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts = body.split(new RegExp(`(@(?:${esc})\\b)`, 'gi'));
  return parts.map((part, i) =>
    /^@/.test(part) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of one immutable string
      <strong key={i}>{part}</strong>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of one immutable string
      <span key={i}>{part}</span>
    ),
  );
}

/** One message row. `undecryptable` renders an honest state, never a guessed body. */
export function MessageBubble({ message, conversation, myBeeId, pinned, onChanged }: MessageBubbleProps) {
  const data = useTalkData();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handles = conversation.participants.map((p) => p.handle);

  const react = async (emoji: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await data.toggleReaction(message.id, conversation.id, emoji);
      if (result.ok) onChanged();
      else setError(result.reason ?? 'Could not react to that message.');
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async () => {
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    try {
      const result = await data.togglePin(conversation.id, message.id, pinned);
      if (result.ok) onChanged();
      else setError(result.reason ?? 'Could not update that pin.');
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await data.editMessage(message.id, conversation.id, trimmed);
      if (result.ok) {
        setEditing(false);
        onChanged();
      } else {
        setError(result.reason ?? 'Could not edit that message.');
      }
    } finally {
      setBusy(false);
    }
  };

  const unsend = async () => {
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    try {
      const result = await data.unsendMessage(message.id);
      if (result.ok) onChanged();
      else setError(result.reason ?? 'Could not unsend that message.');
    } finally {
      setBusy(false);
    }
  };

  if (message.deletedAt) {
    return (
      <div id={`msg-${message.id}`} className={[styles.row, message.mine ? styles.mine : ''].filter(Boolean).join(' ')}>
        <div>
          <div className={styles.bubble}>
            <span className={styles.undecryptable}>Message unsent</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id={`msg-${message.id}`} className={[styles.row, message.mine ? styles.mine : ''].filter(Boolean).join(' ')}>
      <div className={styles.col}>
        {!message.mine && (
          <div className={styles.meta}>
            <span className={styles.sender}>@{message.senderHandle}</span>
            <span className={styles.time}>{talkTimeLabel(message.createdAt)}</span>
          </div>
        )}

        {editing ? (
          <div className={styles.editBox}>
            <textarea
              className={styles.editInput}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
            />
            <div className={styles.editActions}>
              <button type="button" className={styles.smallBtn} disabled={busy || !draft.trim()} onClick={() => void submitEdit()}>
                Save
              </button>
              <button
                type="button"
                className={styles.smallBtnGhost}
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setDraft(message.body);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.bubbleWrap}>
            {pinned && <span className={styles.pinBadge}>📌</span>}
            {/* Media attachments are STRIP for the fork's v1 (MVP is E2EE 1:1
                text; media is a later pass). An attachment sent from another
                client is acknowledged honestly rather than rendered blank or
                silently dropped — the body is still sealed, so we say what it
                is and refuse to pretend we can show it. */}
            {message.media && !message.keyPending && !message.undecryptable ? (
              <div className={styles.bubble}>
                <span className={styles.undecryptable}>
                  Attachment — this build sends and shows text only
                </span>
              </div>
            ) : (
              <div className={styles.bubble}>
                {message.keyPending ? (
                  <span className={styles.undecryptable}>
                    Still linking this device - open the Manual messenger once, then check back
                  </span>
                ) : message.undecryptable ? (
                  <span className={styles.undecryptable}>Encrypted - could not be read on this device</span>
                ) : (
                  renderBody(message.body, handles)
                )}
              </div>
            )}
            <button
              type="button"
              className={styles.menuToggle}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Message actions"
            >
              ⋯
            </button>
          </div>
        )}

        {menuOpen && !editing && (
          <div className={styles.menu}>
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={styles.reactBtn}
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  void react(emoji);
                }}
              >
                {emoji}
              </button>
            ))}
            <button type="button" className={styles.menuItem} disabled={busy} onClick={() => void togglePin()}>
              {pinned ? 'Unpin' : 'Pin'}
            </button>
            {message.mine && (
              <>
                {!message.media && (
                  <button
                    type="button"
                    className={styles.menuItem}
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                )}
                <button type="button" className={styles.menuItem} disabled={busy} onClick={() => void unsend()}>
                  Unsend
                </button>
              </>
            )}
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className={styles.reactions}>
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={[styles.reactionPill, r.mine ? styles.reactionMine : ''].filter(Boolean).join(' ')}
                disabled={busy}
                onClick={() => void react(r.emoji)}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {message.mine && (
          <div className={styles.meta}>
            <span className={styles.time}>
              {talkTimeLabel(message.createdAt)}
              {message.editedAt ? ' · edited' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
