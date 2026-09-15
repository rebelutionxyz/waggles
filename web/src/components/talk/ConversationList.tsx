'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTalkData } from '@/lib/data/provider';
import { conversationTitle, initialsOf, talkTimeLabel, type TalkConversation, type TalkFollow } from '@/lib/contract';
import { NewMessage } from './NewMessage';
import styles from './ConversationList.module.css';

export type ListTab = 'all' | 'dm' | 'group' | 'following';

interface ConversationListProps {
  conversations: TalkConversation[];
  myBeeId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** TALK_STARTDM1 - a conversation was just started (new or pre-existing); the
      parent refreshes the list and selects it. */
  onStarted: (conversationId: string) => void;
  /**
   * MENU_TALK1 - the search term currently applied, if any. `conversations`
   * already reflects it (TalkHome passed it to `listConversations`, the same
   * seam both mock and live filter on) - this pane no longer filters on its
   * own. Undefined/empty means no search is active.
   */
  activeSearch?: string;
}

const TABS: { id: ListTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'dm', label: 'DMs' },
  { id: 'group', label: 'Groups' },
  { id: 'following', label: 'Following' },
];

/** Left pane: filter tabs, the conversation list (or the Following
 *  people-picker), + a banner when a sidebar search is active. Domain
 *  content, inside the shared shell - the search CONTROL itself lives in the
 *  sidebar (MENU_NAMES v0.4 s1, SHELL_SEARCH1's shared SidebarSearch); this
 *  pane only renders what it was handed. */
export function ConversationList({
  conversations,
  myBeeId,
  selectedId,
  onSelect,
  onStarted,
  activeSearch,
}: ConversationListProps) {
  const data = useTalkData();
  const [tab, setTab] = useState<ListTab>('all');
  const [follows, setFollows] = useState<TalkFollow[] | null>(null);

  useEffect(() => {
    if (tab === 'following' && follows === null) {
      void data.listFollows().then(setFollows);
    }
  }, [tab, follows, data]);

  const shown = conversations.filter(
    (c) => tab === 'all' || (tab === 'dm' && c.kind === 'direct') || (tab === 'group' && c.kind === 'group'),
  );

  const pickFollow = async (beeId: string) => {
    const result = await data.startDirect(beeId);
    if (result.ok && result.conversationId) onStarted(result.conversationId);
  };

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <h1 className={styles.title}>Messages</h1>
        <NewMessage onStarted={onStarted} />
      </div>

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={[styles.tab, tab === t.id ? styles.tabActive : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeSearch && tab !== 'following' && (
        <div className={styles.searchBanner}>
          Results for &quot;{activeSearch}&quot; ·{' '}
          <Link href="/" className={styles.clearLink}>
            Clear
          </Link>
        </div>
      )}

      {tab === 'following' ? (
        <div className={styles.list}>
          {follows === null ? (
            <div className={styles.empty}>Loading...</div>
          ) : follows.length === 0 ? (
            <div className={styles.empty}>
              You&apos;re not following anyone yet. Follow Bees and they&apos;ll show up here to start a chat.
            </div>
          ) : (
            follows.map((f) => (
              <button key={f.beeId} type="button" className={styles.row} onClick={() => void pickFollow(f.beeId)}>
                <span className={styles.avatar} aria-hidden>
                  {initialsOf(f.handle)}
                </span>
                <span className={styles.body}>
                  <span className={styles.top}>
                    <span className={styles.name}>@{f.handle}</span>
                  </span>
                  {f.name && <span className={styles.preview}>{f.name}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {shown.length === 0 ? (
            <div className={styles.empty}>
              {activeSearch
                ? `No match for "${activeSearch}".`
                : tab === 'dm'
                  ? 'No direct messages yet.'
                  : tab === 'group'
                    ? 'No groups yet.'
                    : 'No conversations yet.'}
            </div>
          ) : (
            shown.map((c) => {
              const title = conversationTitle(c, myBeeId);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={[styles.row, c.id === selectedId ? styles.rowActive : ''].filter(Boolean).join(' ')}
                  onClick={() => onSelect(c.id)}
                >
                  <span className={styles.avatar} aria-hidden>
                    {initialsOf(title.replace(/^@/, ''))}
                  </span>
                  <span className={styles.body}>
                    <span className={styles.top}>
                      <span className={styles.name}>{title}</span>
                      <span className={styles.time}>{talkTimeLabel(c.lastMessageAt)}</span>
                    </span>
                    <span className={[styles.preview, c.lastMessagePreview ? '' : styles.previewEmpty].filter(Boolean).join(' ')}>
                      {c.muted ? '🔕 ' : ''}
                      {c.lastMessagePreview || 'Encrypted message'}
                    </span>
                  </span>
                  {c.unread && <span className={styles.unreadDot} aria-label="Unread" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
