import { Link, Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import {
  type Conversation,
  conversationTitle,
  hasUnread,
  listConversations,
  presencePing,
  subscribeConversationList,
} from '@/lib/comms';
import { cacheConversations, loadCachedConversations } from '@/lib/cache';
import { initials, relTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function Chats() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, beeId, connected } = useAuth();
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await listConversations();
      setConvos(list);
      setOffline(false);
      await cacheConversations(list);
    } catch {
      const cached = await loadCachedConversations();
      setConvos(cached);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setConvos(await loadCachedConversations());
      await load();
    })();
    presencePing().catch(() => {});
  }, [load]);

  useEffect(() => {
    const token = session?.access_token ?? null;
    const sub = subscribeConversationList(token, () => {
      load();
    });
    return () => sub?.close();
  }, [session?.access_token, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!connected) return <Redirect href="/setup" />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ fontSize: 28, fontWeight: '800', color: t.text }}>Waggles</Text>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10}>
            <Text style={{ fontSize: 22 }}>⚙️</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/new')} hitSlop={10}>
            <Text style={{ fontSize: 26, color: t.accent, fontWeight: '800' }}>＋</Text>
          </Pressable>
        </View>
      </View>

      {offline ? (
        <View style={{ backgroundColor: t.surfaceAlt, paddingVertical: 6, alignItems: 'center' }}>
          <Text style={{ color: t.textDim, fontSize: 12 }}>Offline — showing cached chats</Text>
        </View>
      ) : null}

      {loading && convos.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : (
        <FlatList
          data={convos}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.accent} />}
          ListEmptyComponent={
            <View style={{ padding: 40, alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 40 }}>🐝</Text>
              <Text style={{ color: t.textDim, textAlign: 'center' }}>
                No conversations yet. Tap ＋ to start one.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const title = conversationTitle(item, beeId ?? undefined);
            const unread = hasUnread(item, beeId ?? undefined);
            return (
              <Link href={{ pathname: '/c/[id]', params: { id: item.id } }} asChild>
                <Pressable
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                  }}
                >
                  <View
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      backgroundColor: t.surfaceAlt,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: t.text, fontWeight: '700' }}>
                      {item.kind === 'group' ? '#' : initials(title.replace(/^@/, ''), null)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, borderBottomColor: t.border, borderBottomWidth: 0 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text
                        numberOfLines={1}
                        style={{ color: t.text, fontSize: 16, fontWeight: unread ? '800' : '600', flex: 1 }}
                      >
                        {title}
                      </Text>
                      <Text style={{ color: t.textDim, fontSize: 12 }}>{relTime(item.lastMessageAt)}</Text>
                    </View>
                    <Text numberOfLines={1} style={{ color: t.textDim, fontSize: 13, marginTop: 2 }}>
                      {item.participants.length} member{item.participants.length === 1 ? '' : 's'} · 🔒 encrypted
                    </Text>
                  </View>
                  {unread ? (
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent }} />
                  ) : null}
                </Pressable>
              </Link>
            );
          }}
        />
      )}
    </View>
  );
}
