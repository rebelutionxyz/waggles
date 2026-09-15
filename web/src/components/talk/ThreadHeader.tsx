'use client';

/* ============================================================
   TALK_GROUPS1 - the thread header controls: mute, disappearing-messages
   timer, pinned-messages panel, and (kind-gated) group management /
   block+report. Ported from CommsPage.tsx's equivalent controls, restyled to
   the talk shell's CSS-module + design-token pattern instead of Tailwind.
   Every action here returns an `ActionResult` and is surfaced honestly on
   failure (an error line in the panel) - never a console.warn.
   ============================================================ */

import { useEffect, useState } from 'react';
import { useTalkData } from '@/lib/data/provider';
import { conversationTitle, type TalkConversation, type TalkMessage, type TalkPin } from '@/lib/contract';
import styles from './ThreadHeader.module.css';

const DISAPPEAR_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: 'Off', seconds: null },
  { label: '1h', seconds: 3_600 },
  { label: '24h', seconds: 86_400 },
  { label: '7d', seconds: 604_800 },
];

interface ThreadHeaderProps {
  conversation: TalkConversation;
  myBeeId: string | null;
  messages: TalkMessage[];
  onJumpTo: (messageId: string) => void;
  /** Ask the parent to reload the conversation (mute/disappearing/group changes
      live on `TalkConversation`, not `TalkMessage`). */
  onConversationChanged: () => void;
}

export function ThreadHeader({ conversation, myBeeId, messages, onJumpTo, onConversationChanged }: ThreadHeaderProps) {
  const data = useTalkData();
  const [panel, setPanel] = useState<'none' | 'pins' | 'manage' | 'safety'>('none');
  const [pins, setPins] = useState<TalkPin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPanel('none');
    setPins(null);
    setError(null);
  }, [conversation.id]);

  useEffect(() => {
    if (panel !== 'pins') return;
    let live = true;
    void data.listPins(conversation.id).then((rows) => {
      if (live) setPins(rows);
    });
    return () => {
      live = false;
    };
  }, [panel, conversation.id, data]);

  const title = conversationTitle(conversation, myBeeId);
  const other = conversation.kind === 'direct' ? conversation.participants.find((p) => p.beeId !== myBeeId) : null;
  const iAmOwner = conversation.participants.find((p) => p.beeId === myBeeId)?.role === 'owner';

  const run = async (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.reason ?? 'That did not work.');
      } else {
        onConversationChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  // Calls are F6 in the fork; v1 MVP is E2EE 1:1 text, so the call buttons
  // that used to sit in this header are gone rather than firing into a
  // backend with no comms_room_*/comms_call_* RPCs.

  return (
    <div className={styles.head}>
      <div className={styles.row}>
        <span className={styles.title}>{title}</span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            title={conversation.muted ? 'Unmute' : 'Mute'}
            disabled={busy}
            onClick={() => void run(() => data.setMuted(conversation.id, !conversation.muted))}
          >
            {conversation.muted ? '🔕' : '🔔'}
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="Pinned messages"
            onClick={() => setPanel(panel === 'pins' ? 'none' : 'pins')}
          >
            📌{pins && pins.length > 0 ? ` ${pins.length}` : ''}
          </button>
          {conversation.kind === 'group' && (
            <button
              type="button"
              className={styles.iconBtn}
              title="Manage group"
              onClick={() => setPanel(panel === 'manage' ? 'none' : 'manage')}
            >
              👥
            </button>
          )}
          {conversation.kind === 'direct' && other && (
            <button
              type="button"
              className={styles.iconBtn}
              title="Safety"
              onClick={() => setPanel(panel === 'safety' ? 'none' : 'safety')}
            >
              ⚠️
            </button>
          )}
        </div>
      </div>

      <div className={styles.disappearRow}>
        <span className={styles.disappearLabel}>Disappearing messages:</span>
        {DISAPPEAR_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={[styles.chip, conversation.disappearSeconds === opt.seconds ? styles.chipActive : ''].join(' ')}
            disabled={busy}
            onClick={() => void run(() => data.setDisappearing(conversation.id, opt.seconds))}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {panel === 'pins' && (
        <div className={styles.panel}>
          {pins === null ? (
            <p className={styles.muted}>Loading...</p>
          ) : pins.length === 0 ? (
            <p className={styles.muted}>No pinned messages yet.</p>
          ) : (
            pins.map((p) => {
              const msg = messages.find((m) => m.id === p.messageId);
              return (
                <button key={p.messageId} type="button" className={styles.pinRow} onClick={() => onJumpTo(p.messageId)}>
                  <span className={styles.pinBody}>{msg?.deletedAt ? 'Message unsent' : msg?.body || '(older message)'}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {panel === 'manage' && conversation.kind === 'group' && (
        <GroupManagePanel conversation={conversation} myBeeId={myBeeId} iAmOwner={iAmOwner} onChanged={onConversationChanged} />
      )}

      {panel === 'safety' && conversation.kind === 'direct' && other && (
        <SafetyPanel beeId={other.beeId} handle={other.handle} conversationId={conversation.id} onChanged={onConversationChanged} />
      )}
    </div>
  );
}

function GroupManagePanel({
  conversation,
  myBeeId,
  iAmOwner,
  onChanged,
}: {
  conversation: TalkConversation;
  myBeeId: string | null;
  iAmOwner: boolean;
  onChanged: () => void;
}) {
  const data = useTalkData();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canAdd = iAmOwner || conversation.membersCanAdd;

  const addMember = async () => {
    const clean = handle.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const bee = await data.findBeeByHandle(clean);
      if (!bee) {
        setError(`No one found at @${clean.replace(/^@/, '')}.`);
        return;
      }
      const result = await data.addGroupMember(conversation.id, bee.beeId);
      if (!result.ok) {
        setError(result.reason ?? 'Could not add that Bee.');
        return;
      }
      setHandle('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (beeId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await data.removeGroupMember(conversation.id, beeId);
      if (!result.ok) setError(result.reason ?? 'Could not remove that Bee.');
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  const toggleAddPolicy = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await data.setGroupAddPolicy(conversation.id, !conversation.membersCanAdd);
      if (!result.ok) setError(result.reason ?? 'Could not change that setting.');
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      {conversation.participants.map((p) => (
        <div key={p.beeId} className={styles.memberRow}>
          <span>
            @{p.handle} {p.role === 'owner' && <span className={styles.ownerTag}>owner</span>}
          </span>
          {iAmOwner && p.beeId !== myBeeId && (
            <button type="button" className={styles.smallBtn} disabled={busy} onClick={() => void removeMember(p.beeId)}>
              Remove
            </button>
          )}
        </div>
      ))}

      {canAdd && (
        <form
          className={styles.addRow}
          onSubmit={(e) => {
            e.preventDefault();
            void addMember();
          }}
        >
          <input
            className={styles.input}
            placeholder="@handle to add"
            value={handle}
            disabled={busy}
            onChange={(e) => setHandle(e.target.value)}
          />
          <button type="submit" className={styles.smallBtn} disabled={busy || !handle.trim()}>
            Add
          </button>
        </form>
      )}

      {iAmOwner && (
        <label className={styles.toggleRow}>
          <input type="checkbox" checked={conversation.membersCanAdd} disabled={busy} onChange={() => void toggleAddPolicy()} />
          Members may add people
        </label>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function SafetyPanel({
  beeId,
  handle,
  conversationId,
  onChanged,
}: {
  beeId: string;
  handle: string;
  conversationId: string;
  onChanged: () => void;
}) {
  const data = useTalkData();
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void data.listMyBlocks().then((blocks) => {
      if (live) setBlocked(blocks.has(beeId));
    });
    return () => {
      live = false;
    };
  }, [beeId, data]);

  const toggleBlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = blocked ? await data.unblockBee(beeId) : await data.blockBee(beeId);
      if (!result.ok) {
        setError(result.reason ?? 'Could not update that block.');
        return;
      }
      setBlocked(!blocked);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    const clean = reportReason.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await data.reportBee(beeId, clean, conversationId);
      if (!result.ok) {
        setError(result.reason ?? 'Could not file that report.');
        return;
      }
      setReportReason('');
      setNotice('Report filed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <button type="button" className={styles.smallBtn} disabled={busy || blocked === null} onClick={() => void toggleBlock()}>
        {blocked ? `Unblock @${handle}` : `Block @${handle}`}
      </button>
      <form
        className={styles.addRow}
        onSubmit={(e) => {
          e.preventDefault();
          void submitReport();
        }}
      >
        <input
          className={styles.input}
          placeholder={`Report @${handle} - reason`}
          value={reportReason}
          disabled={busy}
          onChange={(e) => setReportReason(e.target.value)}
        />
        <button type="submit" className={styles.smallBtn} disabled={busy || !reportReason.trim()}>
          Report
        </button>
      </form>
      {notice && <p className={styles.muted}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
