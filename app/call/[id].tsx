import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  useRoomContext,
  useTracks,
  useRNE2EEManager,
} from '@livekit/react-native';
import { RoomEvent, type RoomOptions, Track } from 'livekit-client';
import { getSupabase } from '@/lib/supabase';
import {
  awaitMyCallKey,
  currentCallEpoch,
  getRoomToken,
  hostSealRoomCallKey,
  leaveRoom,
  myBeeId,
} from '@/lib/calls';
import { useTheme } from '@/lib/theme';

/* ============================================================
   WAGGLES_CALLS1 — the E2EE call screen (1:1 + group, cap 8). NATIVE
   reimplementation on @livekit/react-native (NOT a copy of TALK's web CallView).
   E2EE HARD-ON: the media key is the per-call CCK (calls.ts). This device seals
   (host) or fetches (joiner) its sealed CCK BEFORE connecting; with no key it
   REFUSES — never a plaintext call. Rotation: on comms_rooms.call_key_epoch bump
   every device re-keys via keyProvider.setSharedKey; the HOST reseals at epoch+1
   on join/leave so a leaver never holds the new key (forward secrecy). Wiring per
   the official LiveKit RN example (options.e2ee = { e2eeManager }).
   ============================================================ */

type Params = { id: string; role?: string; video?: string };

export default function CallRoute() {
  const { id: roomId, role, video } = useLocalSearchParams<Params>();
  const t = useTheme();
  const router = useRouter();
  const wantVideo = video !== '0';
  const isHost = role === 'host';

  const [me, setMe] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ url: string; token: string } | null>(null);
  const [e2eeKey, setE2eeKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Acquire the CCK (host seals epoch 1; joiner fetches its sealed key) + a token.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const bee = await myBeeId();
        if (!live) return;
        setMe(bee);
        const key = isHost
          ? await hostSealRoomCallKey(roomId, bee, 1)
          : (await awaitMyCallKey(roomId, bee))?.key ?? null;
        if (!live) return;
        if (!key) {
          setError('Could not establish encryption — the call is end-to-end encrypted or it does not connect.');
          return;
        }
        const c = await getRoomToken(roomId);
        if (!live) return;
        setE2eeKey(key);
        setCreds({ url: c.url, token: c.token });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not start the call.');
      }
    })();
    return () => {
      live = false;
    };
  }, [roomId, isHost]);

  // Audio session lifecycle (RN requires an explicit session).
  useEffect(() => {
    let live = true;
    void AudioSession.startAudioSession().catch(() => {});
    return () => {
      live = false;
      void AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);

  const hangUp = useCallback(() => {
    void leaveRoom(roomId).catch(() => {});
    router.back();
  }, [roomId, router]);

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.text, textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
        <Pressable onPress={() => router.back()} style={[styles.btn, { backgroundColor: t.accent, marginTop: 16 }]}>
          <Text style={styles.btnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!creds || !e2eeKey || !me) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} />
        <Text style={{ color: t.textDim, marginTop: 12 }}>Encrypting the call…</Text>
      </View>
    );
  }

  return (
    <CallInner
      roomId={roomId}
      meBeeId={me}
      isHost={isHost}
      wantVideo={wantVideo}
      url={creds.url}
      token={creds.token}
      e2eeKey={e2eeKey}
      onHangUp={hangUp}
    />
  );
}

function CallInner({
  roomId,
  meBeeId,
  isHost,
  wantVideo,
  url,
  token,
  e2eeKey,
  onHangUp,
}: {
  roomId: string;
  meBeeId: string;
  isHost: boolean;
  wantVideo: boolean;
  url: string;
  token: string;
  e2eeKey: string;
  onHangUp: () => void;
}) {
  // Per the official LiveKit RN E2EE example: sharedKey -> { keyProvider, e2eeManager };
  // pass the manager via options.e2ee.
  const { keyProvider, e2eeManager } = useRNE2EEManager({ sharedKey: e2eeKey });

  const options = useMemo<RoomOptions>(
    () => ({
      adaptiveStream: { pixelDensity: 'screen' },
      // The RN SDK accepts { e2eeManager } here (official LiveKit RN example);
      // livekit-client's web E2EEOptions type wants { keyProvider, worker }, so
      // this ONE boundary is cast — the value is correct, only the web type differs.
      e2ee: { e2eeManager } as unknown as RoomOptions['e2ee'],
    }),
    [e2eeManager],
  );

  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio
      video={wantVideo}
      options={options}
      onDisconnected={onHangUp}
    >
      <CallStage
        roomId={roomId}
        meBeeId={meBeeId}
        isHost={isHost}
        keyProvider={keyProvider}
        onHangUp={onHangUp}
      />
    </LiveKitRoom>
  );
}

function CallStage({
  roomId,
  meBeeId,
  isHost,
  keyProvider,
  onHangUp,
}: {
  roomId: string;
  meBeeId: string;
  isHost: boolean;
  keyProvider: { setSharedKey: (k: string | Uint8Array, i?: number) => Promise<unknown> };
  onHangUp: () => void;
}) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const [speaker, setSpeaker] = useState(true);
  const resealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Turn E2EE on for this room (official example does this in the room-view effect).
  useEffect(() => {
    void room.setE2EEEnabled(true).catch(() => {});
  }, [room]);

  // (a) EVERYONE: re-key when the sealed-key epoch advances.
  // (b) HOST: reseal at epoch+1 on any participant join/leave (forward secrecy).
  useEffect(() => {
    let live = true;
    const channel = getSupabase()
      .channel(`callkey:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'comms_rooms', filter: `id=eq.${roomId}` },
        (payload: { new?: { call_key_epoch?: number }; old?: { call_key_epoch?: number } }) => {
          const next = payload.new?.call_key_epoch;
          const prev = payload.old?.call_key_epoch;
          if (typeof next !== 'number' || next === prev) return;
          void awaitMyCallKey(roomId, meBeeId).then((got) => {
            if (live && got) void keyProvider.setSharedKey(got.key, got.epoch).catch(() => {});
          });
        },
      )
      .subscribe();

    const scheduleReseal = () => {
      if (!isHost) return;
      if (resealTimer.current) clearTimeout(resealTimer.current);
      resealTimer.current = setTimeout(() => {
        void currentCallEpoch(roomId).then((cur) => hostSealRoomCallKey(roomId, meBeeId, cur + 1).catch(() => {}));
      }, 800);
    };
    if (isHost) {
      room.on(RoomEvent.ParticipantConnected, scheduleReseal);
      room.on(RoomEvent.ParticipantDisconnected, scheduleReseal);
    }
    return () => {
      live = false;
      if (resealTimer.current) clearTimeout(resealTimer.current);
      if (isHost) {
        room.off(RoomEvent.ParticipantConnected, scheduleReseal);
        room.off(RoomEvent.ParticipantDisconnected, scheduleReseal);
      }
      void getSupabase().removeChannel(channel);
    };
  }, [room, roomId, meBeeId, isHost, keyProvider]);

  const toggleMic = useCallback(() => {
    const lp = room.localParticipant;
    void lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
  }, [room]);
  const toggleCam = useCallback(() => {
    const lp = room.localParticipant;
    void lp.setCameraEnabled(!lp.isCameraEnabled);
  }, [room]);
  // WAGGLES_CALLS1-NOTE1 — audio output picker (speaker vs earpiece).
  const toggleSpeaker = useCallback(() => {
    setSpeaker((s) => {
      const next = !s;
      void AudioSession.selectAudioOutput(next ? 'speaker' : 'earpiece').catch(() => {});
      return next;
    });
  }, []);

  return (
    <View style={[styles.stage, { backgroundColor: '#000' }]}>
      <View style={styles.grid}>
        {tracks.length === 0 && (
          <View style={styles.center}>
            <Text style={{ color: '#888' }}>Waiting for others…</Text>
          </View>
        )}
        {tracks.map((ref) => (
          <VideoTrack key={ref.publication?.trackSid ?? ref.participant.sid} trackRef={ref} style={styles.tile} />
        ))}
      </View>
      <View style={[styles.bar, { backgroundColor: '#161616' }]}>
        <Pressable onPress={toggleMic} style={styles.ctrl}>
          <Text style={styles.ctrlText}>Mic</Text>
        </Pressable>
        <Pressable onPress={toggleCam} style={styles.ctrl}>
          <Text style={styles.ctrlText}>Cam</Text>
        </Pressable>
        <Pressable onPress={toggleSpeaker} style={styles.ctrl}>
          <Text style={styles.ctrlText}>{speaker ? 'Speaker' : 'Earpiece'}</Text>
        </Pressable>
        <Pressable onPress={onHangUp} style={[styles.ctrl, styles.leave]}>
          <Text style={[styles.ctrlText, { color: '#fff' }]}>Leave</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '50%', height: '50%' },
  bar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 14, paddingBottom: 28 },
  ctrl: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  ctrlText: { fontWeight: '600', color: '#111' },
  leave: { backgroundColor: '#c0392b' },
  btn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
});
