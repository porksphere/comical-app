import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DemoBanner } from '@/components/demo-banner';
import { ErrorBoundary } from '@/components/error-boundary';
import { OverlayProvider } from '@/components/overlay/overlay';
import { persister, PERSIST_BUSTER, PERSIST_MAX_AGE_MS, queryClient } from '@/data/query-client';
import { useActiveColorScheme } from '@/hooks/use-theme';

export default function RootLayout() {
  // Resolved (forced dark for now) scheme so the navigation theme matches the
  // app content and renders identically on the static export's server + client.
  const scheme = useActiveColorScheme();
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: PERSIST_MAX_AGE_MS, buster: PERSIST_BUSTER }}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AnimatedSplashOverlay />
            {/* OverlayProvider hosts the stacked bottom-sheet overlays app-wide. */}
            <OverlayProvider>
              {/* Native stack: real UINavigationController on iOS (large titles, back
                  gesture) and the native toolbar on Android. The tab group hides its
                  own header; the pushed `detail` screen shows a native large title. */}
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="detail" options={{ title: 'Detail', headerLargeTitle: true }} />
                {/* Series page renders its own static top bar (bridge name + back
                    button), so the native stack header is hidden here. */}
                <Stack.Screen name="series" options={{ headerShown: false }} />
                {/* Full-screen page reader; its own dark chrome, fade in/out. */}
                <Stack.Screen name="reader" options={{ headerShown: false, animation: 'fade' }} />
              </Stack>
              <DemoBanner />
            </OverlayProvider>
          </ThemeProvider>
        </GestureHandlerRootView>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
