import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

import { SENTRY_DSN } from '@/lib/sentry';

// Runs before any other module below, so JS errors/native crashes are caught
// from the earliest possible point in app startup. Disabled on web: the
// deploy-web.yml GitHub Pages preview is a public, unauthenticated URL with
// no native crash surface, so there's no reason to spend free-tier quota on
// anonymous visitors there.
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: Platform.OS !== 'web',
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: 0, // crash/error capture only, no perf/APM quota usage
});

/* eslint-disable import/first -- these must stay below Sentry.init above:
   Metro/Babel execute top-level statements in source order (unlike native
   ESM hoisting), so this ordering is what actually keeps Sentry.init the
   first thing to run. */
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DemoBanner } from '@/components/demo-banner';
import { ErrorBoundary } from '@/components/error-boundary';
import { OverlayProvider } from '@/components/overlay/overlay';
import { persister, PERSIST_BUSTER, PERSIST_MAX_AGE_MS, queryClient } from '@/data/query-client';
import { useActiveColorScheme } from '@/hooks/use-theme';
/* eslint-enable import/first */

function RootLayout() {
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
                <Stack.Screen name="bridge-settings" options={{ title: 'Bridge settings' }} />
                <Stack.Screen name="tracker-settings" options={{ title: 'Tracker settings' }} />
                <Stack.Screen name="registries" options={{ title: 'Registries' }} />
                <Stack.Screen name="registry-browse" options={{ title: 'Browse registry' }} />
              </Stack>
              <DemoBanner />
            </OverlayProvider>
          </ThemeProvider>
        </GestureHandlerRootView>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
