import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function Index() {
  const { booting, connected, session } = useAuth();
  const t = useTheme();

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }
  if (!connected) return <Redirect href="/setup" />;
  if (!session) return <Redirect href="/sign-in" />;
  return <Redirect href="/chats" />;
}
