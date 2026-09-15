import type _sodium from 'libsodium-wrappers-sumo';
import { getBrowserClient } from './supabase/client';

/**
 * TALK_E2E1 — ported VERBATIM from `TheMANUAL.tech/src/lib/e2ee.ts` (own-copy
 * law, same shape SHELL v1.3 already established for @honeycomb/shell: no
 * cross-repo import, so this app's deploy is never coupled to the Manual's).
 * The only change from the source is `db()` below, adapted to this repo's
 * `getBrowserClient()` seam instead of a nullable module-level `supabase`
 * export. Every crypto primitive, every table/RPC name, every doc comment is
 * unchanged — this is exactly the code where "port verbatim" matters most.
 *
 * COMMS end-to-end encryption (v1) — zero-knowledge, MULTI-DEVICE.
 *
 *  - Each Bee holds an X25519 identity keypair PER DEVICE. The PUBLIC key is
 *    published to `bee_keys` keyed by (bee_id, device_id); the SECRET key never
 *    leaves the device (IndexedDB). Registering a new device NEVER overwrites
 *    another device's key.
 *  - Each conversation has a random 256-bit content key (CK), sealed
 *    (crypto_box_seal) to EVERY device of EVERY member and stored per
 *    (member, device) in `comms_conversation_keys`. Any one of a member's
 *    devices can open its own sealed copy.
 *  - Message bodies are XChaCha20-Poly1305 under the CK, stored as
 *    `e2ee:v1:` + base64(nonce||ciphertext); `comms_send` is called with
 *    is_encrypted=true.
 *
 * The server only ever sees public keys, sealed blobs, and ciphertext.
 *
 * DEVICE IDENTITY IS ORIGIN-SCOPED (TALK_E2E1 finding, not in the source
 * file's own comment): IndexedDB is per-origin, so `rebelution.talk` and
 * `themanual.tech` see DIFFERENT devices for the same Bee even in the same
 * physical browser. A conversation created before this device ever existed
 * stays unreadable here until an existing device reseals to it (see
 * `syncConversationKey` in `comms.ts`, ported as `ensureConversationKeySynced`
 * in this repo's `data/supabase.ts`) — working as designed, not a bug.
 *
 * Key-distribution contract:
 *  - The conversation CREATOR calls `establishConversationKey` once at create
 *    time (mints the CK, seals to all members' devices). It refuses to mint when
 *    key rows already exist but can't be opened here — that's a locked-out
 *    device, and minting would clobber the CK; use `rekeyConversation` instead.
 *  - A member who ALREADY holds the CK calls `resealConversationKey` to key
 *    devices that published later (new device / new member). Never mints.
 *  - `getConversationKey` only reads; it tries every sealed copy it holds and
 *    returns null (never throws) when none open on this device.
 *  - `rekeyConversation` is the recovery path when NO device can open the CK:
 *    it mints a fresh CK at a new epoch. Messages under the old key are lost.
 */

let sodiumReady: Promise<typeof _sodium> | null = null;
async function S() {
  // Lazy-load libsodium (~250 kB gzip of wasm+glue) on first crypto use, so it
  // stays OUT of the first-paint bundle. Every caller already awaits S().
  if (!sodiumReady) {
    sodiumReady = import('libsodium-wrappers-sumo').then(async (mod) => {
      await mod.default.ready;
      return mod.default;
    });
  }
  return sodiumReady;
}
function db() {
  return getBrowserClient();
}
function uniq(ids: string[]) {
  return Array.from(new Set(ids));
}

// ── device-local secret store (IndexedDB) ────────────────────────────────
const IDB_NAME = 'hc_comms_e2ee';
const IDB_STORE = 'identity';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key: string): Promise<Uint8Array | null> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const req = d.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key: string, val: Uint8Array): Promise<void> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const req = d.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(val, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── device id (stable per browser) ───────────────────────────────────────────
// Each browser/device gets its own id and its own keypair; a conversation's
// content key is sealed once PER DEVICE, so one account works across many
// devices without a later device overwriting an earlier device's key.
let deviceIdCache: string | null = null;
export async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const sodium = await S();
  const existing = await idbGet('device_id');
  if (existing) {
    deviceIdCache = sodium.to_string(existing);
    return deviceIdCache;
  }
  const did = sodium.to_base64(
    sodium.randombytes_buf(16),
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );
  await idbPut('device_id', sodium.from_string(did));
  deviceIdCache = did;
  return did;
}

// ── identity ──────────────────────────────────────────────────────────────
export interface Identity {
  beeId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}
const identityCache = new Map<string, Identity>();

/** Load this Bee's identity on THIS device, generating + registering one on first use. */
export async function ensureIdentity(beeId: string): Promise<Identity> {
  const cached = identityCache.get(beeId);
  if (cached) return cached;
  const sodium = await S();
  let sk = await idbGet(`sk:${beeId}`);
  let pk = await idbGet(`pk:${beeId}`);
  if (!sk || !pk) {
    const kp = sodium.crypto_box_keypair();
    sk = kp.privateKey;
    pk = kp.publicKey;
    await idbPut(`sk:${beeId}`, sk);
    await idbPut(`pk:${beeId}`, pk);
  }
  const id: Identity = { beeId, publicKey: pk, privateKey: sk };
  identityCache.set(beeId, id);
  await ensurePublished(id); // register THIS device's key (never clobbers other devices)
  return id;
}

async function ensurePublished(id: Identity) {
  const sodium = await S();
  const b64 = sodium.to_base64(id.publicKey, sodium.base64_variants.ORIGINAL);
  const deviceId = await getDeviceId();
  const { data } = await db()
    .from('bee_keys')
    .select('public_key')
    .eq('bee_id', id.beeId)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (!data || data.public_key !== b64) {
    await db().rpc('bee_register_key', {
      p_device_id: deviceId,
      p_public_key: b64,
      p_key_algo: 'x25519',
    });
  }
}

interface DeviceKey {
  beeId: string;
  deviceId: string;
  publicKey: Uint8Array;
}
/** Every published device key for the given Bees (one Bee → potentially many devices). */
async function fetchMemberDeviceKeys(beeIds: string[]): Promise<DeviceKey[]> {
  const sodium = await S();
  const { data, error } = await db()
    .from('bee_keys')
    .select('bee_id, device_id, public_key')
    .in('bee_id', uniq(beeIds));
  if (error) throw error;
  return (data ?? []).map((r) => ({
    beeId: r.bee_id as string,
    deviceId: (r.device_id as string) ?? 'legacy',
    publicKey: sodium.from_base64(r.public_key as string, sodium.base64_variants.ORIGINAL),
  }));
}

// ── per-conversation content key ────────────────────────────────────────────
const ckCache = new Map<string, Uint8Array>();
const ckEpochCache = new Map<string, number>();

/**
 * Read + unwrap my content key for a conversation on THIS device. Tries every
 * sealed copy I hold (newest epoch first, across all my devices' rows) and
 * returns the first that opens. Returns null — never throws — when no copy on
 * this device can be opened (locked out, or not yet keyed here).
 */
export async function getConversationKey(
  beeId: string,
  conversationId: string,
): Promise<Uint8Array | null> {
  const cached = ckCache.get(conversationId);
  if (cached) return cached;
  const sodium = await S();
  const id = await ensureIdentity(beeId);
  const { data, error } = await db()
    .from('comms_conversation_keys')
    .select('wrapped_key, epoch')
    .eq('bee_id', beeId)
    .eq('conversation_id', conversationId)
    .order('epoch', { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    try {
      const sealed = sodium.from_base64(row.wrapped_key as string, sodium.base64_variants.ORIGINAL);
      const ck = sodium.crypto_box_seal_open(sealed, id.publicKey, id.privateKey);
      if (ck) {
        ckCache.set(conversationId, ck);
        ckEpochCache.set(conversationId, (row.epoch as number) ?? 1);
        return ck;
      }
    } catch {
      /* this sealed copy is for a different device key — try the next one */
    }
  }
  return null;
}

/** Do I hold ANY sealed key row for this conversation? (RLS scopes this to my rows.) */
async function haveKeyRow(beeId: string, conversationId: string): Promise<boolean> {
  const { count, error } = await db()
    .from('comms_conversation_keys')
    .select('epoch', { count: 'exact', head: true })
    .eq('bee_id', beeId)
    .eq('conversation_id', conversationId);
  if (error) return false;
  return (count ?? 0) > 0;
}

async function sealToMembers(
  beeId: string,
  conversationId: string,
  memberBeeIds: string[],
  ck: Uint8Array,
  epoch = 1,
) {
  const sodium = await S();
  const deviceKeys = await fetchMemberDeviceKeys([beeId, ...memberBeeIds]);
  const wrapped = deviceKeys.map((k) => ({
    bee_id: k.beeId,
    device_id: k.deviceId,
    wrapped_key: sodium.to_base64(
      sodium.crypto_box_seal(ck, k.publicKey),
      sodium.base64_variants.ORIGINAL,
    ),
  }));
  if (wrapped.length) {
    await db().rpc('comms_put_conversation_keys', {
      p_conversation_id: conversationId,
      p_epoch: epoch,
      p_wrapped: wrapped,
    });
  }
  ckCache.set(conversationId, ck);
  ckEpochCache.set(conversationId, epoch);
}

/**
 * CREATE-TIME: mint a CK for a brand-new conversation and seal to members'
 * devices. If a readable key already exists, just (re)seal to current devices.
 * Refuses to mint when key rows exist but can't be opened here — that's a
 * locked-out device, and minting would clobber the CK; use rekeyConversation.
 */
export async function establishConversationKey(
  beeId: string,
  conversationId: string,
  memberBeeIds: string[],
) {
  const sodium = await S();
  await ensureIdentity(beeId);
  const existing = await getConversationKey(beeId, conversationId);
  if (existing) {
    await sealToMembers(
      beeId,
      conversationId,
      memberBeeIds,
      existing,
      ckEpochCache.get(conversationId) ?? 1,
    );
    return existing;
  }
  if (await haveKeyRow(beeId, conversationId)) {
    throw new Error('conversation key exists but cannot be opened on this device');
  }
  const ck = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  await sealToMembers(beeId, conversationId, memberBeeIds, ck, 1);
  return ck;
}

/** Re-seal the EXISTING CK to members' devices (new device / late member). Never mints. */
export async function resealConversationKey(
  beeId: string,
  conversationId: string,
  memberBeeIds: string[],
) {
  const ck = await getConversationKey(beeId, conversationId);
  if (!ck) throw new Error('no conversation key held; cannot reseal');
  await sealToMembers(
    beeId,
    conversationId,
    memberBeeIds,
    ck,
    ckEpochCache.get(conversationId) ?? 1,
  );
  return ck;
}

/**
 * RECOVERY: mint a NEW content key and seal it to all current member devices at
 * a fresh epoch. Use only when NO device can open the existing key. Messages
 * sent under the previous key become permanently unreadable.
 */
export async function rekeyConversation(
  beeId: string,
  conversationId: string,
  memberBeeIds: string[],
): Promise<Uint8Array> {
  const sodium = await S();
  await ensureIdentity(beeId);
  const { data } = await db()
    .from('comms_conversation_keys')
    .select('epoch')
    .eq('conversation_id', conversationId)
    .order('epoch', { ascending: false })
    .limit(1);
  const nextEpoch = ((data?.[0]?.epoch as number) ?? 0) + 1;
  const ck = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  ckCache.delete(conversationId);
  await sealToMembers(beeId, conversationId, memberBeeIds, ck, nextEpoch);
  return ck;
}

// ── call media key (LiveKit SFrame E2EE) ────────────────────────────────────
/**
 * Derive a deterministic LiveKit E2EE key (a shared-passphrase string) from the
 * conversation content key. Both members compute the same value locally from the
 * CK they already hold, so the media key is never transmitted and the LiveKit SFU
 * stays blind to the audio/video. Returns null when this device has no conversation
 * key yet — the call then falls back to transport-only (DTLS-SRTP), exactly as before.
 *
 * Unused by TALK v1 (no .tel calls yet) — kept because this is a verbatim port,
 * not a trimmed one; it becomes load-bearing the day a TALK_TEL pass lands.
 */
export async function deriveCallKey(
  beeId: string,
  conversationId: string,
  roomId: string,
): Promise<string | null> {
  const sodium = await S();
  const ck = await getConversationKey(beeId, conversationId);
  if (!ck) return null;
  const material = sodium.crypto_generichash(32, sodium.from_string(`livekit-e2ee:${roomId}`), ck);
  return sodium.to_base64(material, sodium.base64_variants.ORIGINAL);
}

// ── message body encrypt / decrypt ──────────────────────────────────────────
const ENC_PREFIX = 'e2ee:v1:';

export function isEncryptedBody(body: string): boolean {
  return typeof body === 'string' && body.startsWith(ENC_PREFIX);
}

export async function encryptBody(ck: Uint8Array, plaintext: string): Promise<string> {
  const sodium = await S();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    sodium.from_string(plaintext),
    null,
    null,
    nonce,
    ck,
  );
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);
  return ENC_PREFIX + sodium.to_base64(packed, sodium.base64_variants.ORIGINAL);
}

export async function decryptBody(ck: Uint8Array, body: string): Promise<string> {
  const sodium = await S();
  const packed = sodium.from_base64(body.slice(ENC_PREFIX.length), sodium.base64_variants.ORIGINAL);
  const npub = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  const nonce = packed.slice(0, npub);
  const ct = packed.slice(npub);
  const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, null, nonce, ck);
  return sodium.to_string(pt);
}

// ── binary encrypt / decrypt (E2EE media files, e.g. voice messages) ────────
/**
 * Seal raw bytes under the conversation content key: nonce‖ciphertext, no
 * prefix/base64 (this is a FILE, not a message body). The ciphertext is what
 * gets uploaded to storage — the server and anyone with the URL see only noise.
 *
 * Unused by TALK v1 (text messages only) — kept, same verbatim-port reasoning
 * as deriveCallKey above.
 */
export async function encryptBytes(ck: Uint8Array, bytes: Uint8Array): Promise<Uint8Array> {
  const sodium = await S();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, null, null, nonce, ck);
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);
  return packed;
}

/** Open nonce‖ciphertext produced by encryptBytes. Throws when the key is wrong. */
export async function decryptBytes(ck: Uint8Array, packed: Uint8Array): Promise<Uint8Array> {
  const sodium = await S();
  const npub = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  const nonce = packed.slice(0, npub);
  const ct = packed.slice(npub);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, null, nonce, ck);
}

// ── recovery code (move identity to a new device) ───────────────────────────
/** Export the secret key as an offline recovery code. Show once; user stores it. */
export async function exportRecoveryCode(beeId: string): Promise<string> {
  const sodium = await S();
  const id = await ensureIdentity(beeId);
  return sodium.to_base64(id.privateKey, sodium.base64_variants.URLSAFE_NO_PADDING);
}

/** Restore an identity on a new device from a recovery code. */
export async function importRecoveryCode(beeId: string, code: string): Promise<void> {
  const sodium = await S();
  const sk = sodium.from_base64(code.trim(), sodium.base64_variants.URLSAFE_NO_PADDING);
  const pk = sodium.crypto_scalarmult_base(sk); // X25519 public from secret
  await idbPut(`sk:${beeId}`, sk);
  await idbPut(`pk:${beeId}`, pk);
  identityCache.delete(beeId);
  ckCache.clear();
  await ensurePublished({ beeId, publicKey: pk, privateKey: sk });
}

// ── identity verification (safety number) ───────────────────────────────────
/**
 * A stable, comparable "safety number" derived from EVERY device key of the
 * given Bees. Both sides compute the identical value from public data, so
 * comparing it out-of-band (read it aloud / side by side) detects a
 * man-in-the-middle or a server-side key swap: if the numbers match, the keys
 * your messages are sealed to really belong to the other Bee(s). It changes
 * whenever someone adds or removes a device — that's the signal to re-verify.
 *
 * Rendered as 6 space-separated 5-digit groups (Signal-style, shortened).
 */
export async function computeSafetyNumber(beeIds: string[]): Promise<string> {
  const sodium = await S();
  const { data, error } = await db()
    .from('bee_keys')
    .select('bee_id, public_key')
    .in('bee_id', uniq(beeIds));
  if (error) throw error;
  // Canonical, order-independent: sort every (bee, key) pair, then hash.
  const rows = (data ?? []).map((r) => `${r.bee_id}:${r.public_key}`).sort();
  const digest = sodium.crypto_generichash(30, sodium.from_string(rows.join('|')), null);
  const groups: string[] = [];
  for (let i = 0; i < 30; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = (n * 256 + digest[i + j]) % 100000;
    groups.push(String(n).padStart(5, '0'));
  }
  return groups.join(' ');
}
