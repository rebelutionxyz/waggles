import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CommsMessage, Conversation } from './comms';

/**
 * OFFLINE-FIRST cache + outbox.
 *
 * The conversation list and each open thread are cached locally so the app opens
 * to real content with no network, and a message composed offline is queued in an
 * outbox and flushed when connectivity returns. This is the sovereign, offline
 * posture: the device is useful on its own.
 *
 * POSTURE NOTE: cached message bodies are the DECRYPTED plaintext, held in the
 * app's private sandbox (not the OS keystore). The identity SECRET stays in
 * secure storage; this cache is a convenience mirror. A hardened build should
 * move it behind SQLCipher / an encrypted store — tracked in the README. Sign-out
 * calls clearAllCache().
 */

const CONV_KEY = 'waggles.cache.conversations.v1';
const OUTBOX_KEY = 'waggles.outbox.v1';
const msgKey = (id: string) => `waggles.cache.msgs.v1:${id}`;

export async function cacheConversations(list: Conversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CONV_KEY, JSON.stringify(list));
  } catch {
    /* cache is best-effort */
  }
}

export async function loadCachedConversations(): Promise<Conversation[]> {
  try {
    const raw = await AsyncStorage.getItem(CONV_KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

export async function cacheMessages(conversationId: string, msgs: CommsMessage[]): Promise<void> {
  try {
    // keep the tail — bounded so the cache can't grow without limit
    const tail = msgs.slice(-300);
    await AsyncStorage.setItem(msgKey(conversationId), JSON.stringify(tail));
  } catch {
    /* best-effort */
  }
}

export async function loadCachedMessages(conversationId: string): Promise<CommsMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(msgKey(conversationId));
    return raw ? (JSON.parse(raw) as CommsMessage[]) : [];
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
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const list = await getOutbox();
  list.push(item);
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
}

export async function removeOutbox(itemId: string): Promise<void> {
  const list = (await getOutbox()).filter((i) => i.id !== itemId);
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
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
  } catch {
    /* best-effort */
  }
}
