import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import {
  type Conversation,
  clearVerifiedSafetyNumber,
  conversationSafetyNumber,
  conversationTitle,
  getConversation,
  getVerifiedSafetyNumber,
  storeVerifiedSafetyNumber,
} from '@/lib/comms';
import { exportRecoveryCode, getDeviceId, importRecoveryCode } from '@/lib/e2ee';
import { clearHostConfig, getHostConfig } from '@/lib/config';
import { useTheme } from '@/lib/theme';

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { beeId, signOut } = useAuth();
  const params = useLocalSearchParams<{ conversation?: string }>();
  const conversationId = params.conversation ? String(params.conversation) : null;

  const [deviceId, setDeviceId] = useState('');
  const [hostUrl, setHostUrl] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [importCode, setImportCode] = useState('');

  const [conv, setConv] = useState<Conversation | null>(null);
  const [safety, setSafety] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    (async () => {
      setDeviceId(await getDeviceId());
      setHostUrl((await getHostConfig())?.url ?? '');
      if (conversationId && beeId) {
        const c = await getConversation(conversationId).catch(() => null);
        setConv(c);
        if (c) {
          const sn = await conversationSafetyNumber(c).catch(() => null);
          setSafety(sn);
          const stored = await getVerifiedSafetyNumber(beeId, conversationId);
          setVerified(!!sn && stored === sn);
        }
      }
    })();
  }, [conversationId, beeId]);

  async function toggleVerified() {
    if (!beeId || !conversationId || !safety) return;
    if (verified) {
      await clearVerifiedSafetyNumber(beeId, conversationId);
      setVerified(false);
    } else {
      await storeVerifiedSafetyNumber(beeId, conversationId, safety);
      setVerified(true);
    }
  }

  async function doExport() {
    if (!beeId) return;
    const code = await exportRecoveryCode(beeId);
    setRecovery(code);
  }

  async function doImport() {
    if (!beeId || !importCode.trim()) return;
    try {
      await importRecoveryCode(beeId, importCode.trim());
      setImportCode('');
      Alert.alert('Identity restored', 'This device now uses the restored key.');
    } catch {
      Alert.alert('Could not restore', 'That recovery code was not valid.');
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out', 'This wipes this device’s identity key and cached chats. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  }

  function forgetHost() {
    Alert.alert('Disconnect endpoint', 'Forget the self-host endpoint on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          await clearHostConfig();
          router.replace('/');
        },
      },
    ]);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: 48 }}>
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
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>
          {conv ? conversationTitle(conv, beeId ?? undefined) : 'Settings'}
        </Text>
      </View>

      {conv && safety ? (
        <Section t={t} title="Safety number">
          <Text style={{ color: t.textDim, fontSize: 13, marginBottom: 8, lineHeight: 19 }}>
            Compare these digits with the other person out loud or side by side. If they match, no one is
            in the middle. It changes when someone adds or removes a device.
          </Text>
          <Text
            style={{
              color: t.text,
              fontFamily: t.isDark ? undefined : undefined,
              fontSize: 18,
              letterSpacing: 2,
              lineHeight: 28,
              fontVariant: ['tabular-nums'],
            }}
          >
            {safety}
          </Text>
          <Pressable
            onPress={toggleVerified}
            style={{
              marginTop: 12,
              backgroundColor: verified ? t.surfaceAlt : t.accent,
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: verified ? t.text : t.accentInk, fontWeight: '700' }}>
              {verified ? 'Verified ✓ — tap to clear' : 'Mark as verified'}
            </Text>
          </Pressable>
        </Section>
      ) : null}

      <Section t={t} title="This device">
        <Row t={t} label="Device id" value={deviceId} />
        <Row t={t} label="Bee id" value={beeId ?? '—'} />
        <Text style={{ color: t.textDim, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
          Your identity secret key is generated on this device and stored only in its secure keystore.
          It never leaves unless you export a recovery code below.
        </Text>
      </Section>

      <Section t={t} title="Recovery code">
        <Text style={{ color: t.textDim, fontSize: 13, lineHeight: 19 }}>
          Export a code to move this identity to a new device. Anyone with this code can read your
          messages — store it somewhere only you control.
        </Text>
        {recovery ? (
          <View
            style={{
              backgroundColor: t.surfaceAlt,
              borderRadius: 10,
              padding: 12,
              marginTop: 10,
            }}
          >
            <Text selectable style={{ color: t.text, fontSize: 13 }}>
              {recovery}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={doExport}
            style={{ marginTop: 10, backgroundColor: t.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
          >
            <Text style={{ color: t.accentInk, fontWeight: '700' }}>Reveal recovery code</Text>
          </Pressable>
        )}
        <Text style={{ color: t.textDim, fontSize: 13, marginTop: 16 }}>Restore from a code:</Text>
        <TextInput
          value={importCode}
          onChangeText={setImportCode}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="paste recovery code"
          placeholderTextColor={t.textDim}
          style={{
            backgroundColor: t.surface,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: t.text,
            marginTop: 6,
          }}
        />
        <Pressable onPress={doImport} style={{ marginTop: 8, paddingVertical: 10, alignItems: 'center' }}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>Restore identity</Text>
        </Pressable>
      </Section>

      <Section t={t} title="Endpoint">
        <Row t={t} label="Connected to" value={hostUrl || '—'} />
        <Pressable onPress={forgetHost} style={{ marginTop: 10, paddingVertical: 8 }}>
          <Text style={{ color: t.danger, fontWeight: '700' }}>Disconnect this endpoint</Text>
        </Pressable>
      </Section>

      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <Pressable
          onPress={confirmSignOut}
          style={{ borderColor: t.danger, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
        >
          <Text style={{ color: t.danger, fontWeight: '800' }}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Section(props: { t: ReturnType<typeof useTheme>; title: string; children: ReactNode }) {
  const { t, title, children } = props;
  return (
    <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
      <Text style={{ color: t.textDim, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </Text>
      <View style={{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 14 }}>
        {children}
      </View>
    </View>
  );
}

function Row(props: { t: ReturnType<typeof useTheme>; label: string; value: string }) {
  const { t, label, value } = props;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 }}>
      <Text style={{ color: t.textDim, fontSize: 13 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: t.text, fontSize: 13, flex: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}
