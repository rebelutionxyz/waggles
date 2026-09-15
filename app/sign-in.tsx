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
import { getSupabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function SignIn() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode() {
    setErr(null);
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStage('code');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setErr(null);
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      });
      if (error) throw error;
      router.replace('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That code did not work.');
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
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 64, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 30, fontWeight: '800', color: t.text }}>
          {stage === 'email' ? 'Sign in' : 'Enter your code'}
        </Text>
        <Text style={{ fontSize: 15, color: t.textDim, lineHeight: 22 }}>
          {stage === 'email'
            ? 'We send a one-time code to your email. No password.'
            : `We emailed a 6-digit code to ${email}.`}
        </Text>

        {stage === 'email' ? (
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={t.textDim}
            style={inputStyle(t)}
          />
        ) : (
          <TextInput
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            keyboardType="number-pad"
            placeholder="123456"
            placeholderTextColor={t.textDim}
            style={[inputStyle(t), { fontSize: 24, letterSpacing: 8, textAlign: 'center' }]}
          />
        )}

        {err ? <Text style={{ color: t.danger }}>{err}</Text> : null}

        <Pressable
          onPress={stage === 'email' ? sendCode : verify}
          disabled={busy}
          style={{
            backgroundColor: t.accent,
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: busy ? 0.6 : 1,
            marginTop: 4,
          }}
        >
          {busy ? (
            <ActivityIndicator color={t.accentInk} />
          ) : (
            <Text style={{ color: t.accentInk, fontWeight: '800', fontSize: 16 }}>
              {stage === 'email' ? 'Send code' : 'Verify'}
            </Text>
          )}
        </Pressable>

        {stage === 'code' ? (
          <Pressable onPress={() => setStage('email')} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ color: t.textDim }}>Use a different email</Text>
          </Pressable>
        ) : null}
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
    paddingVertical: 14,
    color: t.text,
    fontSize: 16,
  } as const;
}
