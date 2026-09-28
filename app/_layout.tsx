import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerGlobals } from '@livekit/react-native';
import { AuthProvider } from '@/lib/auth';

// WAGGLES_CALLS1 — LiveKit RN needs WebRTC globals registered once at startup
// (before any call). No-op for the messenger; required for the call screen.
registerGlobals();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
