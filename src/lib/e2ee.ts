import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { S } from './sodium';
import { getSupabase } from './supabase';

/**
 * COMMS end-to-end encryption — NATIVE port of TheMANUAL.tech/src/lib/e2ee.ts.
 *
 * This is the SAME zero-knowledge, multi-device scheme, mounted on the SAME
 * comms_* schema. It is intentionally a line-for-line mirror of the web crypto so
 * the two clients interoperate byte-for-byte:
 *
 *  - Each Bee holds an X25519 identity keypair PER DEVICE. The PUBLIC key is
 *    published to `bee_keys` keyed by (bee_id, device_id). The SECRET key never
 *    leaves the device — here it lives in the OS keystore (Keychain / Keystore)
 *    via expo-secure-store, the native analogue of the web build's IndexedDB.
 *  - Each conversation has a random 256-bit content key (CK), sealed
 *    (crypto_box_seal) to EVERY device of EVERY member, stored per (member,
 *    device) in `comms_conversation_keys`.
 *  - Message bodies are XChaCha20-Poly1305 under the CK, stored as
 *    `e2ee:v1:` + base64(nonce||ciphertext); `comms_send` is called with
 *    is_encrypted=true.
 *
 * The server only ever sees public keys, sealed blobs, and ciphertext. Do not
 * change the algorithms, byte framing, or base64 variants — they are the wire
 * contract with the web client.
 */

function db() {
  return getSupabase();
}
function uniq(ids: string[]) {
  return Array.from(new Set(ids));
}

// ── device-local secret store (OS keystore + AsyncStorage) ───────────────────
// SECRET key → expo-secure-store (Keychain/Keystore, hardware-backed where
// available). Public key + device id → AsyncStorage (they are public). This is
// the sovereign posture: the identity secret is bound to the device's secure
// enclave and is never transmitted or backed up unless the Bee explicitly
// exports a recovery code.
const B64 = 0; // sodium.base64_variants.ORIGINAL (resolved lazily below)

async function b64Encode(bytes: Uint8Array): Promise<string> {
  const sodium = await S();
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}
async function b64Decode(s: string): Promise<Uint8Array> {
  const sodium = await S();
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
}
void B64;

async function skGet(beeId: string): Promise<Uint8Array | null> {
  const raw = await SecureStore.getItemAsync(`sk_${beeId}`);
  return raw ? b64Decode(raw) : null;
}
async function skPut(beeId: string, sk: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(`sk_${beeId}`, await b64Encode(sk));
}
async function pkGet(beeId: string): Promise<Uint8Array | null> {
  const raw = await AsyncStorage.getItem(`pk_${beeId}`);
  return raw ? b64Decode(raw) : null;
}
async function pkPut(beeId: string, pk: Uint8Array): Promise<void> {
  await AsyncStorage.setItem(`pk_${beeId}`, await b64Encode(pk));
}

// ── device id (stable per install) ───────────────────────────────────────────
const DEVICE_KEY = 'waggles.device_id';
let deviceIdCache: string | null = null;
export async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) {
    deviceIdCache = existing;
    return existing;
  }
  const sodium = await S();
  const did = sodium.to_base64(sodium.randombytes_buf(16), sodium.base64_variants.URLSAFE_NO_PADDING);
  await AsyncStorage.setItem(DEVICE_KEY, did);
  deviceIdCache = did;
  return did;
}

// ── identity ─────────────────────────────────────────────────────────────────
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
  let sk = await skGet(beeId);
  let pk = await pkGet(beeId);
  if (!sk || !pk) {
    const kp = sodium.crypto_box_keypair();
    sk = kp.privateKey;
    pk = kp.publicKey;
    await skPut(beeId, sk);
    await pkPut(beeId, pk);
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
async function fetchMemberDeviceKeys(beeIds: string[]): Promise<DeviceKey[]> {
  const sodium = await S();
  const { data, error } = await db()
    .from('bee_keys')
    .select('bee_id, device_id, public_key')
    .in('bee_id', uniq(beeIds));
  if (error) throw error;
  return (data ?? []).map((r: { bee_id: string; device_id: string | null; public_key: string }) => ({
    beeId: r.bee_id,
    deviceId: r.device_id ?? 'legacy',
    publicKey: sodium.from_base64(r.public_key, sodium.base64_variants.ORIGINAL),
  }));
}

// ── per-conversation content key ─────────────────────────────────────────────
const ckCache = new Map<string, Uint8Array>();
const ckEpochCache = new Map<string, number>();

export async function getConversationKey(beeId: string, conversationId: string): Promise<Uint8Array | null> {
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
  for (const row of (data ?? []) as { wrapped_key: string; epoch: number | null }[]) {
    try {
      const sealed = sodium.from_base64(row.wrapped_key, sodium.base64_variants.ORIGINAL);
      const ck = sodium.crypto_box_seal_open(sealed, id.publicKey, id.privateKey);
      if (ck) {
        ckCache.set(conversationId, ck);
        ckEpochCache.set(conversationId, row.epoch ?? 1);
        return ck;
      }
    } catch {
      /* this sealed copy is for a different device key — try the next one */
    }
  }
  return null;
}

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
    wrapped_key: sodium.to_base64(sodium.crypto_box_seal(ck, k.publicKey), sodium.base64_variants.ORIGINAL),
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

export async function establishConversationKey(beeId: string, conversationId: string, memberBeeIds: string[]) {
  const sodium = await S();
  await ensureIdentity(beeId);
  const existing = await getConversationKey(beeId, conversationId);
  if (existing) {
    await sealToMembers(beeId, conversationId, memberBeeIds, existing, ckEpochCache.get(conversationId) ?? 1);
    return existing;
  }
  if (await haveKeyRow(beeId, conversationId)) {
    throw new Error('conversation key exists but cannot be opened on this device');
  }
  const ck = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  await sealToMembers(beeId, conversationId, memberBeeIds, ck, 1);
  return ck;
}

export async function resealConversationKey(beeId: string, conversationId: string, memberBeeIds: string[]) {
  const ck = await getConversationKey(beeId, conversationId);
  if (!ck) throw new Error('no conversation key held; cannot reseal');
  await sealToMembers(beeId, conversationId, memberBeeIds, ck, ckEpochCache.get(conversationId) ?? 1);
  return ck;
}

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
  const nextEpoch = (((data?.[0]?.epoch as number | undefined) ?? 0) as number) + 1;
  const ck = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  ckCache.delete(conversationId);
  await sealToMembers(beeId, conversationId, memberBeeIds, ck, nextEpoch);
  return ck;
}

// ── message body encrypt / decrypt ───────────────────────────────────────────
const ENC_PREFIX = 'e2ee:v1:';

export function isEncryptedBody(body: string): boolean {
  return typeof body === 'string' && body.startsWith(ENC_PREFIX);
}

export async function encryptBody(ck: Uint8Array, plaintext: string): Promise<string> {
  const sodium = await S();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(sodium.from_string(plaintext), null, null, nonce, ck);
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

// ── recovery code (move identity to a new device) ────────────────────────────
export async function exportRecoveryCode(beeId: string): Promise<string> {
  const sodium = await S();
  const id = await ensureIdentity(beeId);
  return sodium.to_base64(id.privateKey, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export async function importRecoveryCode(beeId: string, code: string): Promise<void> {
  const sodium = await S();
  const sk = sodium.from_base64(code.trim(), sodium.base64_variants.URLSAFE_NO_PADDING);
  const pk = sodium.crypto_scalarmult_base(sk); // X25519 public from secret
  await skPut(beeId, sk);
  await pkPut(beeId, pk);
  identityCache.delete(beeId);
  ckCache.clear();
  await ensurePublished({ beeId, publicKey: pk, privateKey: sk });
}

// ── identity verification (safety number) ────────────────────────────────────
export async function computeSafetyNumber(beeIds: string[]): Promise<string> {
  const sodium = await S();
  const { data, error } = await db()
    .from('bee_keys')
    .select('bee_id, public_key')
    .in('bee_id', uniq(beeIds));
  if (error) throw error;
  const rows = ((data ?? []) as { bee_id: string; public_key: string }[])
    .map((r) => `${r.bee_id}:${r.public_key}`)
    .sort();
  const digest = sodium.crypto_generichash(30, sodium.from_string(rows.join('|')), null);
  const groups: string[] = [];
  for (let i = 0; i < 30; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = (n * 256 + digest[i + j]) % 100000;
    groups.push(String(n).padStart(5, '0'));
  }
  return groups.join(' ');
}

/** Wipe this device's identity + cached keys (sign-out on a shared device). */
export async function wipeDeviceIdentity(beeId: string): Promise<void> {
  identityCache.delete(beeId);
  ckCache.clear();
  ckEpochCache.clear();
  await SecureStore.deleteItemAsync(`sk_${beeId}`).catch(() => {});
  await AsyncStorage.removeItem(`pk_${beeId}`).catch(() => {});
}
