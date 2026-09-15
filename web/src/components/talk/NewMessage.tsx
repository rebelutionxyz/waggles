'use client';

import { useState } from 'react';
import { useTalkData } from '@/lib/data/provider';
import styles from './NewMessage.module.css';

interface NewMessageProps {
  /** Called once a conversation actually exists (started or created) - the
      panel closes itself; the parent is responsible for selecting/refreshing it. */
  onStarted: (conversationId: string) => void;
}

/**
 * TALK_STARTDM1 + TALK_GROUPS1. Two modes, one toggle: "New message" (exact
 * handle lookup, then `startDirect` - never a fuzzy search, a wrong handle is
 * an honest "not found") and "New group" (title + comma/space-separated
 * handles, `createGroup`). Both hand the resulting conversation id back to
 * `TalkHome` the same way.
 */
export function NewMessage({ onStarted }: NewMessageProps) {
  const [mode, setMode] = useState<'closed' | 'dm' | 'group'>('closed');

  if (mode === 'closed') {
    return (
      <div className={styles.toggleRow}>
        <button type="button" className={styles.toggle} onClick={() => setMode('dm')}>
          + New message
        </button>
        <button type="button" className={styles.toggle} onClick={() => setMode('group')}>
          + New group
        </button>
      </div>
    );
  }

  if (mode === 'group') {
    return <NewGroupForm onStarted={onStarted} onClose={() => setMode('closed')} />;
  }

  return <NewDirectForm onStarted={onStarted} onClose={() => setMode('closed')} />;
}

function NewDirectForm({ onStarted, onClose }: { onStarted: (id: string) => void; onClose: () => void }) {
  const data = useTalkData();
  const [handle, setHandle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const clean = handle.trim();
    if (!clean || pending) return;
    setPending(true);
    setError(null);
    try {
      const bee = await data.findBeeByHandle(clean);
      if (!bee) {
        setError(`No one found at @${clean.replace(/^@/, '')}.`);
        return;
      }
      const result = await data.startDirect(bee.beeId);
      if (!result.ok || !result.conversationId) {
        setError(result.reason ?? 'Could not start that conversation.');
        return;
      }
      const id = result.conversationId;
      onClose();
      onStarted(id);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className={styles.panel}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        className={styles.input}
        type="text"
        autoFocus
        placeholder="@handle"
        value={handle}
        disabled={pending}
        onChange={(e) => setHandle(e.target.value)}
        aria-label="Bee handle"
      />
      <div className={styles.actions}>
        <button type="submit" className={styles.start} disabled={!handle.trim() || pending}>
          {pending ? 'Starting...' : 'Start'}
        </button>
        <button type="button" className={styles.cancel} onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}

function NewGroupForm({ onStarted, onClose }: { onStarted: (id: string) => void; onClose: () => void }) {
  const data = useTalkData();
  const [title, setTitle] = useState('');
  const [handles, setHandles] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const clean = title.trim();
    if (!clean || pending) return;
    setPending(true);
    setError(null);
    try {
      const wanted = handles
        .split(/[,\s]+/)
        .map((h) => h.trim())
        .filter(Boolean);
      const ids: string[] = [];
      const misses: string[] = [];
      for (const h of wanted) {
        const found = await data.findBeeByHandle(h);
        if (found) ids.push(found.beeId);
        else misses.push(h);
      }
      if (misses.length) {
        setError(`Not found: ${misses.join(', ')}`);
        return;
      }
      const result = await data.createGroup(clean, ids);
      if (!result.ok || !result.conversationId) {
        setError(result.reason ?? 'Could not create that group.');
        return;
      }
      const id = result.conversationId;
      onClose();
      onStarted(id);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className={styles.panel}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        className={styles.input}
        type="text"
        autoFocus
        placeholder="Group name"
        value={title}
        disabled={pending}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Group name"
      />
      <input
        className={styles.input}
        type="text"
        placeholder="@handles, comma separated"
        value={handles}
        disabled={pending}
        onChange={(e) => setHandles(e.target.value)}
        aria-label="Members"
      />
      <div className={styles.actions}>
        <button type="submit" className={styles.start} disabled={!title.trim() || pending}>
          {pending ? 'Creating...' : 'Create group'}
        </button>
        <button type="button" className={styles.cancel} onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
