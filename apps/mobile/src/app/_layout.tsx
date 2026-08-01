import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

import { isE2eBuildChannel, SENTRY_BUILD_CHANNEL, SENTRY_DSN } from '@/lib/sentry';

// Runs before any other module below, so JS errors/native crashes are caught
// from the earliest possible point in app startup. Disabled on web: the
// deploy-web.yml GitHub Pages preview is a public, unauthenticated URL with
// no native crash surface, so there's no reason to spend free-tier quota on
// anonymous visitors there. Dev-client crashes ARE kept (not gated on
// __DEV__) — they're real signal from on-device iteration, distinguished from
// shipped builds via the `buildChannel` tag (see lib/sentry.ts) instead of
// being dropped outright.
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: Platform.OS !== 'web',
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: 0, // crash/error capture only, no perf/APM quota usage
  // See isE2eBuildChannel: the Maestro E2E CI simulator is too CPU-starved for the App Hang
  // watchdog's readings to mean anything.
  enableAppHangTracking: !isE2eBuildChannel(SENTRY_BUILD_CHANNEL),
  initialScope: { tags: { buildChannel: SENTRY_BUILD_CHANNEL } },
});

/* eslint-disable import/first -- these must stay below Sentry.init above:
   Metro/Babel execute top-level statements in source order (unlike native
   ESM hoisting), so this ordering is what actually keeps Sentry.init the
   first thing to run. */
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DemoBanner } from '@/components/demo-banner';
import { ErrorBoundary } from '@/components/error-boundary';
import { ConfirmPopupHost } from '@/components/confirm-popup';
import { ContextMenuHost } from '@/components/context-menu-host';
import { ListPickerHost } from '@/components/list-picker';
import { OverlayProvider } from '@/components/overlay/overlay';
import { SeriesCardContextMenuHost } from '@/components/series-card-context-menu';
import { ToastHost } from '@/components/toast';
import { installActivityAutoCheck } from '@/data/activity/auto-check';
import { startEmbeddedRuntime } from '@/data/embedded/startup';
import { installAppUpdateAutoCheck } from '@/data/use-app-update';
import { PROFILING_ENABLED } from '@/lib/profiling';
import { persister, PERSIST_BUSTER, PERSIST_MAX_AGE_MS, queryClient, shouldDehydrateQuery } from '@/data/query-client';
import { ThemeSchemeProvider, useActiveColorScheme } from '@/hooks/use-theme';
/* eslint-enable import/first */

// Install the on-device transport per the persisted preference before any screen queries fire
// (native only; a no-op on web and until the native module is linked — the app stays remote).
startEmbeddedRuntime();

// New-chapter auto-check on launch + foreground return (all platforms; startup.ts is native-only).
installActivityAutoCheck();

// App-update auto-check on launch + foreground return — see data/use-app-update.ts. No-ops on
// internal/dev build channels.
installAppUpdateAutoCheck();

// DevProfiler is profiling-only tooling; require it behind `PROFILING_ENABLED` (dev, or a CI
// profiling-release build) so its module — and the react-native-release-profiler dependency it
// pulls in — is dead-code-stripped from the real production bundle. It renders nothing unless the
// Settings → Developer "JS profiler button" toggle is on.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevProfiler = PROFILING_ENABLED ? require('@/components/dev-profiler').DevProfiler : null;

function RootLayout() {
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE_MS,
          buster: PERSIST_BUSTER,
          // Keep heavy scraped content (chapters/detail/pages) out of the disk
          // cache — see `shouldDehydrateQuery`; it was the ~400ms serialize stall.
          dehydrateOptions: { shouldDehydrateQuery },
        }}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {/* Resolves the active scheme once for the whole tree; every `useTheme`
              consumer below reads it from context. */}
          <ThemeSchemeProvider>
            <RootNavigation />
          </ThemeSchemeProvider>
        </GestureHandlerRootView>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}

function RootNavigation() {
  // Active scheme from context (resolved once by ThemeSchemeProvider above) so the
  // navigation theme + status bar match the app content and re-theme live when the
  // preference changes.
  const scheme = useActiveColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Status-bar contents follow the active scheme (light glyphs on the dark
          theme, dark glyphs on light) so a forced theme reads right even when it
          differs from the OS. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AnimatedSplashOverlay />
      {/* OverlayProvider hosts the stacked bottom-sheet overlays app-wide. */}
      <OverlayProvider>
        {/* Native stack: real UINavigationController on iOS (large titles, back
            gesture) and the native toolbar on Android. The tab group and every
            pushed screen below hide the native header and render their own chrome. */}
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* Series page renders its own static top bar (bridge name + back
              button), so the native stack header is hidden here. */}
          <Stack.Screen name="series" options={{ headerShown: false }} />
          {/* Search renders its own top bar (search field + back button), so hide the native one. */}
          <Stack.Screen name="search" options={{ headerShown: false }} />
          {/* Custom-lists manager (create/rename/reorder/delete), pushed from the Library selector. */}
          <Stack.Screen name="manage-lists" options={{ headerShown: false }} />
          <Stack.Screen name="results" options={{ headerShown: false }} />
          {/* Full-screen page reader; its own dark chrome, fade in/out. A
              *contained* transparent modal so the screen it was opened from stays
              rendered underneath — the reader's own dark backdrop covers it at
              rest and fades out under a swipe-away, revealing it (see reader.tsx).
              `contained…` (not plain `transparentModal`) keeps the reader inside
              the JS-managed container instead of a separate native modal VC, so
              the app-root overlays (the reader settings sheet) still render ABOVE
              it — a plain transparentModal presented them behind the reader,
              making the settings gear look dead on iOS. */}
          <Stack.Screen
            name="reader"
            options={{ headerShown: false, animation: 'fade', presentation: 'containedTransparentModal' }}
          />
          {/* EXPERIMENTAL series reader page (Settings → General → Experimental): a series opened
              from a card lands straight in its reader, info + chapters one scroll away. Fades in
              like the reader but stays an ordinary opaque card (its info half is themed content,
              and the back edge-swipe should keep working). Remove with the experiment — see
              app/series-reader.tsx for the full removal list. */}
          <Stack.Screen name="series-reader" options={{ headerShown: false, animation: 'fade' }} />
          {/* These render their own <TopBar> (matching series.tsx), so the native
              stack header is hidden here too. The Settings tab is only a table of
              contents — every category below is a screen it pushes. */}
          <Stack.Screen name="settings-general" options={{ headerShown: false }} />
          <Stack.Screen name="settings-notifications" options={{ headerShown: false }} />
          <Stack.Screen name="settings-developer" options={{ headerShown: false }} />
          <Stack.Screen name="settings-about" options={{ headerShown: false }} />
          <Stack.Screen name="bridges" options={{ headerShown: false }} />
          <Stack.Screen name="trackers" options={{ headerShown: false }} />
          <Stack.Screen name="bridge-settings" options={{ headerShown: false }} />
          <Stack.Screen name="tracker-settings" options={{ headerShown: false }} />
          <Stack.Screen name="registries" options={{ headerShown: false }} />
          <Stack.Screen name="custom-pages" options={{ headerShown: false }} />
          <Stack.Screen name="custom-page-editor" options={{ headerShown: false }} />
          <Stack.Screen name="custom-section-editor" options={{ headerShown: false }} />
          <Stack.Screen name="registry-browse" options={{ headerShown: false }} />
          <Stack.Screen name="add-registry" options={{ headerShown: false }} />
          <Stack.Screen name="diagnostics" options={{ headerShown: false }} />
          <Stack.Screen name="downloads" options={{ headerShown: false }} />
          <Stack.Screen name="series-downloads" options={{ headerShown: false }} />
          <Stack.Screen name="storage" options={{ headerShown: false }} />
          <Stack.Screen name="favorites-import" options={{ headerShown: false }} />
        </Stack>
        <DemoBanner />
        {/* Root host for the native card long-press context menu (dim + lifted preview + menu). Only
            renders while a card menu is open; any card opens it via openSeriesCardMenu. */}
        <SeriesCardContextMenuHost />
        {/* Root host for the GENERIC hold menu — the card popup's menu system without its preview
            panel (chapter rows use it). Only renders while open, via openContextMenu. */}
        <ContextMenuHost />
        {/* Root host for the "Add to list…" picker. Mounted AFTER the card menu host so it STACKS
            on top of it (open it from the card menu's "Add to list…" row), via openListPicker. */}
        <ListPickerHost />
        {/* Root host for the destructive-action confirmation popup (openConfirm). */}
        <ConfirmPopupHost />
        {/* Root host for the transient notice pill (showToast). */}
        <ToastHost />
        {/* DEV-only floating Hermes JS profiler; null in production (see require above),
            and hidden unless the Settings → Developer toggle is on. Temporary tooling. */}
        {DevProfiler ? <DevProfiler /> : null}
      </OverlayProvider>
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
