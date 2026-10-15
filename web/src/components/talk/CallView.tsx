'use client';

import '@livekit/components-styles';
// TALK_CALLS1 — ported from TheMANUAL.tech's CallView.tsx (COMMS_ROOMS1's
// scoped override layer included from the start, not bolted on later).
import './livekit-overrides.css';
// TALK's Tailwind is scoped to @honeycomb/shell only (SHELLCSS_TALK1) — the
// reference's Tailwind classNames are ported here as a CSS Module instead;
// see this file's header comment for why.
import styles from './CallView.module.css';
import {
  awaitMyCallKey,
  currentCallEpoch,
  getRoomToken,
  hostSealNewCallKey,
  leaveRoom,
  listRoomHandles,
  roomHeartbeat,
} from '@/lib/calls';
import { getBrowserClient } from '@/lib/supabase/client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoConference,
  useRoomContext,
} from '@livekit/components-react';
import {
  DisconnectReason,
  ExternalE2EEKeyProvider,
  Room,
  RoomEvent,
  type RoomOptions,
  type VideoCaptureOptions,
} from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * TALK_CALLS1 — verbatim port of TheMANUAL.tech's src/components/comms/
 * CallView.tsx. Same room options, same H.264/no-simulcast reasoning (see
 * ROOM_OPTIONS below), same wake-lock/E2EE-badge/end-watcher behavior. Only
 * the imports change (lib/calls instead of lib/comms) — this is a call
 * screen, not a TalkData consumer; see lib/calls.ts's header for why calls
 * live outside the contract seam.
 */

// TALK_MULTI1 — publish/subscribe options, now GROUP-AWARE.
//
// H.264 always, so iPadOS/iOS Safari can hardware-decode remote video and encode
// its own (VP8/VP9 often render as a black frame / freeze on Safari).
//
// simulcast is the one that flips by call size:
//   • 1:1  → OFF. A single stream — Safari can render black when it negotiates
//            among H.264 simulcast layers, and join order changed that
//            negotiation (the directional iPad-as-caller black). This is the
//            hard-won TALK_CALLS1 fix and it stays for 1:1.
//   • group → ON (CALLS_MULTI_MF v0.1 §6f: "a group call should turn simulcast
//            back ON"). With N subscribers of differing downlink, adaptive
//            layers + dynacast (pause layers nobody is watching) + adaptiveStream
//            (subscribe at the size actually rendered) are what keep an 8-way
//            grid inside each viewer's bandwidth.
//
// CRUCIAL: because TALK's calls are ALWAYS E2EE, CallView hands <LiveKitRoom> a
// pre-built `room` (constructed below), and @livekit/components-react IGNORES the
// `options` prop whenever a room is passed ("the options object will be ignored").
// So these options MUST be applied to `new Room(...)` — passing them only to
// <LiveKitRoom options=…> is dead. That is why roomOptions is threaded into the
// Room constructor in the E2EE effect, not just onto the element.
function roomOptionsFor(group: boolean): RoomOptions {
  return {
    publishDefaults: { videoCodec: 'h264', simulcast: group },
    // A calls app must NOT treat tab-hide as hang-up. livekit-client defaults
    // this to true and listens for pagehide/freeze — which iOS fires on screen
    // lock or a brief app switch, so an outgoing call died the moment the
    // caller's phone dimmed. With false, brief hides ride LiveKit's reconnect
    // instead of disconnecting.
    disconnectOnPageLeave: false,
    // Group only: adapt to each subscriber's link and pause unwatched layers.
    ...(group ? { dynacast: true, adaptiveStream: true } : {}),
  };
}

// Cap capture at VGA/24fps. iPad/iOS Safari freezes or blacks out its own
// high-res camera under WebRTC load; a modest resolution is far more stable and
// is plenty for a 1:1 call. Best-effort — Safari video is still finicky.
const VIDEO_CAPTURE: VideoCaptureOptions = {
  resolution: { width: 640, height: 480, frameRate: 24 },
};

/**
 * A live LiveKit call (video or audio-only).
 *
 * PROVEN CONNECTION PATH: LiveKitRoom manages its own room for plain calls. We
 * only OBSERVE that room (via useRoomContext, in <CallEndWatcher>) to end the
 * call once everyone else has left — we never replace the room, which is what
 * previously regressed calls in the reference implementation.
 *
 * An UNEXPECTED disconnect (not us hanging up) surfaces its reason on-screen —
 * a diagnostic for the iOS Safari drop this pattern was built for.
 */
export function CallView({
  roomId,
  video = true,
  e2eeKey,
  peerName,
  phone,
  group = false,
  convId = null,
  isHost = false,
  myBeeId,
  endWhenAlone,
  onClose,
}: {
  roomId: string;
  video?: boolean;
  e2eeKey?: string | null;
  outgoing?: boolean;
  peerName?: string;
  phone?: boolean;
  /** Group call → simulcast/dynacast on (see roomOptionsFor). Default 1:1. */
  group?: boolean;
  /** CALL_KEY_MF v0.1 KEY-2: conversation this call is bound to (host reseals its members). */
  convId?: string | null;
  /** This device minted the room → it rotates the sealed key on membership change. */
  isHost?: boolean;
  /** This device's bee id — needed to fetch/unseal its sealed call-key row. */
  myBeeId?: string | null;
  endWhenAlone?: boolean;
  onClose: (reason?: 'no-answer') => void;
}) {
  const [creds, setCreds] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [e2eeRoom, setE2eeRoom] = useState<Room | null>(null);
  const [e2eeReady, setE2eeReady] = useState(!e2eeKey);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const closedRef = useRef(false);
  // KEY-2: the live key provider, so a rotation can setKey a fresh CCK on it.
  const keyProviderRef = useRef<ExternalE2EEKeyProvider | null>(null);

  // Group-aware publish/subscribe options (see roomOptionsFor). Stable per call
  // (group never changes mid-call), so the E2EE effect below can depend on it.
  const roomOptions = useMemo(() => roomOptionsFor(group), [group]);

  // beeId → @handle for the multi-party AudioStage roster. Best-effort.
  useEffect(() => {
    let cancelled = false;
    listRoomHandles(roomId)
      .then((m) => {
        if (!cancelled) setHandles(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Screen wake lock while in a call, so iOS auto-lock can't kill it. Wake
  // locks are released by the browser whenever the page hides; the
  // visibilitychange listener re-acquires on return. Fully feature-detected.
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> };
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!wakeLock) return;
    let sentinel: Sentinel | null = null;
    let live = true;
    const acquire = () => {
      wakeLock
        .request('screen')
        .then((sl) => {
          if (!live) {
            sl.release().catch(() => {});
            return;
          }
          sentinel = sl;
        })
        .catch(() => {}); // denied (low battery, etc.) — never fatal
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
    };
  }, []);

  // Fetch the access token for this room.
  useEffect(() => {
    let cancelled = false;
    getRoomToken(roomId)
      .then((c) => {
        if (!cancelled) setCreds({ token: c.token, url: c.url });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not join the call');
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Liveness heartbeat (WAGGLES_ROOMLIFECYCLE2) — ping while on the call so a
  // closed tab is reaped server-side and never strands a future caller.
  useEffect(() => {
    void roomHeartbeat(roomId);
    const id = window.setInterval(() => void roomHeartbeat(roomId), 15000);
    return () => clearInterval(id);
  }, [roomId]);

  // Build an SFrame-E2EE room whenever a key is supplied. TALK_CALLS1: the
  // caller (CallProvider) never lets a call reach here without one — E2EE is
  // on with no flag to turn it off, unlike TheMANUAL.tech's own ?e2ee=1 gate.
  useEffect(() => {
    if (!e2eeKey) {
      setE2eeRoom(null);
      setE2eeReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const keyProvider = new ExternalE2EEKeyProvider();
        keyProviderRef.current = keyProvider; // KEY-2: rotation setKey()s on this instance
        const worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url));
        // roomOptions MUST be applied here — <LiveKitRoom> ignores its `options`
        // prop when handed a pre-built room (see roomOptionsFor). This is what
        // makes simulcast/H.264/dynacast actually take effect on E2EE calls.
        const room = new Room({ ...roomOptions, encryption: { keyProvider, worker } });
        await keyProvider.setKey(e2eeKey);
        await room.setE2EEEnabled(true);
        if (cancelled) {
          room.disconnect().catch(() => {});
          worker.terminate();
          return;
        }
        setE2eeRoom(room);
        setE2eeReady(true);
      } catch {
        if (!cancelled) {
          setError('Encrypted calls aren’t supported in this browser.');
          setE2eeReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      keyProviderRef.current = null;
    };
  }, [e2eeKey, roomOptions]);

  // CALL_KEY_MF v0.1 KEY-2 — rotation. Bee-participant CCK calls only (a convId +
  // my bee id + an active E2EE room). Two jobs:
  //  (a) EVERYONE: when comms_rooms.call_key_epoch advances, fetch+unseal my new
  //      sealed key and setKey() it on the live provider — LiveKit's keyring keeps
  //      the prior epoch decoding briefly, so the cutover is seamless.
  //  (b) HOST: on any participant join/leave, mint+seal a fresh key at epoch+1 to
  //      the CURRENT conversation members; the epoch bump then re-keys everyone
  //      (including this host) through path (a), so a removed party never receives
  //      the new key and a joiner never gets a prior one.
  // The guest (ephemeral-pubkey) seam is intentionally NOT wired here — it stays
  // inert until CALL_GUEST_TOKEN1 mints the guest read token.
  useEffect(() => {
    // Room scope reseals to room participants and needs no conversation; conversation
    // scope still requires a convId to enumerate its members.
    if (!e2eeKey || !e2eeRoom || !myBeeId) return;
    if (!convId) return;
    const client = getBrowserClient();
    let live = true;
    let rotateTimer: number | null = null;

    const channel = client
      .channel(`callkey:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'comms_rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          const next = (payload.new as { call_key_epoch?: number })?.call_key_epoch;
          const prev = (payload.old as { call_key_epoch?: number })?.call_key_epoch;
          if (typeof next !== 'number' || next === prev) return;
          void awaitMyCallKey(roomId, myBeeId).then((got) => {
            if (live && got && keyProviderRef.current) {
              keyProviderRef.current.setKey(got.key).catch(() => {});
            }
          });
        },
      )
      .subscribe();

    const scheduleRotate = () => {
      if (!isHost) return;
      if (rotateTimer) window.clearTimeout(rotateTimer);
      // Debounce a burst of join/leave events into a single rotation.
      rotateTimer = window.setTimeout(() => {
        void currentCallEpoch(roomId).then((cur) =>
          // Room scope: reseal to the room's CURRENT participants (a leaver, whose
          // left_at is now set, is excluded → forward secrecy). Conversation scope:
          // reseal to conversation members. Same epoch-bump path re-keys everyone.
          hostSealNewCallKey(convId as string, roomId, myBeeId, cur + 1).catch(() => {}),
        );
      }, 800);
    };
    if (isHost) {
      e2eeRoom.on(RoomEvent.ParticipantConnected, scheduleRotate);
      e2eeRoom.on(RoomEvent.ParticipantDisconnected, scheduleRotate);
    }

    return () => {
      live = false;
      if (rotateTimer) window.clearTimeout(rotateTimer);
      if (isHost) {
        e2eeRoom.off(RoomEvent.ParticipantConnected, scheduleRotate);
        e2eeRoom.off(RoomEvent.ParticipantDisconnected, scheduleRotate);
      }
      client.removeChannel(channel);
    };
  }, [e2eeKey, e2eeRoom, myBeeId, convId, isHost, roomId]);

  // End on a real hang-up / empty room — never on a bare unmount (StrictMode
  // fires that spuriously in dev). Guarded against double-close.
  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    leaveRoom(roomId).catch(() => {});
    onClose();
  };

  if (error) {
    return (
      <Shell>
        <div className={styles.errorBox}>
          <p className={styles.errorMsg}>{error}</p>
          <button type="button" onClick={close} className={styles.closeBtn}>
            Close
          </button>
        </div>
      </Shell>
    );
  }

  if (!creds || !e2eeReady) {
    return (
      <Shell>
        <div className={styles.loadingWrap}>
          <div className={styles.spinner} />
          {e2eeKey ? 'Securing call…' : 'Connecting…'}
        </div>
      </Shell>
    );
  }

  return (
    <div className={styles.callRoot} data-lk-theme="default">
      <button type="button" onClick={close} className={styles.endCallBtn}>
        End Call
      </button>
      <LiveKitRoom
        options={roomOptions}
        room={e2eeRoom ?? undefined}
        token={creds.token}
        serverUrl={creds.url}
        connect
        video={video ? VIDEO_CAPTURE : false}
        audio
        onDisconnected={(reason) => {
          if (closedRef.current) return; // we tore it down (End Call / other left)
          if (reason === DisconnectReason.CLIENT_INITIATED) {
            // The Bee tapped LiveKit's own leave button in the control bar — a
            // deliberate hang-up, not a drop. Close cleanly, no error screen.
            close();
            return;
          }
          // Unexpected drop (e.g. the iOS Safari disconnect) — show why, on-screen.
          const name =
            reason === undefined ? 'unknown' : (DisconnectReason[reason] ?? String(reason));
          setError(`Call dropped — reason: ${name}. (Read this back to debug the drop.)`);
        }}
        onError={(e) => setError(e.message)}
        style={{ height: '100%' }}
      >
        {!video && phone ? <AudioStage peerName={peerName} handles={handles} /> : <VideoConference />}
        <RoomAudioRenderer />
        <AudioDevicePicker />
        <CallEndWatcher enabled={!!endWhenAlone} onEmpty={close} />
        {e2eeKey && <EncryptionBadge />}
      </LiveKitRoom>
    </div>
  );
}

/**
 * Reads the SDK's ACTUAL encryption state, not the flag that requested it — only
 * rendered when this call attempted E2EE (an e2eeKey was supplied). Polls (same
 * pattern as CallEndWatcher: LiveKit's own participant/track events fire
 * unreliably for this) room.isE2EEEnabled plus every participant's isEncrypted,
 * so a real SFrame failure or a plaintext-fallback participant shows as NOT
 * encrypted rather than silently reporting the requested state as fact.
 */
function EncryptionBadge() {
  const room = useRoomContext();
  const [state, setState] = useState<'checking' | 'encrypted' | 'not-encrypted'>('checking');

  useEffect(() => {
    if (!room) return;
    const check = () => {
      if (!room.isE2EEEnabled) {
        setState('not-encrypted');
        return;
      }
      const all = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
      const allEncrypted = all.length > 0 && all.every((p) => p.isEncrypted);
      setState(allEncrypted ? 'encrypted' : 'not-encrypted');
    };
    check();
    const id = window.setInterval(check, 1000);
    return () => clearInterval(id);
  }, [room]);

  if (state === 'checking') return null;
  const encrypted = state === 'encrypted';
  return (
    <div className={`${styles.badge} ${encrypted ? styles.badgeEncrypted : styles.badgeNotEncrypted}`}>
      {encrypted ? '🔒 Encrypted' : '⚠ Not end-to-end encrypted'}
    </div>
  );
}

/**
 * Ends this side once everyone else has left — the other person hanging up a
 * 1:1, or the last peer leaving a group. POLLS LiveKit's own room (via context)
 * once a second rather than trusting participant events, which fire unreliably;
 * it ends only after the room has been empty for ~2s (ignoring reconnect blips),
 * and only after someone was actually here.
 */
function CallEndWatcher({ enabled, onEmpty }: { enabled: boolean; onEmpty: () => void }) {
  const room = useRoomContext();
  const hadRemoteRef = useRef(false);
  const emptyTicksRef = useRef(0);
  const onEmptyRef = useRef(onEmpty);
  onEmptyRef.current = onEmpty;

  useEffect(() => {
    if (!enabled || !room) return;
    hadRemoteRef.current = room.remoteParticipants.size > 0;
    emptyTicksRef.current = 0;
    const id = window.setInterval(() => {
      if (room.remoteParticipants.size > 0) {
        hadRemoteRef.current = true;
        emptyTicksRef.current = 0;
      } else if (hadRemoteRef.current) {
        emptyTicksRef.current += 1;
        if (emptyTicksRef.current >= 2) onEmptyRef.current(); // empty ~2s → end our side
      }
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, room]);

  return null;
}

interface RosterEntry {
  id: string;
  label: string;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
}

/**
 * TALK_MULTI1 — multi-party audio-only screen. No video grid (nothing to decode,
 * so it stays reliable on Safari), but now a live ROSTER of everyone on the line
 * rather than the single peer the ported version showed: one tile per
 * participant (you + every remote) with a name, a speaking ring, and a muted
 * state, plus your own mute toggle.
 *
 * POLLS the room once every 400ms rather than subscribing to participant/track
 * events — the same reason EncryptionBadge and CallEndWatcher poll: LiveKit's
 * participant/speaking/track events fire unreliably, and a 1:1 has no roster to
 * miss but a group does. Works for N = 1 (ringing, alone) through the cap.
 *
 * Labels come from the beeId→@handle map CallView fetched (the token carries the
 * beeId as identity, no display name). A remote with no handle in the map falls
 * back to the passed peerName when it is the only other person (the 1:1 case),
 * else a generic label.
 */
function AudioStage({
  peerName,
  handles,
}: {
  peerName?: string;
  handles: Record<string, string>;
}) {
  const room = useRoomContext();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!room) return;
    const read = () => {
      const remotes = Array.from(room.remoteParticipants.values());
      const toEntry = (
        p: { identity: string; isSpeaking?: boolean; isMicrophoneEnabled?: boolean },
        isLocal: boolean,
      ): RosterEntry => {
        const handle = handles[p.identity];
        const label = isLocal
          ? 'You'
          : handle
            ? `@${handle}`
            : remotes.length === 1 && peerName
              ? peerName
              : 'On call';
        return {
          id: p.identity,
          label,
          isLocal,
          speaking: !!p.isSpeaking,
          // isMicrophoneEnabled is false when muted OR when no mic track yet;
          // both read as "not currently speaking to us", which is what we show.
          micOn: p.isMicrophoneEnabled !== false,
        };
      };
      setRoster([toEntry(room.localParticipant, true), ...remotes.map((p) => toEntry(p, false))]);
      setMuted(room.localParticipant.isMicrophoneEnabled === false);
    };
    read();
    const id = window.setInterval(read, 400);
    return () => clearInterval(id);
  }, [room, handles, peerName]);

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next);
    try {
      await room?.localParticipant.setMicrophoneEnabled(!next);
    } catch {
      /* mic may not be granted — leave the UI optimistic */
    }
  };

  const others = roster.filter((r) => !r.isLocal).length;
  const status =
    others === 0 ? 'Ringing…' : `Voice call · ${roster.length} on the line`;

  return (
    <div className={styles.audioStage}>
      <div className={styles.callStatus}>{status}</div>
      <div className={styles.audioRoster}>
        {roster.map((r) => {
          const initial = (r.label.replace(/^@/, '')[0] || '•').toUpperCase();
          return (
            <div key={r.id} className={styles.rosterTile}>
              <div
                className={`${styles.rosterAvatar} ${r.speaking ? styles.rosterAvatarSpeaking : ''}`}
              >
                {initial}
              </div>
              <div className={styles.rosterName}>{r.label}</div>
              <div className={styles.rosterStatus}>
                {!r.micOn ? 'muted' : r.speaking ? 'speaking' : ''}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={toggleMute}
        className={`${styles.muteBtn} ${muted ? styles.muteBtnActive : ''}`}
      >
        {muted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  );
}

// CALL_AUDIO_OUTPUT1 — remember the last audio in/out choice on THIS device.
// Per-viewer convenience only (never call state), so localStorage is right and a
// throw (private window, blocked storage) must be swallowed — the picker still
// works, it just won't pre-select.
const DEV_STORE = (kind: MediaDeviceKind) => `talk.call.${kind}`;
function rememberDevice(kind: MediaDeviceKind, id: string) {
  try {
    window.localStorage.setItem(DEV_STORE(kind), id);
  } catch {
    /* storage blocked — remembering is best-effort */
  }
}
function recallDevice(kind: MediaDeviceKind): string | null {
  try {
    return window.localStorage.getItem(DEV_STORE(kind));
  } catch {
    return null;
  }
}

/**
 * CALL_AUDIO_OUTPUT1 — in-call audio route picker (owner 2026-09-28). Lists the
 * microphones and speakers/headsets the browser exposes and switches the live
 * call to the chosen one via LiveKit's Room.switchActiveDevice (which applies
 * setSinkId to the RoomAudioRenderer's <audio> for outputs).
 *
 * HONEST BROWSER SUPPORT: output selection only exists where HTMLMediaElement
 * has setSinkId. Safari/iOS does NOT expose output routing to a web page — the
 * OS route picker owns it there — so rather than render a dead <select>, we show
 * a short note and keep only the mic picker (input selection IS supported on
 * Safari). Feature-detected, never UA-sniffed.
 *
 * Square controls, dark translucent surface — no white boxes (TALK UI law).
 * Polls nothing: it refreshes off LiveKit's MediaDevicesChanged /
 * ActiveDeviceChanged events (plug/unplug a headset mid-call and the lists move).
 */
function AudioDevicePicker() {
  const room = useRoomContext();
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [activeIn, setActiveIn] = useState('');
  const [activeOut, setActiveOut] = useState('');

  // Output routing is only selectable where the media element supports setSinkId.
  const outputSelectable = useMemo(
    () =>
      typeof HTMLMediaElement !== 'undefined' &&
      'setSinkId' in HTMLMediaElement.prototype,
    [],
  );

  useEffect(() => {
    if (!room) return;
    let live = true;

    const refresh = async () => {
      try {
        const [ins, outs] = await Promise.all([
          Room.getLocalDevices('audioinput'),
          outputSelectable
            ? Room.getLocalDevices('audiooutput')
            : Promise.resolve<MediaDeviceInfo[]>([]),
        ]);
        if (!live) return;
        setInputs(ins);
        setOutputs(outs);
        setActiveIn(room.getActiveDevice('audioinput') ?? ins[0]?.deviceId ?? '');
        setActiveOut(room.getActiveDevice('audiooutput') ?? outs[0]?.deviceId ?? '');

        // Re-apply this device's remembered choice, once the list is known and
        // only if that device is actually present now.
        const wantIn = recallDevice('audioinput');
        if (
          wantIn &&
          ins.some((d) => d.deviceId === wantIn) &&
          room.getActiveDevice('audioinput') !== wantIn
        ) {
          room
            .switchActiveDevice('audioinput', wantIn)
            .then(() => live && setActiveIn(wantIn))
            .catch(() => {});
        }
        if (outputSelectable) {
          const wantOut = recallDevice('audiooutput');
          if (
            wantOut &&
            outs.some((d) => d.deviceId === wantOut) &&
            room.getActiveDevice('audiooutput') !== wantOut
          ) {
            room
              .switchActiveDevice('audiooutput', wantOut)
              .then(() => live && setActiveOut(wantOut))
              .catch(() => {});
          }
        }
      } catch {
        /* enumeration denied/unavailable — leave the lists empty (Default only) */
      }
    };

    const onActive = () => {
      if (!live) return;
      setActiveIn(room.getActiveDevice('audioinput') ?? '');
      setActiveOut(room.getActiveDevice('audiooutput') ?? '');
    };

    void refresh();
    room.on(RoomEvent.MediaDevicesChanged, refresh);
    room.on(RoomEvent.ActiveDeviceChanged, onActive);
    return () => {
      live = false;
      room.off(RoomEvent.MediaDevicesChanged, refresh);
      room.off(RoomEvent.ActiveDeviceChanged, onActive);
    };
  }, [room, outputSelectable]);

  if (!room) return null;

  const pick = async (kind: MediaDeviceKind, id: string) => {
    if (kind === 'audioinput') setActiveIn(id);
    else setActiveOut(id);
    rememberDevice(kind, id);
    try {
      await room.switchActiveDevice(kind, id);
    } catch {
      /* the device may have vanished between list and click — MediaDevicesChanged
         will resync the UI on the next event */
    }
  };

  const nameFor = (d: MediaDeviceInfo, i: number) =>
    d.label || `${d.kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${i + 1}`;

  return (
    <div className={styles.devicePanel}>
      <div className={styles.deviceRow}>
        <span className={styles.deviceLabel}>Mic</span>
        <select
          className={styles.deviceSelect}
          value={activeIn}
          onChange={(e) => void pick('audioinput', e.target.value)}
          aria-label="Microphone"
        >
          {inputs.length === 0 && <option value="">Default</option>}
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {nameFor(d, i)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.deviceRow}>
        <span className={styles.deviceLabel}>Out</span>
        {outputSelectable ? (
          <select
            className={styles.deviceSelect}
            value={activeOut}
            onChange={(e) => void pick('audiooutput', e.target.value)}
            aria-label="Speaker"
          >
            {outputs.length === 0 && <option value="">Default</option>}
            {outputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {nameFor(d, i)}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.deviceNote}>
            Your browser routes call audio through the device — pick the
            speaker or headset in your system settings.
          </span>
        )}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}
