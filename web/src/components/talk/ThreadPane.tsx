'use client';

import { useEffect, useState } from 'react';
import { useTalkData } from '@/lib/data/provider';
import { conversationTitle, talkTimeLabel, type TalkConversation, type TalkMessage } from '@/lib/contract';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { ThreadHeader } from './ThreadHeader';
import styles from './ThreadPane.module.css';

interface ThreadPaneProps {
  conversation: TalkConversation | null;
  myBeeId: string | null;
  /** TALK_GROUPS1: mute/disappearing/group-membership changes live on the
      conversation, not the message list - ask the parent (which owns the
      conversation list) to re-fetch it. */
  onConversationChanged: () => void;
  /** TALK_MOBILE1: below the phone breakpoint ConversationList and ThreadPane
      are shown one at a time (TalkHome's data-view toggle) - this is the only
      way back to the list, so it renders (CSS-hidden on desktop) in every
      branch below rather than living inside ThreadHeader, which several of
      those branches don't reach. */
  onBack: () => void;
}

/**
 * Right pane. No conversation selected -> the picker prompt. A conversation
 * with no messages yet -> the SHELL v1.5 HOME state (centered greeting +
 * composer). Any conversation with messages -> the thread, composer docked
 * to the bottom. Sending the first message flips a thread from the HOME
 * state to the docked state - the "docks to bottom on first send" behavior.
 */
export function ThreadPane({ conversation, myBeeId, onConversationChanged, onBack }: ThreadPaneProps) {
  const data = useTalkData();
  const [messages, setMessages] = useState<TalkMessage[] | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  // Calls are F6 in the fork (WAGGLES_FORK_PLAN v0.2: v1 MVP is E2EE 1:1
  // text), so there is no missed-call rail in this timeline.

  const backBtn = (
    <button type="button" className={styles.backBtn} onClick={onBack} aria-label="Back to conversations">
      ← Back
    </button>
  );

  const reload = () => {
    if (!conversation) return;
    void data.listMessages(conversation.id).then(setMessages);
    void data.listPins(conversation.id).then((rows) => setPinnedIds(new Set(rows.map((r) => r.messageId))));
  };

  useEffect(() => {
    if (!conversation) {
      setMessages(null);
      setPinnedIds(new Set());
      return;
    }
    let live = true;
    setMessages(null);
    void data.listMessages(conversation.id).then((rows) => {
      if (live) setMessages(rows);
    });
    void data.listPins(conversation.id).then((rows) => {
      if (live) setPinnedIds(new Set(rows.map((r) => r.messageId)));
    });
    return () => {
      live = false;
    };
  }, [conversation, myBeeId, data]);

  if (!conversation) {
    return (
      <div className={styles.pane}>
        {backBtn}
        <div className={styles.pickerWrap}>Pick a conversation, or start one from the Manual.</div>
      </div>
    );
  }

  const jumpTo = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (messages === null) {
    // TALK_NEWDM1: this loading window (between selecting/starting a
    // conversation and listMessages() resolving) rendered NO composer at
    // all - the exact "no message box" / "something wrong after adding
    // user" the owner hit, since every conversation switch (including the
    // New DM -> conversation transition) passes through here. Docked
    // composer + an empty .messages spacer keep this frame the same shape
    // as the populated state below, so nothing visibly jumps once messages
    // load in.
    return (
      <div className={styles.pane}>
        {backBtn}
        <ThreadHeader
          conversation={conversation}
          myBeeId={myBeeId}
          messages={[]}
          onJumpTo={jumpTo}
          onConversationChanged={onConversationChanged}
        />
        <div className={styles.messages} />
        <Composer
          conversationId={conversation.id}
          conversation={conversation}
          variant="docked"
          onSent={(result) => {
            if (result.ok && result.message) setMessages((prev) => [...(prev ?? []), result.message!]);
          }}
        />
      </div>
    );
  }

  if (messages.length === 0) {
    // HOME state: centered greeting + composer, undocked.
    const title = conversationTitle(conversation, myBeeId);
    return (
      <div className={styles.pane}>
        {backBtn}
        <div className={styles.homeWrap}>
          <h1 className={styles.greeting}>Say hello to {title}</h1>
          <p className={styles.greetingSub}>Your first message here docks the composer to the bottom.</p>
          <div className={styles.homeComposer}>
            <Composer
              conversationId={conversation.id}
              conversation={conversation}
              variant="centered"
              onSent={(result) => {
                if (result.ok && result.message) setMessages((prev) => [...(prev ?? []), result.message!]);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pane}>
      {backBtn}
      <ThreadHeader
        conversation={conversation}
        myBeeId={myBeeId}
        messages={messages}
        onJumpTo={jumpTo}
        onConversationChanged={onConversationChanged}
      />
      <div className={styles.messages}>
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            conversation={conversation}
            myBeeId={myBeeId}
            pinned={pinnedIds.has(message.id)}
            onChanged={reload}
          />
        ))}
      </div>
      <Composer
        conversationId={conversation.id}
        conversation={conversation}
        variant="docked"
        onSent={(result) => {
          if (result.ok && result.message) setMessages((prev) => [...(prev ?? []), result.message!]);
        }}
      />
    </div>
  );
}
