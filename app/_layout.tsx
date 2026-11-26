import { BillStoreProvider } from '@/store/billStore';
import { AuthProvider, useAuth } from '@/store/authStore';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

export {
    ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  anchor: 'index',
};

SplashScreen.preventAutoHideAsync();

function AppNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { status } = useAuth();
  useEffect(() => {
    if (fontsLoaded && status !== 'loading') {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, status]);

  const isAuthenticated = status === 'authenticated';
  const isUnauthenticated = status === 'unauthenticated';

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="auth/callback" />
      <Stack.Protected guard={isUnauthenticated} redirectTo="/(tabs)">
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/signup" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated} redirectTo="/auth/login">
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="scan/index"
          options={{ animation: 'slide_from_bottom', gestureEnabled: true }}
        />
        <Stack.Screen
          name="scan/review"
          options={{ animation: 'slide_from_right', gestureEnabled: true }}
        />
        <Stack.Screen
          name="scan/results"
          options={{ animation: 'slide_from_right', gestureEnabled: true }}
        />
        <Stack.Screen
          name="split/new"
          options={{ animation: 'slide_from_right', gestureEnabled: true }}
        />
        <Stack.Screen
          name="split/assignment"
          options={{ animation: 'slide_from_right', gestureEnabled: true }}
        />
        <Stack.Screen
          name="split/summary"
          options={{ animation: 'slide_from_right', gestureEnabled: true }}
        />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  return (
    <BillStoreProvider>
      <AuthProvider>
        <AppNavigator fontsLoaded={fontsLoaded} />
      </AuthProvider>
    </BillStoreProvider>
  );
}
