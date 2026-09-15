import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { ANON_KEY_PREFILL, HOST_URL_PREFILL, setHostConfig } from '@/lib/config';
import { useTheme } from '@/lib/theme';

export default function Setup() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reconnect } = useAuth();
  // Empty unless an operator set EXPO_PUBLIC_WAGGLES_HOST_URL for their own
  // deployment. No vendor default — see lib/config.ts (WAGGLES_F2, ruling #4).
  const [url, setUrl] = useState(HOST_URL_PREFILL);
  const [anonKey, setAnonKey] = useState(ANON_KEY_PREFILL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    setErr(null);
    setBusy(true);
    try {
      await setHostConfig({ url, anonKey });
      await reconnect();
      router.replace('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: t.bg }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 48, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 34, fontWeight: '800', color: t.text }}>Waggles</Text>
        <Text style={{ fontSize: 15, color: t.textDim, lineHeight: 22 }}>
          A sovereign, end-to-end-encrypted messenger. Point it at your own HONEYCOMB comms backend —
          your keys, your server, your messages. Nothing routes through us.
        </Text>

        <View style={{ gap: 6, marginTop: 12 }}>
          <Text style={{ color: t.textDim, fontSize: 13, fontWeight: '600' }}>Endpoint URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://your-project.supabase.co"
            placeholderTextColor={t.textDim}
            style={inputStyle(t)}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: t.textDim, fontSize: 13, fontWeight: '600' }}>Anon key (public)</Text>
          <TextInput
            value={anonKey}
            onChangeText={setAnonKey}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder="eyJ… your project's public anon key"
            placeholderTextColor={t.textDim}
            style={[inputStyle(t), { minHeight: 88, textAlignVertical: 'top' }]}
          />
          <Text style={{ color: t.textDim, fontSize: 12, lineHeight: 17 }}>
            The anon key is a public, RLS-gated client key — safe to paste here. Your identity SECRET
            key is generated on-device and stored only in this phone's secure keystore.
          </Text>
        </View>

        {err ? <Text style={{ color: t.danger }}>{err}</Text> : null}

        <Pressable
          onPress={connect}
          disabled={busy}
          style={{
            backgroundColor: t.accent,
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: busy ? 0.6 : 1,
            marginTop: 8,
          }}
        >
          {busy ? (
            <ActivityIndicator color={t.accentInk} />
          ) : (
            <Text style={{ color: t.accentInk, fontWeight: '800', fontSize: 16 }}>Connect</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function inputStyle(t: ReturnType<typeof useTheme>) {
  return {
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: t.text,
    fontSize: 15,
  } as const;
}
