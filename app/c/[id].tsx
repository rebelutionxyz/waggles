import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import {
  MEDIA_ENABLED,
  type CommsMediaPayload,
  buildImagePayload,
  buildVoicePayload,
  decryptMediaToLocalUri,
  parseMediaPayload,
} from '@/lib/media';
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
  // WAGGLES_MEDIA1 — active voice recording (null unless recording); gated behind
  // MEDIA_ENABLED, so this stays null in v1.
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
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

  async function sendMediaPayload(payload: CommsMediaPayload) {
    try {
      await sendMessage(conversationId, JSON.stringify(payload), 'media');
      await refreshMessages();
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  async function pickAndSendImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    try {
      const payload = await buildImagePayload(conversationId, a.uri, a.mimeType ?? 'image/jpeg', a.width, a.height);
      await sendMediaPayload(payload);
    } catch (e) {
      Alert.alert('Could not send photo', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  async function toggleRecording() {
    // Recording in progress → stop, seal, send.
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        const status = await recording.getStatusAsync().catch(() => null);
        const durSec = status && 'durationMillis' in status ? (status.durationMillis ?? 0) / 1000 : 0;
        setRecording(null);
        if (uri) {
          const payload = await buildVoicePayload(conversationId, uri, 'audio/m4a', durSec);
          await sendMediaPayload(payload);
        }
      } catch (e) {
        setRecording(null);
        Alert.alert('Could not send voice note', e instanceof Error ? e.message : 'Please try again.');
      }
      return;
    }
    // Start recording.
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(rec);
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : 'Please try again.');
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
            if (MEDIA_ENABLED && item.contentType === 'media' && !item.undecryptable) {
              const payload = parseMediaPayload(item.body);
              if (payload) {
                return <MediaBubble mine={mine} at={item.createdAt} conversationId={conversationId} payload={payload} />;
              }
            }
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
        {MEDIA_ENABLED ? (
          <>
            <Pressable onPress={pickAndSendImage} hitSlop={8} style={{ paddingBottom: 10 }}>
              <Text style={{ fontSize: 22 }}>📎</Text>
            </Pressable>
            <Pressable onPress={toggleRecording} hitSlop={8} style={{ paddingBottom: 10 }}>
              <Text style={{ fontSize: 22 }}>{recording ? '⏹️' : '🎙️'}</Text>
            </Pressable>
          </>
        ) : null}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={recording ? 'Recording… tap ⏹️ to send' : 'Message'}
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

// WAGGLES_MEDIA1 — E2EE voice-note / image bubble. The file bytes are fetched +
// decrypted lazily (on first tap for audio, on mount for images) to a local
// cache URI; RN plays/renders from that URI. Gated behind MEDIA_ENABLED at the
// call site, so this is dead code in v1 until the owner flips the flag.
function MediaBubble(props: {
  mine: boolean;
  at: string;
  conversationId: string;
  payload: CommsMediaPayload;
}) {
  const t = useTheme();
  const { mine, at, conversationId, payload } = props;
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const ensureLocal = useCallback(async (): Promise<string | null> => {
    if (localUri) return localUri;
    setBusy(true);
    try {
      const uri = await decryptMediaToLocalUri(conversationId, payload);
      setLocalUri(uri);
      return uri;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }, [localUri, conversationId, payload]);

  useEffect(() => {
    if (payload.kind === 'image') void ensureLocal();
    return () => {
      void soundRef.current?.unloadAsync().catch(() => {});
    };
  }, [payload.kind, ensureLocal]);

  async function playAudio() {
    const uri = await ensureLocal();
    if (!uri) return;
    try {
      await soundRef.current?.unloadAsync().catch(() => {});
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;
    } catch {
      /* playback best-effort */
    }
  }

  const bubbleStyle = {
    alignSelf: mine ? ('flex-end' as const) : ('flex-start' as const),
    maxWidth: '82%' as const,
    backgroundColor: mine ? t.bubbleMine : t.bubbleTheirs,
    borderColor: t.border,
    borderWidth: mine ? 0 : 1,
    borderRadius: 18,
    padding: payload.kind === 'image' ? 4 : 12,
  };
  const ink = mine ? t.bubbleMineInk : t.bubbleTheirsInk;

  if (payload.kind === 'image') {
    const ratio = payload.w && payload.h ? payload.w / payload.h : 1;
    return (
      <View style={bubbleStyle}>
        {localUri ? (
          <Image
            source={{ uri: localUri }}
            style={{ width: 200, height: 200 / (ratio || 1), borderRadius: 14 }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ width: 200, height: 150, alignItems: 'center', justifyContent: 'center' }}>
            {busy ? <ActivityIndicator color={ink} /> : <Text style={{ color: ink }}>🔒 photo</Text>}
          </View>
        )}
        <Text style={{ color: ink, fontSize: 10, opacity: 0.7, marginTop: 3, marginLeft: 4 }}>{clock(at)}</Text>
      </View>
    );
  }

  // audio
  const dur = payload.dur ?? 0;
  const label = dur > 0 ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}` : 'Voice message';
  return (
    <Pressable onPress={playAudio} style={{ ...bubbleStyle, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {busy ? <ActivityIndicator color={ink} /> : <Text style={{ fontSize: 20 }}>▶️</Text>}
      <View>
        <Text style={{ color: ink, fontSize: 15 }}>🎙️ {label}</Text>
        <Text style={{ color: ink, fontSize: 10, opacity: 0.7 }}>{clock(at)}</Text>
      </View>
    </Pressable>
  );
}
