import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createGroup, searchBees, startDirect } from '@/lib/comms';
import { initials } from '@/lib/format';
import { useTheme } from '@/lib/theme';

interface Hit {
  id: string;
  handle: string;
  name: string | null;
}

export default function NewChat() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Hit[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  async function runSearch(text: string) {
    setQ(text);
    if (text.trim().length < 1) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      setHits(await searchBees(text));
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  function toggle(h: Hit) {
    setSelected((s) => (s.find((x) => x.id === h.id) ? s.filter((x) => x.id !== h.id) : [...s, h]));
  }

  async function openDirect(h: Hit) {
    setBusy(true);
    try {
      const cid = await startDirect(h.id);
      router.replace({ pathname: '/c/[id]', params: { id: cid } });
    } catch {
      setBusy(false);
    }
  }

  async function makeGroup() {
    if (selected.length < 2) return;
    setBusy(true);
    try {
      const cid = await createGroup(groupName.trim() || 'New group', selected.map((s) => s.id));
      router.replace({ pathname: '/c/[id]', params: { id: cid } });
    } catch {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: t.accent, fontSize: 26, fontWeight: '700' }}>‹</Text>
        </Pressable>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>New chat</Text>
      </View>

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <TextInput
          value={q}
          onChangeText={runSearch}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Search by @handle"
          placeholderTextColor={t.textDim}
          style={{
            backgroundColor: t.surface,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: t.text,
            fontSize: 16,
          }}
        />

        {selected.length > 0 ? (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {selected.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => toggle(s)}
                  style={{
                    backgroundColor: t.accent,
                    borderRadius: 14,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <Text style={{ color: t.accentInk, fontWeight: '700', fontSize: 13 }}>@{s.handle} ✕</Text>
                </Pressable>
              ))}
            </View>
            {selected.length >= 2 ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder="Group name"
                  placeholderTextColor={t.textDim}
                  style={{
                    flex: 1,
                    backgroundColor: t.surface,
                    borderColor: t.border,
                    borderWidth: 1,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    color: t.text,
                  }}
                />
                <Pressable
                  onPress={makeGroup}
                  style={{
                    backgroundColor: t.accent,
                    borderRadius: 12,
                    paddingHorizontal: 18,
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: t.accentInk, fontWeight: '800' }}>Create</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={{ color: t.textDim, fontSize: 12 }}>Pick one more to start a group.</Text>
            )}
          </View>
        ) : null}
      </View>

      {searching ? (
        <ActivityIndicator color={t.accent} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.id}
          style={{ marginTop: 8 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const picked = !!selected.find((x) => x.id === item.id);
            return (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: t.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: t.text, fontWeight: '700' }}>{initials(item.handle, item.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>@{item.handle}</Text>
                  {item.name ? <Text style={{ color: t.textDim, fontSize: 13 }}>{item.name}</Text> : null}
                </View>
                <Pressable
                  onPress={() => toggle(item)}
                  disabled={busy}
                  style={{
                    borderColor: t.accent,
                    borderWidth: 1.5,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    backgroundColor: picked ? t.accent : 'transparent',
                  }}
                >
                  <Text style={{ color: picked ? t.accentInk : t.accent, fontWeight: '700', fontSize: 13 }}>
                    {picked ? 'Added' : 'Add'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => openDirect(item)}
                  disabled={busy}
                  style={{
                    backgroundColor: t.accent,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: t.accentInk, fontWeight: '700', fontSize: 13 }}>Chat</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
