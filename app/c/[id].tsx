import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import {
  type CommsMessage,
  type Conversation,
  conversationKeyStatus,
  conversationTitle,
  getConversation,
  listMessages,
  markRead,
  resetConversationEncryption,
  sendMessage,
  PINS_ENABLED,
  listPins,
  pinMessage,
  subscribeConversation,
  syncConversationKey,
  toggleReaction,
  unpinMessage,
} from '@/lib/comms';
import {
  cacheMessages,
  enqueueOutbox,
  loadCachedMessages,
  type OutboxItem,
  outboxFor,
  removeOutbox,
} from '@/lib/cache';
import { createCallRoom } from '@/lib/calls';
import { clock } from '@/lib/format';
import { useTheme } from '@/lib/theme';

type Pending = OutboxItem & { pending: true };

export default function Thread() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  const { session, beeId } = useAuth();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<CommsMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [keyStatus, setKeyStatus] = useState<'ok' | 'locked' | 'pending' | 'unknown'>('unknown');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<FlatList<CommsMessage>>(null);

  // WAGGLES_PINS1 — pinned message ids for this thread (empty + a no-op while
  // PINS_ENABLED is false; listPins returns [] then).
  const refreshPins = useCallback(async () => {
    if (!PINS_ENABLED) return;
    try {
      const pins = await listPins(conversationId);
      setPinnedIds(new Set(pins.map((p) => p.messageId)));
    } catch {
      /* leave pins as-is */
    }
  }, [conversationId]);

  const refreshMessages = useCallback(async () => {
    try {
      const msgs = await listMessages(conversationId);
      setMessages(msgs);
      await cacheMessages(conversationId, msgs);
      markRead(conversationId).catch(() => {});
    } catch {
      setMessages(await loadCachedMessages(conversationId));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const flushOutbox = useCallback(async () => {
    const items = await outboxFor(conversationId);
    for (const item of items) {
      try {
        await sendMessage(conversationId, item.body, 'text', item.replyTo);
        await removeOutbox(item.id);
      } catch {
        break; // still offline — stop; keep the rest queued
      }
    }
    setPending((await outboxFor(conversationId)).map((i) => ({ ...i, pending: true })));
  }, [conversationId]);

  useEffect(() => {
    (async () => {
      setMessages(await loadCachedMessages(conversationId));
      setPending((await outboxFor(conversationId)).map((i) => ({ ...i, pending: true })));
      const conv = await getConversation(conversationId).catch(() => null);
      setConversation(conv);
      if (conv) {
        await syncConversationKey(conv).catch(() => {});
        setKeyStatus(await conversationKeyStatus(conv).catch(() => 'unknown' as const));
      }
      await refreshMessages();
      await refreshPins();
      await flushOutbox();
    })();
  }, [conversationId, refreshMessages, refreshPins, flushOutbox]);

  useEffect(() => {
    const token = session?.access_token ?? null;
    const sub = subscribeConversation(conversationId, token, () => {
      refreshMessages();
    });
    return () => sub?.close();
  }, [conversationId, session?.access_token, refreshMessages]);

  async function onSend() {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      await sendMessage(conversationId, body, 'text');
      await refreshMessages();
    } catch {
      // offline or key not ready — queue it
      const item: OutboxItem = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        conversationId,
        body,
        replyTo: null,
        createdAt: new Date().toISOString(),
      };
      await enqueueOutbox(item);
      setPending((p) => [...p, { ...item, pending: true }]);
    }
  }

  const title = conversation ? conversationTitle(conversation, beeId ?? undefined) : 'Conversation';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* header */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          borderBottomColor: t.border,
          borderBottomWidth: 1,
          backgroundColor: t.surface,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: t.accent, fontSize: 26, fontWeight: '700' }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>
            {title}
          </Text>
          <Text style={{ color: t.textDim, fontSize: 12 }}>🔒 end-to-end encrypted</Text>
        </View>
        {conversation ? (
          <>
            {/* WAGGLES_CALLS1 — start (or join a live) E2EE call for this thread.
                comms_room_create reuses a live room, so a second tapper joins the
                same call; host=!reused decides seal vs fetch. */}
            <Pressable
              onPress={() => {
                void createCallRoom(conversationId)
                  .then(({ roomId, host }) =>
                    router.push({
                      pathname: '/call/[id]',
                      params: { id: roomId, role: host ? 'host' : 'join', video: '1' },
                    }),
                  )
                  .catch(() => {});
              }}
              hitSlop={10}
            >
              <Text style={{ fontSize: 20 }}>📞</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/settings', params: { conversation: conversationId } })
              }
              hitSlop={10}
            >
              <Text style={{ fontSize: 20 }}>ⓘ</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {keyStatus === 'locked' ? (
        <Pressable
          onPress={async () => {
            if (conversation) {
              await resetConversationEncryption(conversation).catch(() => {});
              await refreshMessages();
              setKeyStatus('ok');
            }
          }}
          style={{ backgroundColor: t.danger, paddingVertical: 8, paddingHorizontal: 16 }}
        >
          <Text style={{ color: '#fff', textAlign: 'center', fontSize: 13 }}>
            This device can't open this chat's key. Tap to reset encryption (older messages become
            unreadable).
          </Text>
        </Pressable>
      ) : null}

      {loading && messages.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, gap: 6 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={
            pending.length ? (
              <View style={{ gap: 6 }}>
                {pending.map((p) => (
                  <Bubble
                    key={p.id}
                    mine
                    body={p.body}
                    at={p.createdAt}
                    pending
                    reactions={[]}
                    onReact={() => {}}
                  />
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.deletedAt) {
              return (
                <Text style={{ color: t.textDim, fontStyle: 'italic', fontSize: 13, paddingHorizontal: 8 }}>
                  message unsent
                </Text>
              );
            }
            const mine = item.senderBeeId === beeId;
            return (
              <Bubble
                mine={mine}
                body={item.undecryptable ? '🔒 (no key on this device)' : item.body}
                at={item.createdAt}
                edited={!!item.editedAt}
                reactions={item.reactions}
                pinned={pinnedIds.has(item.id)}
                onReact={() => toggleReaction(item.id, '❤️').then(refreshMessages).catch(() => {})}
                onLongPress={() => {
                  const isPinned = pinnedIds.has(item.id);
                  const opts: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
                    { text: 'React ❤️', onPress: () => toggleReaction(item.id, '❤️').then(refreshMessages).catch(() => {}) },
                  ];
                  if (PINS_ENABLED) {
                    opts.push({
                      text: isPinned ? 'Unpin' : 'Pin',
                      onPress: () =>
                        (isPinned ? unpinMessage(conversationId, item.id) : pinMessage(conversationId, item.id))
                          .then(refreshPins)
                          .catch(() => {}),
                    });
                  }
                  opts.push({ text: 'Cancel', style: 'cancel' });
                  Alert.alert('Message', undefined, opts);
                }}
              />
            );
          }}
        />
      )}

      {/* composer */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: insets.bottom + 8,
          borderTopColor: t.border,
          borderTopWidth: 1,
          backgroundColor: t.surface,
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={t.textDim}
          multiline
          style={{
            flex: 1,
            maxHeight: 120,
            backgroundColor: t.surfaceAlt,
            borderRadius: 20,
            paddingHorizontal: 16,
            paddingVertical: 10,
            color: t.text,
            fontSize: 16,
          }}
        />
        <Pressable
          onPress={onSend}
          disabled={!text.trim()}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: text.trim() ? t.accent : t.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: text.trim() ? t.accentInk : t.textDim, fontSize: 20, fontWeight: '800' }}>
            ↑
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble(props: {
  mine: boolean;
  body: string;
  at: string;
  edited?: boolean;
  pending?: boolean;
  pinned?: boolean;
  reactions: { emoji: string; count: number; mine: boolean }[];
  onReact: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const { mine, body, at, edited, pending, pinned, reactions, onReact, onLongPress } = props;
  return (
    <Pressable
      onLongPress={onLongPress ?? onReact}
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '82%',
        backgroundColor: mine ? t.bubbleMine : t.bubbleTheirs,
        borderColor: t.border,
        borderWidth: mine ? 0 : 1,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 9,
        opacity: pending ? 0.55 : 1,
      }}
    >
      <Text style={{ color: mine ? t.bubbleMineInk : t.bubbleTheirsInk, fontSize: 16, lineHeight: 21 }}>
        {body}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
        {pinned ? <Text style={{ fontSize: 11 }}>📌</Text> : null}
        <Text style={{ color: mine ? t.bubbleMineInk : t.textDim, fontSize: 10, opacity: 0.7 }}>
          {pending ? 'sending…' : clock(at)}
          {edited ? ' · edited' : ''}
        </Text>
        {reactions.map((r) => (
          <Text key={r.emoji} style={{ fontSize: 12 }}>
            {r.emoji}
            {r.count > 1 ? r.count : ''}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}
