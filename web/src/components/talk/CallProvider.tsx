'use client';

import { useSession } from '@/lib/auth';
import { DATA_SOURCE } from '@/lib/data/provider';
import {
  awaitMyCallKey,
  callerHandle,
  conversationIsGroup,
  createCallRoom,
  currentCallEpoch,
  hasCallEncryption,
  hostSealNewCallKey,
  joinRoom,
  leaveRoom,
  subscribeIncomingCalls,
  type IncomingCallEvent,
} from '@/lib/calls';
import { getBrowserClient } from '@/lib/supabase/client';
import styles from './CallProvider.module.css';
import {
  type ReactNode,
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
const CallView = lazy(() => import('./CallView').then((m) => ({ default: m.CallView })));

/**
 * TALK_CALLS1 — ported from TheMANUAL.tech's CallProvider.tsx. Global call
 * layer, mounted ONCE at the app root (TalkShell), so:
 *  - an incoming call rings the Bee ANYWHERE in TALK, not only inside the
 *    open conversation, and
 *  - an accepted call keeps running as they navigate between conversations.
 *
 * Ring lifecycle: the server (`comms_room_create`) writes a `call_incoming`
 * notification to every OTHER member; the `notifications` table is in the
 * Realtime publication, so each Bee's client receives its own row live. The
 * ring sounds up to RING_COUNT times, then auto-misses. It also clears the
 * instant the caller hangs up (we watch the call room's status). Any
 * dismissal that wasn't an explicit accept/decline surfaces a "Missed call
 * from …" toast; the room-scoped inline note in ThreadPane (lib/calls.ts's
 * listMissedCalls) is the durable record — this toast is just the live nudge.
 *
 * WAGGLES_WEBCALLS1 (2026-10-14): the ring is comms_rooms realtime, not a
 * notifications table (the fork has none) — mirrors native subscribeIncomingCalls.
 * No push/decline/accept RPC port; a declined/unanswered call just times out.
 *
 * LIVE ONLY: every effect below is a no-op when DATA_SOURCE !== 'live' -
 * mock mode has no comms_rooms/notifications backend to ring against.
 *
 * E2EE IS ON WITH NO FLAG TO TURN IT OFF (this pass's own dispatch, verbatim
 * — the opposite of TheMANUAL.tech's opt-in-only ?e2ee=1 default). `startCall`
 * refuses to ring the other side at all when this device can't yet derive a
 * key for the conversation (hasCallEncryption below); `accept` declines
 * rather than joining unencrypted. Neither ever falls back to transport-only.
 */

const RING_COUNT = 13; // how many times we ring before giving up
const RING_INTERVAL_MS = 3000; // spacing between rings
// A little past the audible rings — a safety net in case the ringer never ran
// (e.g. a call arriving while already in another call, so the tone is muted).
const RING_MISS_MS = RING_COUNT * RING_INTERVAL_MS + 3000;

interface Incoming {
  roomId: string;
  title: string;
  from: string; // caller handle, e.g. "@butch" — for the "Missed call from …" note
  video: boolean;
  convId: string | null;
}
interface ActiveCall {
  roomId: string;
  video: boolean;
  e2eeKey: string | null;
  outgoing: boolean; // true = I placed this call and am waiting for pickup
  peerName: string; // who I'm calling / talking to, for the call screen
  phone: boolean; // 1:1/group voice call → audio-only "phone" screen
  group: boolean; // group conversation → simulcast/dynacast on (TALK_MULTI1)
  // CALL_KEY_MF v0.1 KEY-2: the sealed per-call key (CCK) context.
  convId: string | null; // conversation the call is bound to (host reseals its members)
  isHost: boolean; // this device minted the room → it rotates the key on membership change
  epoch: number; // the call_key_epoch this device's current media key belongs to
}

interface CallCtx {
  /**
   * Start (or rejoin) a call bound to `conversationId`, then drop into it.
   * `group` (a group conversation, not a 1:1) turns on the multi-caller publish
   * path — see CallView's roomOptionsFor.
   */
  startCall: (
    conversationId: string,
    video: boolean,
    peerName: string,
    group?: boolean,
  ) => Promise<void>;
  inCall: boolean;
}

const Ctx = createContext<CallCtx | null>(null);

export function useCall(): CallCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCall must be used within CallProvider');
  return c;
}

/**
 * iOS/Safari won't play Web Audio until the user has interacted with the page.
 * We keep ONE shared AudioContext and "unlock" it on the first tap/keypress
 * anywhere in the app, so a later incoming-call ring can actually make sound
 * even though the call itself arrived without a fresh gesture.
 */
let sharedAudio: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedAudio) sharedAudio = new AC();
  sharedAudio.resume?.().catch(() => {});
  return sharedAudio;
}
function installAudioUnlock() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    const ctx = audioContext();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchend', unlock);
    window.removeEventListener('keydown', unlock);
    if (!ctx) return;
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

/**
 * Synthesized ringtone — no audio asset needed. Rings RING_COUNT times, then
 * calls `onExhausted` (used to auto-miss the call). installAudioUnlock() primes
 * a shared context on first interaction so the ring can sound on iOS. If audio
 * is still blocked, the ring COUNT still advances, so the auto-miss fires on
 * time regardless.
 */
function useRinger(active: boolean, onExhausted?: () => void) {
  const exhaustedRef = useRef(onExhausted);
  exhaustedRef.current = onExhausted;

  useEffect(() => {
    if (!active) return;

    const beep = () => {
      const c = audioContext();
      if (!c) return; // no audio (blocked / unsupported) — stay silent, keep counting
      const g = c.createGain();
      g.connect(c.destination);
      const t = c.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
      g.gain.setValueAtTime(0.22, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      for (const freq of [440, 480]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        o.connect(g);
        o.start(t);
        o.stop(t + 1.0);
      }
    };

    let rings = 1;
    beep();
    try {
      navigator.vibrate?.([400, 200, 400]);
    } catch {
      /* vibrate unsupported (e.g. iOS) */
    }
    const id = window.setInterval(() => {
      rings += 1;
      beep();
      if (rings >= RING_COUNT) {
        clearInterval(id);
        exhaustedRef.current?.();
      }
    }, RING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const beeId = session.beeId;
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const ringTimer = useRef<number | null>(null);
  const incomingRef = useRef<Incoming | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);

  // Keep refs of current incoming/active so timers + subscriptions read fresh state.
  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const clearRing = () => {
    if (ringTimer.current) {
      clearTimeout(ringTimer.current);
      ringTimer.current = null;
    }
  };

  // Dismiss the incoming ring. 'missed' (caller hung up / no answer) leaves a
  // "Missed call from …" toast; 'handled' (I accepted or declined) is silent.
  const dismissIncoming = useCallback(
    (reason: 'handled' | 'missed' = 'handled') => {
      clearRing();
      const cur = incomingRef.current;
      if (cur && reason === 'missed') {
        showToast(`Missed call from ${cur.from}`);
      }
      setIncoming(null);
    },
    [showToast],
  );

  // Audible ring while a call is coming in (and we're not already in one).
  // When the rings run out, treat it as a miss.
  useRinger(!!incoming && !active, () => dismissIncoming('missed'));

  const startCall = useCallback(
    async (conversationId: string, video: boolean, peerName: string, group = false) => {
      if (DATA_SOURCE !== 'live' || !beeId) return;
      // E2EE is on with no flag to turn it off: check BEFORE creating a room
      // (which rings the other side) so a device that can't encrypt yet
      // never places a call it would have to run unencrypted.
      if (!(await hasCallEncryption(conversationId, beeId))) {
        throw new Error(
          'Encryption is still linking this device - open this conversation in TALK, let it sync, then try the call again.',
        );
      }
      const { roomId, host } = await createCallRoom(conversationId, video ? 'video' : 'audio');
      // WAGGLES_ROOMLIFECYCLE1: server decides host vs joiner by host presence.
      // Host → seal a fresh CCK at currentEpoch+1 (a reused room may be past
      // epoch 0; comms_put_call_keys rejects a backward epoch). Not host → join
      // + fetch my sealed key.
      let key: string;
      let epoch: number;
      if (host) {
        try {
          const cur = await currentCallEpoch(roomId);
          epoch = cur + 1;
          key = await hostSealNewCallKey(conversationId, roomId, beeId, epoch);
        } catch {
          await leaveRoom(roomId).catch(() => {});
          throw new Error('Could not secure this call - try again in a moment.');
        }
      } else {
        await joinRoom(roomId, 'speaker');
        const got = await awaitMyCallKey(roomId, beeId).catch(() => null);
        if (!got) {
          await leaveRoom(roomId).catch(() => {});
          throw new Error('Could not secure this call - try again in a moment.');
        }
        key = got.key;
        epoch = got.epoch;
      }
      setActive({
        roomId,
        video,
        e2eeKey: key,
        outgoing: host,
        peerName,
        phone: true,
        group,
        convId: conversationId,
        isHost: host,
        epoch,
      });
    },
    [beeId],
  );

  const accept = useCallback(async () => {
    const cur = incomingRef.current;
    if (!cur || !beeId) return;
    const { roomId, video, convId, from } = cur;
    const group = convId ? await conversationIsGroup(convId).catch(() => false) : false;
    try {
      // Join FIRST so a host that seals to ROOM participants (native app) reseals
      // to include this device; THEN fetch the sealed CCK.
      await joinRoom(roomId, 'speaker');
      const got = await awaitMyCallKey(roomId, beeId).catch(() => null);
      if (!got) {
        await leaveRoom(roomId).catch(() => {});
        dismissIncoming('handled');
        showToast('Could not establish encryption for this call.');
        return;
      }
      dismissIncoming('handled');
      setActive({
        roomId,
        video,
        e2eeKey: got.key,
        outgoing: false,
        peerName: from,
        phone: true,
        group,
        convId,
        isHost: false,
        epoch: got.epoch,
      });
    } catch {
      dismissIncoming('handled');
      showToast('Could not join the call');
    }
  }, [dismissIncoming, showToast, beeId]);

  const decline = useCallback(async () => {
    const cur = incomingRef.current;
    if (!cur) return;
    // The fork has no decline RPC; just stop ringing (caller's ring times out).
    dismissIncoming('handled');
  }, [dismissIncoming]);

  // Live incoming-call ring: subscribe to comms_rooms over Realtime (the fork
  // has no notifications table). RLS delivers only rooms in conversations I am a
  // member of; filter to live 'call' rooms I did not start.
  useEffect(() => {
    if (DATA_SOURCE !== 'live' || !beeId) return;
    const sub = subscribeIncomingCalls((e: IncomingCallEvent) => {
      if (e.kind !== 'call') return;
      if (e.status !== 'live') {
        if (incomingRef.current?.roomId === e.roomId) dismissIncoming('missed');
        return;
      }
      // Only a NEW room (INSERT) rings. An UPDATE to a still-live room (e.g. the
      // host resealing / epoch bump) must NOT re-ring a call I just left.
      if (e.eventType !== 'INSERT') return;
      if (e.hostBeeId === beeId) return;
      if (activeRef.current) return;
      if (incomingRef.current?.roomId === e.roomId) return;
      clearRing();
      void callerHandle(e.hostBeeId).then((h) => {
        const from = h ? `@${h}` : 'someone';
        setIncoming({
          roomId: e.roomId,
          title: `${from} is calling`,
          from,
          video: e.title !== 'audio',
          convId: e.conversationId,
        });
      });
      ringTimer.current = window.setTimeout(() => dismissIncoming('missed'), RING_MISS_MS);
    });
    return () => sub.close();
  }, [beeId, dismissIncoming]);

  // Never ring for the call you're already in.
  useEffect(() => {
    if (active && incoming && active.roomId === incoming.roomId) dismissIncoming('handled');
  }, [active, incoming, dismissIncoming]);

  // Prime audio on the first interaction so incoming-call rings can play (iOS).
  useEffect(() => {
    installAudioUnlock();
  }, []);

  // Stop ringing the instant the caller hangs up (their call room leaves 'live')
  // — and surface it as a missed call.
  useEffect(() => {
    if (DATA_SOURCE !== 'live' || !incoming) return;
    const client = getBrowserClient();
    const channel = client
      .channel(`ring:${incoming.roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'comms_rooms',
          filter: `id=eq.${incoming.roomId}`,
        },
        (payload) => {
          const status = (payload.new as { status?: string })?.status;
          if (status && status !== 'live') dismissIncoming('missed');
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [incoming, dismissIncoming]);

  return (
    <Ctx.Provider value={{ startCall, inCall: !!active }}>
      {children}

      {/* Active call — rendered app-wide so it survives navigation. */}
      {active && (
        <Suspense fallback={null}>
          <CallView
            key={active.roomId}
            roomId={active.roomId}
            video={active.video}
            e2eeKey={active.e2eeKey}
            outgoing={active.outgoing}
            peerName={active.peerName}
            phone={active.phone}
            group={active.group}
            convId={active.convId}
            isHost={active.isHost}
            myBeeId={beeId}
            endWhenAlone
            onClose={(reason) => {
              const who = active.peerName || 'them';
              setActive(null);
              if (reason === 'no-answer') showToast(`No answer from ${who}`);
            }}
          />
        </Suspense>
      )}

      {/* Incoming ring — appears anywhere in TALK. */}
      {incoming && !active && (
        <div className={styles.ringWrap}>
          <div className={styles.ringCard}>
            <span className={styles.ringIcon}>📞</span>
            <div className={styles.ringInfo}>
              <div className={styles.ringTitle}>{incoming.title}</div>
              <div className={styles.ringSub}>
                {incoming.video ? 'Incoming video call' : 'Incoming voice call'}
              </div>
            </div>
            <button type="button" onClick={decline} className={styles.declineBtn}>
              Decline
            </button>
            <button type="button" onClick={accept} className={styles.acceptBtn}>
              Accept
            </button>
          </div>
        </div>
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </Ctx.Provider>
  );
}
