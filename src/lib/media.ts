import * as FileSystem from 'expo-file-system';
import { decryptBytes, encryptBytes, getConversationKey } from './e2ee';
import { myBeeId } from './calls';
import { getSupabase } from './supabase';

/**
 * COMMS media layer — NATIVE port of TheMANUAL.tech voice/media messages.
 *
 * Voice notes and images are E2EE at the FILE level: the bytes are sealed under
 * the conversation content key with e2ee.encryptBytes BEFORE upload, so storage
 * holds only ciphertext. The (also encrypted) text message body carries the
 * pointer + mime + duration; recipients fetch, decrypt locally, and play/show.
 *
 * Platform port (the web reference leans on Blob / URL.createObjectURL /
 * crypto.randomUUID, none of which exist in React Native):
 *   - file IO: expo-file-system (read/write base64) instead of Blob/fetch.
 *   - decrypted output: a local cache-dir file URI (RN plays/renders from a URI,
 *     not an object URL) instead of URL.createObjectURL.
 *   - id: an e2ee-random hex name instead of crypto.randomUUID.
 *   - upload: supabase-js accepts an ArrayBuffer in RN (no Blob needed).
 *
 * GATED: MEDIA_ENABLED stays FALSE. The fork backend must first (a) create the
 * `waggles-media` storage bucket + its RLS (propose-only migration
 * supabase/migrations/20260929002000_waggles_media.sql — OWNER applies), and
 * (b) the recording/playback path can only be verified on a device build. The
 * owner flips this flag after applying the bucket and a device smoke test.
 * See docs/OWNER_APPLY.md → WAGGLES_MEDIA.
 */
export const MEDIA_ENABLED = false;

// Bucket + key layout mirror the constellation's file-level scheme: one object
// per message under media/{beeId}/*. The bucket is PRIVATE (ciphertext is not
// world-readable), so download uses a signed URL rather than a public URL.
const MEDIA_BUCKET = 'waggles-media';
const SIGNED_URL_TTL = 60 * 60; // 1h — long enough to fetch + decrypt on open.

function req() {
  return getSupabase();
}

export interface CommsMediaPayload {
  /** Storage object path inside MEDIA_BUCKET (NOT a public URL — bucket is private). */
  path: string;
  kind: 'image' | 'audio';
  name: string;
  /** True when the FILE bytes are sealed under the conversation key. Always true here. */
  enc?: boolean;
  /** Original mime type, needed to play/render the decrypted file. */
  mime?: string;
  /** Duration in whole seconds (voice notes), for the bubble label. */
  dur?: number;
  /** Pixel dimensions (images), for bubble aspect ratio. */
  w?: number;
  h?: number;
}

/** Parse a media message body; null when malformed (render raw body instead). */
export function parseMediaPayload(body: string): CommsMediaPayload | null {
  try {
    const p = JSON.parse(body) as Partial<CommsMediaPayload>;
    if (typeof p.path === 'string' && p.path.length > 0 && (p.kind === 'image' || p.kind === 'audio')) {
      return {
        path: p.path,
        kind: p.kind,
        name: typeof p.name === 'string' ? p.name : 'attachment',
        enc: p.enc !== false,
        mime: typeof p.mime === 'string' ? p.mime : undefined,
        dur: typeof p.dur === 'number' && Number.isFinite(p.dur) ? p.dur : undefined,
        w: typeof p.w === 'number' && Number.isFinite(p.w) ? p.w : undefined,
        h: typeof p.h === 'number' && Number.isFinite(p.h) ? p.h : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── base64 ⇄ bytes (RN has no atob/btoa; expo-file-system speaks base64) ──────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}
function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | ((c2 & 63) << 6) | (c3 & 63);
    if (o < len) out[o++] = (n >> 16) & 0xff;
    if (c2 !== -1 && o < len) out[o++] = (n >> 8) & 0xff;
    if (c3 !== -1 && o < len) out[o++] = n & 0xff;
  }
  return out;
}

async function randomHex16(): Promise<string> {
  // Reuse libsodium's device id primitive through e2ee? Kept local to avoid a
  // cross-import: 16 bytes of Math-free randomness via crypto if present, else
  // a base64 device-random fed through the bytes codec. RN's global crypto
  // (expo-crypto / react-native-get-random-values, pulled in by libsodium) has
  // getRandomValues.
  const buf = new Uint8Array(16);
  const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => void } };
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(buf);
  else for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── seal → upload ─────────────────────────────────────────────────────────────
async function sealAndUpload(
  conversationId: string,
  localUri: string,
  ext: string,
  uploadType: string,
): Promise<string> {
  const bee = await myBeeId();
  const ck = await getConversationKey(bee, conversationId);
  if (!ck) throw new Error('Encryption is still setting up for this conversation — try again in a moment.');
  const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const plain = b64ToBytes(b64);
  const sealed = await encryptBytes(ck, plain);
  const path = `media/${bee}/${await randomHex16()}.${ext}`;
  // supabase-js (RN) uploads an ArrayBuffer directly; contentType is the
  // ciphertext's declared type. The true native mime rides in the sealed payload.
  const { error } = await req()
    .storage.from(MEDIA_BUCKET)
    .upload(path, sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength) as ArrayBuffer, {
      contentType: uploadType,
      upsert: false,
    });
  if (error) throw new Error(error.message);
  return path;
}

/** Record → seal → upload. Returns the media payload (caller sends it as the body). */
export async function buildVoicePayload(
  conversationId: string,
  localUri: string,
  mime: string,
  durationSeconds: number,
): Promise<CommsMediaPayload> {
  const path = await sealAndUpload(conversationId, localUri, 'bin', 'application/octet-stream');
  return {
    path,
    kind: 'audio',
    name: 'Voice message',
    enc: true,
    mime: mime || 'audio/m4a',
    dur: Math.max(1, Math.round(durationSeconds)),
  };
}

/** Pick → seal → upload. Returns the media payload (caller sends it as the body). */
export async function buildImagePayload(
  conversationId: string,
  localUri: string,
  mime: string,
  width?: number,
  height?: number,
): Promise<CommsMediaPayload> {
  const path = await sealAndUpload(conversationId, localUri, 'bin', 'application/octet-stream');
  return {
    path,
    kind: 'image',
    name: 'Photo',
    enc: true,
    mime: mime || 'image/jpeg',
    w: width,
    h: height,
  };
}

/**
 * Fetch an E2EE media file, decrypt it under the conversation key, write the
 * plaintext to a cache-dir file, and return its local URI for playback/render.
 * Caller may delete the file when done (best-effort; cache is transient anyway).
 */
export async function decryptMediaToLocalUri(
  conversationId: string,
  payload: CommsMediaPayload,
): Promise<string> {
  const bee = await myBeeId();
  const ck = await getConversationKey(bee, conversationId);
  if (!ck) throw new Error('no conversation key on this device');
  const { data, error } = await req().storage.from(MEDIA_BUCKET).createSignedUrl(payload.path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'could not sign media URL');
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const sealed = new Uint8Array(await res.arrayBuffer());
  const plain = await decryptBytes(ck, sealed);
  const outExt = payload.kind === 'image' ? guessImageExt(payload.mime) : guessAudioExt(payload.mime);
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const outUri = `${dir}wgm-${await randomHex16()}.${outExt}`;
  await FileSystem.writeAsStringAsync(outUri, bytesToB64(plain), { encoding: FileSystem.EncodingType.Base64 });
  return outUri;
}

function guessImageExt(mime?: string): string {
  if (mime?.includes('png')) return 'png';
  if (mime?.includes('webp')) return 'webp';
  if (mime?.includes('gif')) return 'gif';
  return 'jpg';
}
function guessAudioExt(mime?: string): string {
  if (mime?.includes('mp4') || mime?.includes('m4a') || mime?.includes('aac')) return 'm4a';
  if (mime?.includes('webm')) return 'webm';
  return 'm4a';
}
