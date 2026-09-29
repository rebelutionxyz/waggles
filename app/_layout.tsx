import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerGlobals } from '@livekit/react-native';
import { AuthProvider } from '@/lib/auth';
import { CallRing } from '@/components/CallRing';
import { subscribeNotificationTaps } from '@/lib/push';

// WAGGLES_CALLS1 — LiveKit RN needs WebRTC globals registered once at startup
// (before any call). No-op for the messenger; required for the call screen.
registerGlobals();

export default function RootLayout() {
  const router = useRouter();

  // WAGGLES_PUSH1 — tapping a push (which carries only a conversation id, never
  // content) deep-links into that thread. No-op unless PUSH_ENABLED.
  useEffect(() => {
    return subscribeNotificationTaps((conversationId) => {
      router.push({ pathname: '/c/[id]', params: { id: conversationId } });
    });
  }, [router]);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
        <CallRing />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
