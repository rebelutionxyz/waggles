'use client';

/* ============================================================
   TALK ASTRA HOME (TALK_CONCEPT v0.1 s2/s4) - messaging-FIRST full-window
   view. Two-pane content inside the shared shell's content column, same
   list+detail split VOTE uses for Ballot/Legislation: ConversationList on the
   left, ThreadPane (thread, or the empty-thread HOME greeting+composer) on
   the right.

   Signed-out in LIVE mode -> the Door (own file). MOCK mode always shows the
   full astra home, matching the mock-provider convention used constellation-
   wide ("no session needed, the fixture answers regardless").
   ============================================================ */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { DATA_SOURCE, useTalkData } from '@/lib/data/provider';
import type { TalkConversation } from '@/lib/contract';
import { Door } from './Door';
import { ConversationList } from './ConversationList';
import { ThreadPane } from './ThreadPane';
import { conversationPath, homePath, parseConversationPath } from '@/lib/routes';
import styles from './TalkHome.module.css';

interface TalkHomeProps {
  initialSearch?: string;
  /** TALK_CONVURL1 - set by the `/c/[conversationId]` route; absent on `/`. */
  initialConversationId?: string;
}

export function TalkHome({ initialSearch, initialConversationId }: TalkHomeProps) {
  const session = useSession();
  const data = useTalkData();
  const [conversations, setConversations] = useState<TalkConversation[] | null>(null);

  /* ------------------------------------------------------------------
     TALK_CONVURL1 - THE URL IS THE SELECTION.

     Before this pass `selectedId` was `useState` and the address bar never
     moved. It is now derived from the pathname, which makes back/forward
     correct for free: every history entry already carries the conversation
     it belongs to, so `popstate` needs no handler of its own - Next 15's App
     Router reflects `window.history.pushState` into `usePathname()`, and
     re-deriving `routeId` IS the restore.

     `pushState` rather than `router.push` on purpose: BOTH routes render this
     same component, so a real navigation would unmount it and re-run the
     conversation fetch on every thread click. Shallow-updating the URL keeps
     the loaded list and moves only the selection.

     `autoId` is the pre-existing "home previews your newest thread" default
     (the old `rows[0]?.id ?? null`), kept as it was and deliberately NOT
     written into the URL: bare `/` stays bare, and only an explicit choice
     mints a link. Going Back clears it, which is what lets `/` mean the list.
     ------------------------------------------------------------------ */
  const pathname = usePathname();
  const routeId = parseConversationPath(pathname) ?? initialConversationId ?? null;
  const [autoId, setAutoId] = useState<string | null>(null);
  const selectedId = routeId ?? autoId;

  const showDoor = DATA_SOURCE === 'live' && session.ready && !session.signedIn;

  useEffect(() => {
    if (showDoor) return;
    let live = true;
    // MENU_TALK1 - the sidebar search (SHELL_SEARCH1's shared SidebarSearch)
    // pushes `?q=`; this is the one place that reads it and hands it to the
    // SAME `listConversations(filter)` seam both mock and live already
    // implement (title or participant handle, case-insensitive) - no new
    // filtering logic, just wiring the existing one up to the sidebar
    // instead of leaving it unused.
    void data.listConversations(initialSearch ? { search: initialSearch } : undefined).then((rows) => {
      if (!live) return;
      setConversations(rows);
      // Only the AUTO-selection is re-pointed at row 0. A conversation named
      // by the URL is the bee's explicit choice and is never overridden by a
      // refetch; a deep link to a thread that is not in this list simply
      // shows the empty-thread pane, because the seam is RLS-scoped and
      // "not in your list" and "not yours" are the same answer.
      setAutoId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    });
    return () => {
      live = false;
    };
    // Mock never changes source; live re-fetches once the session resolves
    // or the sidebar search term changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, showDoor, session.signedIn, initialSearch]);

  if (DATA_SOURCE === 'live' && !session.ready) {
    return <div className={styles.loading}>Loading...</div>;
  }
  if (showDoor) return <Door />;
  if (conversations === null) {
    return <div className={styles.loading}>Loading your conversations...</div>;
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  /**
   * TALK_STARTDM1 - a conversation was just started (new, or an existing one
   * `startDirect` returned idempotently). Re-fetch so the new row's real
   * participants/title come from the seam (never invented locally), then
   * select it - this is the "Gap B" fix: an inbox that was a dead end now
   * has a way in.
   */
  const handleStarted = (id: string) => {
    // Deliberately UNFILTERED, even with a search active: starting a message
    // is a specific request to see THAT conversation, and a stale `?q=` that
    // happens not to match it must never hide the thing the bee just did.
    void data.listConversations().then((rows) => {
      setConversations(rows);
      selectConversation(id);
    });
  };

  /**
   * TALK_CONVURL1 - reflect a selection into the address bar. `pushState`
   * rather than `replaceState` because opening a thread is somewhere you can
   * go Back from. `?q=` rides along so the sidebar search survives the hop -
   * the same term `/c/[conversationId]` reads back on a cold load.
   */
  const selectConversation = (id: string) => {
    setAutoId(null);
    window.history.pushState(null, '', conversationPath(id, initialSearch));
  };

  /** The mobile Back affordance: no conversation, list pane, bare `/`. */
  const clearConversation = () => {
    setAutoId(null);
    window.history.pushState(null, '', homePath(initialSearch));
  };

  // TALK_GROUPS1: mute/disappearing/group-membership changes live on
  // TalkConversation, not TalkMessage - re-fetch the list (which the
  // selected conversation is derived from) rather than each control
  // inventing its own local patch of the row.
  const refreshConversations = () => {
    void data.listConversations(initialSearch ? { search: initialSearch } : undefined).then(setConversations);
  };

  return (
    // TALK_MOBILE1: below the phone breakpoint only one of these two panes is
    // visible at a time (see TalkHome.module.css) - `data-view` says which.
    // ConversationList's own fixed sidebar width is a desktop-only concept;
    // ThreadPane's `flex: 1 1 auto` already fills whatever's left, so hiding
    // the other slot is all either pane needs to become full-width.
    <div className={styles.wrap} data-view={selected ? 'thread' : 'list'}>
      <div className={styles.listSlot}>
        <ConversationList
          conversations={conversations}
          myBeeId={session.beeId}
          selectedId={selectedId}
          onSelect={selectConversation}
          activeSearch={initialSearch}
          onStarted={handleStarted}
        />
      </div>
      <div className={styles.threadSlot}>
        <ThreadPane
          conversation={selected}
          myBeeId={session.beeId}
          onConversationChanged={refreshConversations}
          onBack={clearConversation}
        />
      </div>
    </div>
  );
}
