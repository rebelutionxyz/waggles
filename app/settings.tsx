import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import {
  type Conversation,
  DISAPPEARING_ENABLED,
  GROUPS_ENABLED,
  MUTE_ENABLED,
  addGroupMember,
  clearVerifiedSafetyNumber,
  conversationSafetyNumber,
  conversationTitle,
  findBeeByHandle,
  getConversation,
  getVerifiedSafetyNumber,
  REPORTING_ENABLED,
  leaveConversation,
  removeGroupMember,
  reportBee,
  setConversationMuted,
  setDisappearing,
  setGroupAddPolicy,
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

  async function refreshConv() {
    if (!conversationId) return;
    setConv(await getConversation(conversationId).catch(() => null));
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

      {conv && conversationId && MUTE_ENABLED ? (
        <Section t={t} title="Notifications">
          {(() => {
            const muted = conv.participants.find((p) => p.beeId === beeId)?.muted ?? false;
            return (
              <Pressable
                onPress={() => setConversationMuted(conversationId, !muted).then(refreshConv).catch(() => {})}
              >
                <Text style={{ color: t.accent, fontWeight: '600' }}>
                  {muted ? '🔕 Muted — tap to unmute' : '🔔 Notifications on — tap to mute'}
                </Text>
              </Pressable>
            );
          })()}
        </Section>
      ) : null}

      {conv && conversationId && DISAPPEARING_ENABLED ? (
        <Section t={t} title="Disappearing messages">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(
              [
                ['Off', null],
                ['1 hour', 3600],
                ['1 day', 86400],
                ['1 week', 604800],
              ] as [string, number | null][]
            ).map(([label, secs]) => {
              const active = (conv.disappearSeconds ?? null) === secs;
              return (
                <Pressable
                  key={label}
                  onPress={() => setDisappearing(conversationId, secs).then(refreshConv).catch(() => {})}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: active ? t.accent : t.surfaceAlt,
                  }}
                >
                  <Text style={{ color: active ? t.accentInk : t.text, fontWeight: '600' }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: t.textDim, fontSize: 12, marginTop: 8 }}>
            New messages delete for everyone after the timer.
          </Text>
        </Section>
      ) : null}

      {conv && conversationId && REPORTING_ENABLED && conv.kind === 'direct'
        ? (() => {
            const other = conv.participants.find((p) => p.beeId !== beeId);
            if (!other) return null;
            return (
              <Section t={t} title="Report">
                <Pressable
                  onPress={() =>
                    Alert.alert(
                      `Report @${other.handle}`,
                      'Send a report to the operator? It references this conversation.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Report',
                          style: 'destructive',
                          onPress: () =>
                            reportBee(other.beeId, 'reported', conversationId)
                              .then(() => Alert.alert('Reported', 'Thanks — the operator will review it.'))
                              .catch(() => Alert.alert('Could not report', 'Try again.')),
                        },
                      ],
                    )
                  }
                >
                  <Text style={{ color: t.danger, fontWeight: '700' }}>Report @{other.handle}</Text>
                </Pressable>
              </Section>
            );
          })()
        : null}

      {conv?.kind === 'group' && GROUPS_ENABLED ? (
        <GroupSection t={t} conv={conv} beeId={beeId ?? null} onReload={refreshConv} onLeft={() => router.back()} />
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

// WAGGLES_GROUPS1 — group management (members, add/remove, add-policy, leave).
// Rendered only for a group conversation AND only while GROUPS_ENABLED (stays dark
// until the owner applies the fork migration + flips the flag). All writes go through
// the SECURITY DEFINER RPCs, which also enforce owner/member rules server-side.
function GroupSection({
  t,
  conv,
  beeId,
  onReload,
  onLeft,
}: {
  t: ReturnType<typeof useTheme>;
  conv: Conversation;
  beeId: string | null;
  onReload: () => Promise<void> | void;
  onLeft: () => void;
}) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const myRole = conv.participants.find((p) => p.beeId === beeId)?.role ?? 'member';
  const iAmOwner = myRole === 'owner';
  const canAdd = iAmOwner || conv.membersCanAdd;

  const add = async () => {
    const h = handle.trim().replace(/^@/, '');
    if (!h || busy) return;
    setBusy(true);
    try {
      const bee = await findBeeByHandle(h);
      if (!bee) {
        Alert.alert('Not found', `No bee @${h}.`);
        return;
      }
      await addGroupMember(conv.id, bee.id);
      setHandle('');
      await onReload();
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (bid: string) => {
    setBusy(true);
    try {
      await removeGroupMember(conv.id, bid);
      await onReload();
    } catch (e) {
      Alert.alert('Could not remove', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };
  const togglePolicy = async () => {
    setBusy(true);
    try {
      await setGroupAddPolicy(conv.id, !conv.membersCanAdd);
      await onReload();
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };
  const leave = () => {
    Alert.alert('Leave group', 'Leave this group? You will lose access to its messages.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveConversation(conv.id);
            onLeft();
          } catch {
            /* ignore */
          }
        },
      },
    ]);
  };

  return (
    <Section t={t} title="Group">
      {conv.participants.map((p) => (
        <View key={p.beeId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ color: t.text, flex: 1 }}>
            @{p.handle}
            {p.beeId === beeId ? ' (you)' : ''}
            {p.role === 'owner' ? '  · owner' : ''}
          </Text>
          {iAmOwner && p.role !== 'owner' ? (
            <Pressable onPress={() => void remove(p.beeId)} disabled={busy} hitSlop={8}>
              <Text style={{ color: t.danger, fontWeight: '700' }}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {canAdd ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TextInput
            value={handle}
            onChangeText={setHandle}
            placeholder="@handle to add"
            autoCapitalize="none"
            placeholderTextColor={t.textDim}
            style={{
              flex: 1,
              color: t.text,
              backgroundColor: t.surfaceAlt,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          />
          <Pressable
            onPress={() => void add()}
            disabled={busy || !handle.trim()}
            style={{ backgroundColor: t.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}
          >
            <Text style={{ color: t.accentInk, fontWeight: '700' }}>Add</Text>
          </Pressable>
        </View>
      ) : null}

      {iAmOwner ? (
        <Pressable onPress={() => void togglePolicy()} disabled={busy} style={{ marginTop: 12 }}>
          <Text style={{ color: t.accent, fontWeight: '600' }}>
            {conv.membersCanAdd
              ? '✓ Members can add others — tap to make owner-only'
              : 'Only the owner can add — tap to let members add'}
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={leave}
        style={{ marginTop: 16, borderColor: t.danger, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
      >
        <Text style={{ color: t.danger, fontWeight: '800' }}>Leave group</Text>
      </Pressable>
    </Section>
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
