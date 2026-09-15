'use client';

import { useRef, useState } from 'react';
import { useTalkData } from '@/lib/data/provider';
import type { SendResult, TalkConversation, TalkMediaKind } from '@/lib/contract';
import styles from './Composer.module.css';

/** TALK_MEDIA1: matches the proposed talk-media bucket's file_size_limit
    (db/proposed/) - checked client-side too, so an oversized pick fails with
    an immediate, specific reason instead of a generic upload error. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const VOICE_MAX_SECONDS = 120;

function inferKind(mime: string): TalkMediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface ComposerProps {
  conversationId: string;
  /** TALK_GROUPS1: needed to resolve @mentions against real participants and
      to notify only in groups (matches the reference implementation). */
  conversation: TalkConversation;
  /** `docked` = pinned to the bottom of an open thread. `centered` = the SHELL
      v1.5 home state, before the first message docks it. */
  variant: 'docked' | 'centered';
  onSent: (result: SendResult) => void;
}

/**
 * The composer used both centered (empty-thread home) and docked (bottom of
 * an open thread) - same component, `variant` only changes layout.
 * `canSend()` is a DEVICE-level check (can this browser even attempt E2E at
 * all - false only outside a browser context); TALK_E2E1 wired real sending
 * through the ported E2E client, so this is enabled whenever the composer
 * can render at all. A specific conversation's key not being resolvable yet
 * (TalkConversation.createdBy / keyPending - see contract.ts) surfaces as an
 * honest `SendResult.reason` from `sendMessage` itself, not a disabled field.
 */
export function Composer({ conversationId, conversation, variant, onSent }: ComposerProps) {
  const data = useTalkData();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  // TALK_E2E1: a failed send (e.g. "still linking this device") is a real,
  // expected outcome now - not a dead branch - so it needs its own visible
  // state rather than vanishing into ThreadPane's ok-only onSent handler.
  const [sendError, setSendError] = useState<string | null>(null);
  const canSend = data.canSend();

  // ── TALK_MEDIA1: file attach ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);

  const onFilePicked = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setSendError(`That file is too large - the limit is ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    setAttaching(true);
    setSendError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await data.sendMedia(conversationId, {
        bytes,
        mime: file.type || 'application/octet-stream',
        name: file.name,
        kind: inferKind(file.type),
      });
      if (!result.ok && result.reason) setSendError(result.reason);
      onSent(result);
    } finally {
      setAttaching(false);
    }
  };

  // ── TALK_MEDIA1: voice notes ──
  const recRef = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    mime: string;
    tick: number;
    startedAt: number;
    intent: 'send' | 'cancel';
  } | null>(null);
  const [recState, setRecState] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [recElapsed, setRecElapsed] = useState(0);

  const stopRecording = (send: boolean) => {
    const entry = recRef.current;
    if (!entry) return;
    entry.intent = send ? 'send' : 'cancel';
    recRef.current = null;
    try {
      entry.recorder.stop();
    } catch {
      /* already stopped */
    }
  };

  const startRecording = async () => {
    if (recState !== 'idle') return;
    setSendError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setSendError('Microphone permission is needed for voice messages.');
      return;
    }
    const preferred = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'].find(
      (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
    );
    let recorder: MediaRecorder;
    try {
      recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    } catch {
      for (const t of stream.getTracks()) t.stop();
      setSendError('Voice recording is not supported in this browser.');
      return;
    }
    const entry = {
      recorder,
      stream,
      chunks: [] as Blob[],
      mime: preferred || recorder.mimeType || 'audio/mp4',
      tick: 0,
      startedAt: Date.now(),
      intent: 'cancel' as 'send' | 'cancel',
    };
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) entry.chunks.push(e.data);
    };
    recorder.onstop = () => {
      for (const t of entry.stream.getTracks()) t.stop();
      window.clearInterval(entry.tick);
      const secs = Math.round((Date.now() - entry.startedAt) / 1000);
      if (entry.intent !== 'send' || secs < 1 || entry.chunks.length === 0) {
        setRecState('idle');
        setRecElapsed(0);
        return;
      }
      const blob = new Blob(entry.chunks, { type: entry.mime });
      setRecState('uploading');
      data
        .sendVoice(conversationId, blob, entry.mime, secs)
        .then((result) => {
          if (!result.ok && result.reason) setSendError(result.reason);
          onSent(result);
        })
        .catch((err) => {
          console.warn('voice send failed', err);
          setSendError('Could not send the voice message - try again.');
        })
        .finally(() => {
          setRecState('idle');
          setRecElapsed(0);
        });
    };
    recRef.current = entry;
    setRecElapsed(0);
    setRecState('recording');
    recorder.start(1000);
    entry.tick = window.setInterval(() => {
      const secs = Math.round((Date.now() - entry.startedAt) / 1000);
      setRecElapsed(secs);
      if (secs >= VOICE_MAX_SECONDS) stopRecording(true);
    }, 500);
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || pending || !canSend) return;
    setPending(true);
    setSendError(null);
    try {
      const result = await data.sendMessage(conversationId, trimmed);
      if (result.ok) {
        setBody('');
        // TALK_GROUPS1: comms_mention_notify, groups only (mirrors CommsPage.tsx) -
        // best-effort, the data layer never lets this block the send it follows.
        if (conversation.kind === 'group' && result.message) {
          const senderId = result.message.senderBeeId;
          const esc = (h: string) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const mentioned = conversation.participants
            .filter((p) => p.beeId !== senderId && new RegExp(`@${esc(p.handle)}\\b`, 'i').test(trimmed))
            .map((p) => p.beeId);
          if (mentioned.length) void data.notifyMentions(conversationId, result.message.id, mentioned);
        }
      } else if (result.reason) {
        setSendError(result.reason);
      }
      onSent(result);
    } finally {
      setPending(false);
    }
  };

  const busy = pending || attaching || recState !== 'idle';

  return (
    <div className={variant === 'docked' ? styles.docked : styles.centered}>
      {recState === 'idle' ? (
        <div className={styles.composer}>
          <input
            ref={fileInputRef}
            type="file"
            className={styles.hiddenFileInput}
            disabled={!canSend || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // allow re-picking the same file
              if (file) void onFilePicked(file);
            }}
          />
          <button
            type="button"
            className={styles.iconBtn}
            disabled={!canSend || busy}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a file"
            title="Attach a file"
          >
            📎
          </button>
          <div className={styles.inputBox}>
            <textarea
              className={styles.input}
              rows={1}
              placeholder={canSend ? 'Message...' : 'Sending opens in the Manual messenger'}
              value={body}
              disabled={!canSend || busy}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          {body.trim() ? (
            <button
              type="button"
              className={styles.send}
              disabled={!canSend || !body.trim() || busy}
              onClick={() => void submit()}
            >
              Send
            </button>
          ) : (
            <button
              type="button"
              className={styles.iconBtn}
              disabled={!canSend || busy}
              onClick={() => void startRecording()}
              aria-label="Record a voice message"
              title="Record a voice message"
            >
              🎤
            </button>
          )}
        </div>
      ) : (
        <div className={styles.composer}>
          <div className={styles.recording}>
            <span className={styles.recDot} />
            <span className={styles.recClock}>{fmtClock(recElapsed)}</span>
            <span className={styles.recLabel}>{recState === 'uploading' ? 'Sending…' : 'Recording…'}</span>
          </div>
          {recState === 'recording' && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => stopRecording(false)}
              aria-label="Cancel voice message"
              title="Cancel"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            className={styles.send}
            disabled={recState === 'uploading'}
            onClick={() => stopRecording(true)}
          >
            Send
          </button>
        </div>
      )}
      {!canSend && variant === 'centered' && (
        <p className={styles.disabledNote}>Sending needs a browser - open rebelution.talk directly.</p>
      )}
      {sendError && <p className={styles.disabledNote}>{sendError}</p>}
    </div>
  );
}
