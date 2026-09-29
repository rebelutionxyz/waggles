import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getSupabase } from './supabase';

/**
 * PUSH notifications — NATIVE port of TheMANUAL/TALK push.
 *
 * The web reference uses Web Push (VAPID + a service worker); React Native uses
 * the Expo push service, so this is a transport port, not a copy. The design
 * that carries over exactly: CONTENT-BLIND, CLIENT-INVOKED.
 *
 *   - CONTENT-BLIND. comms_send enforces is_encrypted=true server-side, so the
 *     backend never has plaintext. The push payload is a GENERIC "New message"
 *     — no sender handle, no body preview, nothing about who or what. The tap
 *     deep-links to the conversation; the plaintext is decrypted on-device only.
 *   - CLIENT-INVOKED (not a DB trigger). Mirrors TALK's ringMessagePush: after a
 *     successful comms_send, the client fire-and-forgets an invoke of the
 *     `push-notify` edge function. This is the one precedent on the platform
 *     (push-send / push-send-message) and the most self-hostable shape — a
 *     self-hoster who doesn't want push simply doesn't deploy the function and
 *     leaves PUSH_ENABLED false.
 *
 * GATED: PUSH_ENABLED stays FALSE. Turning it on requires (a) the propose-only
 * migration supabase/migrations/20260929003000_waggles_push.sql (bee_push_tokens
 * + comms_push_subscribe/unsubscribe RPCs) applied by the owner, and (b) the
 * `push-notify` edge function deployed by LEAD. Device-only verifiable.
 * See docs/OWNER_APPLY.md → WAGGLES_PUSH.
 */
export const PUSH_ENABLED = false;

function req() {
  return getSupabase();
}

// Foreground presentation: show a banner even while the app is open. No content
// is shown beyond the generic payload the server sends.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  // EAS projectId is required by getExpoPushTokenAsync in SDK 52. Read it from
  // app config; undefined is fine on a self-host that hasn't set one (the token
  // call then throws and registration is a no-op — best-effort by design).
  const c = Constants as unknown as {
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
    easConfig?: { projectId?: string };
  };
  return c.expoConfig?.extra?.eas?.projectId ?? c.easConfig?.projectId;
}

/**
 * Register this device for push: request permission, fetch the Expo push token,
 * and store it via comms_push_subscribe. Silent + best-effort — any failure
 * (simulator, denied permission, missing projectId, RPC not applied) is
 * swallowed so it never blocks sign-in. No-op unless PUSH_ENABLED.
 */
export async function registerPush(): Promise<void> {
  if (!PUSH_ENABLED) return;
  try {
    if (!Device.isDevice) return; // the Expo push service has no simulator tokens
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const pid = projectId();
    const tokenResp = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined);
    const token = tokenResp.data;
    if (!token) return;

    await req().rpc('comms_push_subscribe', {
      p_token: token,
      p_platform: Platform.OS,
    });
  } catch {
    /* best-effort: push is a convenience, never a gate */
  }
}

/** Remove this device's token (e.g. on sign-out). Best-effort, no-op unless enabled. */
export async function unregisterPush(): Promise<void> {
  if (!PUSH_ENABLED) return;
  try {
    const pid = projectId();
    const tokenResp = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined);
    const token = tokenResp.data;
    if (token) await req().rpc('comms_push_unsubscribe', { p_token: token });
  } catch {
    /* best-effort */
  }
}

/**
 * Fire-and-forget: ask the backend to push a generic "New message" to the other
 * participants of a conversation. Called right after a successful comms_send.
 * Content-blind: passes only ids; the edge function sends no plaintext. No-op
 * unless PUSH_ENABLED. Never throws (caller does not await the result).
 */
export function notifyNewMessage(conversationId: string, messageId: string): void {
  if (!PUSH_ENABLED) return;
  void req()
    .functions.invoke('push-notify', { body: { conversation_id: conversationId, message_id: messageId } })
    .catch(() => {});
}

/**
 * Subscribe to notification taps → deep-link into the conversation. `onOpen`
 * receives the conversation id the notification carried (the ONLY routing datum
 * in the payload). Returns an unsubscribe fn. No-op unless PUSH_ENABLED.
 */
export function subscribeNotificationTaps(onOpen: (conversationId: string) => void): () => void {
  if (!PUSH_ENABLED) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const data = resp.notification.request.content.data as { conversation_id?: string } | undefined;
    if (data?.conversation_id) onOpen(data.conversation_id);
  });
  return () => sub.remove();
}
