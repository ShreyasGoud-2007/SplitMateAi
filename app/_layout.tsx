import { BillStoreProvider } from '@/store/billStore';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

export {
    ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <BillStoreProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Main tab navigator */}
        <Stack.Screen name="(tabs)" />

        {/* Bill scanning flow */}
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

        {/* Modal */}
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </BillStoreProvider>
  );
}
