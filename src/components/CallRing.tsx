import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { callerHandle, subscribeIncomingCalls } from '@/lib/calls';
import { useTheme } from '@/lib/theme';

/* ============================================================
   WAGGLES_CALL_RING1 — the incoming-call ring. Mounted once at the app root. For
   the signed-in bee it subscribes to comms_rooms realtime; RLS delivers only rooms
   in the bee's own conversations, so a live 'call' room started by SOMEONE ELSE
   prompts an Answer/Decline modal. Answer navigates to the E2EE call screen as a
   joiner (which joins the room, so the host reseals it a key). Decline dismisses.
   No notifications table is involved (the fork has none) — the room row IS the ring.
   ============================================================ */

type Incoming = { roomId: string; label: string };

export function CallRing() {
  const { beeId } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const dismissed = useRef<Set<string>>(new Set());
  const currentRef = useRef<string | null>(null);
  currentRef.current = incoming?.roomId ?? null;

  useEffect(() => {
    if (!beeId) return;
    let live = true;
    const sub = subscribeIncomingCalls(beeId, (e) => {
      if (!live) return;
      // A call that ended clears any matching ring.
      if (e.status !== 'live') {
        if (currentRef.current === e.roomId) setIncoming(null);
        return;
      }
      if (e.kind !== 'call') return; // spaces/roulette don't ring here
      if (e.hostBeeId === beeId) return; // my own outgoing call
      if (dismissed.current.has(e.roomId)) return; // already declined
      // Only a FRESH room rings — a stale 'live' row (e.g. delivered on reconnect)
      // must not ring for a call that is long over.
      const ageMs = Date.now() - new Date(e.startedAt).getTime();
      if (!(ageMs >= 0 && ageMs < 60_000)) return;
      void callerHandle(e.hostBeeId).then((h) => {
        if (live && currentRef.current !== e.roomId) {
          setIncoming({ roomId: e.roomId, label: h ? `@${h} is calling` : 'Incoming call' });
        }
      });
    });
    return () => {
      live = false;
      sub.close();
    };
  }, [beeId]);

  if (!incoming) return null;

  const answer = () => {
    const { roomId } = incoming;
    setIncoming(null);
    router.push({ pathname: '/call/[id]', params: { id: roomId, role: 'join', video: '1' } });
  };
  const decline = () => {
    dismissed.current.add(incoming.roomId);
    setIncoming(null);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={decline}>
      <View style={styles.scrim}>
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[styles.title, { color: t.text }]}>{incoming.label}</Text>
          <Text style={[styles.sub, { color: t.textDim }]}>End-to-end encrypted</Text>
          <View style={styles.row}>
            <Pressable onPress={decline} style={[styles.btn, { backgroundColor: t.surfaceAlt }]}>
              <Text style={[styles.btnText, { color: t.text }]}>Decline</Text>
            </Pressable>
            <Pressable onPress={answer} style={[styles.btn, { backgroundColor: t.accent }]}>
              <Text style={[styles.btnText, { color: t.accentInk }]}>Answer</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 },
  card: { width: '100%', maxWidth: 340, borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: 13, marginTop: 6, marginBottom: 20 },
  row: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { fontWeight: '800' },
});
