import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { ANON_KEY_PREFILL, HOST_URL_PREFILL, setHostConfig } from '@/lib/config';
import { useTheme } from '@/lib/theme';

/**
 * WAGGLES_QR1 — a deployment's {url, anonKey} can be handed to a Bee as a QR so
 * they never type a long anon key. An operator (or the "use our network" flow)
 * shows the code; the Bee taps "Scan QR" here and the fields fill. The QR payload
 * is a tiny JSON object: {"url":"https://…","anonKey":"eyJ…"}. We also accept a
 * bare https URL (fills the host only) so a plain project-URL QR still helps.
 * Nothing here is a secret — the anon key is a public, RLS-gated client key.
 */
function parseConfigQr(raw: string): { url?: string; anonKey?: string } | null {
  const text = raw.trim();
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : undefined;
    const anonKey =
      typeof o.anonKey === 'string'
        ? o.anonKey
        : typeof o.anon === 'string'
          ? o.anon
          : undefined;
    if (url || anonKey) return { url, anonKey };
  } catch {
    /* not JSON — fall through */
  }
  try {
    const u = new URL(text);
    const url = u.searchParams.get('u') ?? u.searchParams.get('url') ?? undefined;
    const anonKey = u.searchParams.get('k') ?? u.searchParams.get('anonKey') ?? undefined;
    if (url || anonKey) return { url: url ?? undefined, anonKey: anonKey ?? undefined };
    if (/^https?:\/\//i.test(text)) return { url: text };
  } catch {
    if (/^https?:\/\//i.test(text)) return { url: text };
  }
  return null;
}

export default function Setup() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reconnect } = useAuth();
  const [url, setUrl] = useState(HOST_URL_PREFILL);
  const [anonKey, setAnonKey] = useState(ANON_KEY_PREFILL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  async function openScanner() {
    setErr(null);
    setScanNote(null);
    if (!perm?.granted) {
      const res = await requestPerm();
      if (!res.granted) {
        setErr('Camera permission is needed to scan a setup code.');
        return;
      }
    }
    setScanning(true);
  }

  function onScanned(result: BarcodeScanningResult) {
    const parsed = parseConfigQr(result.data);
    setScanning(false);
    if (!parsed) {
      setScanNote("That code isn't a Waggles setup code.");
      return;
    }
    if (parsed.url) setUrl(parsed.url);
    if (parsed.anonKey) setAnonKey(parsed.anonKey);
    setScanNote(
      parsed.url && parsed.anonKey
        ? 'Filled from the code — tap Connect.'
        : 'Filled part of the setup from the code.',
    );
  }

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

  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScanned}
        />
        <View style={{ position: 'absolute', top: insets.top + 24, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            Point at your Waggles setup code
          </Text>
        </View>
        <View style={{ position: 'absolute', bottom: insets.bottom + 32, left: 24, right: 24 }}>
          <Pressable
            onPress={() => setScanning(false)}
            style={{
              backgroundColor: t.surface,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
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
          A sovereign, end-to-end-encrypted messenger. Point it at your own comms server — your
          private keys stay on this device; the server you choose stores only ciphertext. Nothing
          routes through us.
        </Text>

        <Pressable
          onPress={openScanner}
          style={{
            borderColor: t.accent,
            borderWidth: 1,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          <Text style={{ color: t.accent, fontWeight: '700', fontSize: 15 }}>Scan setup code</Text>
        </Pressable>
        {scanNote ? <Text style={{ color: t.textDim, fontSize: 13 }}>{scanNote}</Text> : null}

        <View style={{ gap: 6, marginTop: 4 }}>
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
