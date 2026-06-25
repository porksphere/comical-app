import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { OverlayProvider } from '@/components/overlay/overlay';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {/* OverlayProvider hosts the stacked bottom-sheet overlays app-wide. */}
        <OverlayProvider>
          {/* Native stack: real UINavigationController on iOS (large titles, back
              gesture) and the native toolbar on Android. The tab group hides its
              own header; the pushed `detail` screen shows a native large title. */}
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="detail" options={{ title: 'Detail', headerLargeTitle: true }} />
          </Stack>
        </OverlayProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
