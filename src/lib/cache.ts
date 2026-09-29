import AsyncStorage from '@react-native-async-storage/async-storage';
import { openCache, sealCache, wipeCacheKey } from './e2ee';
import type { CommsMessage, Conversation } from './comms';

/**
 * OFFLINE-FIRST cache + outbox.
 *
 * The conversation list and each open thread are cached locally so the app opens
 * to real content with no network, and a message composed offline is queued in an
 * outbox and flushed when connectivity returns. This is the sovereign, offline
 * posture: the device is useful on its own.
 *
 * AT-REST ENCRYPTION (WAGGLES_CACHE_ENC1): although these values are DECRYPTED
 * plaintext logically, they are NOT written to disk in the clear. Every value is
 * sealed under a device-local Cache Encryption Key (e2ee.sealCache / openCache;
 * CEK in the OS keystore) before it touches AsyncStorage, and opened on read.
 * A value that cannot be opened — a legacy plaintext entry, or one sealed under a
 * since-wiped CEK — is treated as a cache miss and re-fetched, never trusted.
 * Sign-out calls clearAllCache() + wipeCacheKey().
 */

const CONV_KEY = 'waggles.cache.conversations.v1';
const OUTBOX_KEY = 'waggles.outbox.v1';
const msgKey = (id: string) => `waggles.cache.msgs.v1:${id}`;

// ── sealed AsyncStorage helpers ──
async function setSealed(key: string, value: unknown): Promise<void> {
  const sealed = await sealCache(JSON.stringify(value));
  await AsyncStorage.setItem(key, sealed);
}
async function getSealed<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  const plain = await openCache(raw);
  if (plain === null) return fallback; // legacy plaintext / unreadable → cache miss
  return JSON.parse(plain) as T;
}

export async function cacheConversations(list: Conversation[]): Promise<void> {
  try {
    await setSealed(CONV_KEY, list);
  } catch {
    /* cache is best-effort */
  }
}

export async function loadCachedConversations(): Promise<Conversation[]> {
  try {
    return await getSealed<Conversation[]>(CONV_KEY, []);
  } catch {
    return [];
  }
}

export async function cacheMessages(conversationId: string, msgs: CommsMessage[]): Promise<void> {
  try {
    // keep the tail — bounded so the cache can't grow without limit
    const tail = msgs.slice(-300);
    await setSealed(msgKey(conversationId), tail);
  } catch {
    /* best-effort */
  }
}

export async function loadCachedMessages(conversationId: string): Promise<CommsMessage[]> {
  try {
    return await getSealed<CommsMessage[]>(msgKey(conversationId), []);
  } catch {
    return [];
  }
}

// ── outbox ──
export interface OutboxItem {
  id: string;
  conversationId: string;
  body: string;
  replyTo: string | null;
  createdAt: string;
}

export async function getOutbox(): Promise<OutboxItem[]> {
  try {
    return await getSealed<OutboxItem[]>(OUTBOX_KEY, []);
  } catch {
    return [];
  }
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const list = await getOutbox();
  list.push(item);
  await setSealed(OUTBOX_KEY, list);
}

export async function removeOutbox(itemId: string): Promise<void> {
  const list = (await getOutbox()).filter((i) => i.id !== itemId);
  await setSealed(OUTBOX_KEY, list);
}

export async function outboxFor(conversationId: string): Promise<OutboxItem[]> {
  return (await getOutbox()).filter((i) => i.conversationId === conversationId);
}

export async function clearAllCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(
      (k) => k.startsWith('waggles.cache.') || k === OUTBOX_KEY || k.startsWith('hc_sn_verified:'),
    );
    if (mine.length) await AsyncStorage.multiRemove(mine);
    // Drop the device CEK too: once the sealed values are gone, the key has no
    // purpose, and wiping it makes any residual ciphertext permanently unreadable.
    await wipeCacheKey();
  } catch {
    /* best-effort */
  }
}
