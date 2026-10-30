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
import type { ComponentProps } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SplashGate } from '@/components/splash-gate';
import { pushedScreen, settingsScreen } from '@/lib/native-bar';
import { DemoBanner } from '@/components/demo-banner';
import { ErrorBoundary } from '@/components/error-boundary';
import { ConfirmPopupHost } from '@/components/confirm-popup';
import { ContextMenuHost, installMenuKeys } from '@/components/context-menu-host';
import { installSpreadPickKeys, SpreadPickHost } from '@/components/reader/spread-pick';
import { CollectionPickerHost } from '@/components/collection-picker';
import { OverlayProvider } from '@/components/overlay/overlay';
import { RequestOverlay } from '@/components/request-overlay';
import { SeriesCardContextMenuHost } from '@/components/series-card-context-menu';
import { SystemContextMenuHost } from '@/components/system-context-menu';
import { ToastHost } from '@/components/toast';
import { installActivityAutoCheck } from '@/data/activity/auto-check';
import { installDesktopChapterCheck } from '@/data/activity/desktop-check';
import { installDesktopSyncRefresh } from '@/data/sync/desktop';
import { startEmbeddedRuntime } from '@/data/embedded/startup';
import { installErrorToasts } from '@/data/error-toasts';
import { installAppUpdateAutoCheck } from '@/data/use-app-update';
import { installBrowserZoomToast } from '@/lib/browser-zoom-toast';
import { useDesktopShellCommands, useNavigationKeys } from '@/lib/desktop-commands';
import { installFocusNav } from '@/lib/focus-nav';
import { FocusedTabTracker } from '@/lib/focused-tab';
import { installKeyboardScroll } from '@/lib/keyboard-scroll';
import { SwiftUICardMenuProvider } from '@/lib/card-menu-flag';
import { useFrameTrace } from '@/lib/frame-trace';
import { PROFILING_ENABLED } from '@/lib/profiling';
import { useWindowThemeColor } from '@/lib/window-controls';
import { persister, PERSIST_BUSTER, PERSIST_MAX_AGE_MS, queryClient, shouldDehydrateQuery } from '@/data/query-client';
import { ThemeSchemeProvider, useActiveColorScheme } from '@/hooks/use-theme';
import { Colors } from '@/constants/theme';
/* eslint-enable import/first */

// Install the on-device transport per the persisted preference before any screen queries fire
// (native only; a no-op on web and until the native module is linked — the app stays remote).
startEmbeddedRuntime();

// New-chapter auto-check on launch + foreground return (all platforms; startup.ts is native-only).
installActivityAutoCheck();
installDesktopChapterCheck();
installDesktopSyncRefresh();

// App-update auto-check on launch + foreground return — see data/use-app-update.ts. No-ops on
// internal/dev build channels.
installAppUpdateAutoCheck();

// Red toasts for failed requests, unless Settings → General turns them off.
installErrorToasts();

// "Browser zoom 110%" for Ctrl/⌘ +/-/0, which the page leaves to the browser (web only).
installBrowserZoomToast();

installMenuKeys();
installSpreadPickKeys();
// W/S and ↑/↓ scroll whichever screen is under the pointer (web only).
installFocusNav();
installKeyboardScroll();

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

/** The UI-thread frame recorder (lib/frame-trace) — inert unless the gesture trace is recording. */
function FrameTrace() {
  useFrameTrace();
  return null;
}

function RootNavigation() {
  // Active scheme from context (resolved once by ThemeSchemeProvider above) so the
  // navigation theme + status bar match the app content and re-theme live when the
  // preference changes.
  const scheme = useActiveColorScheme();
  useWindowThemeColor(Colors[scheme].background);
  const filterSheet: ComponentProps<typeof Stack.Screen>['options'] = {
    headerShown: false,
    presentation: 'formSheet',
    sheetAllowedDetents: [0.6, 1],
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: Colors[scheme].backgroundPanel },
  };
  useDesktopShellCommands();
  useNavigationKeys();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Status-bar contents follow the active scheme (light glyphs on the dark
          theme, dark glyphs on light) so a forced theme reads right even when it
          differs from the OS. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SplashGate />
      <FrameTrace />
      <FocusedTabTracker />
      {/* OverlayProvider hosts the stacked bottom-sheet overlays app-wide. */}
      <OverlayProvider>
        {/* Developer A/B: which context menu series cards hold on iOS (lib/card-menu-flag). */}
        <SwiftUICardMenuProvider>
          {/* Native stack: real UINavigationController on iOS (large titles, back
              gesture) and the native toolbar on Android. The tab group and every
              pushed screen below hide the native header and render their own chrome,
              except the settings categories, which take the system bar on iOS. */}
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="search" options={pushedScreen} />
            {/* The search filters as a system form sheet (iOS; the custom bars keep their shutter).
                A sheet is its own view controller, above the app-root overlay hosts, so it hosts a
                stack of its own and pushes the editors as screens — see app/search-filters. */}
            <Stack.Screen name="search-filters" options={filterSheet} />
            {/* Custom-lists manager (create/rename/reorder/delete), pushed from the Library selector. */}
            <Stack.Screen name="manage-collections" options={settingsScreen('Manage Collections')} />
            <Stack.Screen name="results" options={pushedScreen} />
            {/* THE series page — and the only reader there is: the details and the reader are the
                two pages of its nested stack, `index` and `read` (see SeriesSplit in
                components/series/split-handoff). Everything that used to push a standalone /reader (a History row,
                the card menu's Read, a chapter row, a page thumbnail) opens THIS, on whichever page
                it means.

                A *contained* transparent modal, so the screen it was opened from stays rendered
                underneath — the reader's own dark backdrop covers it at rest and fades out under a
                swipe-away, revealing it — and so its dismissal can collapse back into the card it
                was opened from. `contained…` (not plain `transparentModal`) keeps it inside the
                JS-managed container instead of a separate native modal VC, so the app-root overlays
                (the reader settings sheet) still render ABOVE it; a plain transparentModal presented
                them behind, which made the settings gear look dead on iOS. The route is a DIRECTORY
                hosting its own nested stack — sub-pages (downloads) push as real cards inside the
                modal (see app/series/_layout.tsx).

                `animation: 'none'` because the SCREEN animates itself: it grows out of that card's
                cover and collapses back into it, and every exit (swipe, chevron, hardware back)
                plays that collapse before popping the route. A native modal can't do it — its
                animation comes from UIModalTransitionStyle, which offers no such thing. */}
            <Stack.Screen
              name="series"
              options={{ headerShown: false, animation: 'none', presentation: 'containedTransparentModal' }}
            />
            {/* The Settings tab is only a table of contents — every screen below is one it pushes.
                Each takes the system bar on iOS (its `TopBar` retitles it and adds its actions)
                and draws that `TopBar` itself elsewhere. */}
            <Stack.Screen name="settings-general" options={settingsScreen('General')} />
            <Stack.Screen name="settings-notifications" options={settingsScreen('Notifications')} />
            <Stack.Screen name="settings-shortcuts" options={settingsScreen('Keyboard shortcuts')} />
            <Stack.Screen name="settings-sync" options={settingsScreen('Sync')} />
            <Stack.Screen name="settings-developer" options={settingsScreen('Developer')} />
            <Stack.Screen name="settings-about" options={settingsScreen('About')} />
            <Stack.Screen name="settings-whats-new" options={settingsScreen("What's new")} />
            <Stack.Screen name="scan-sync-server" options={settingsScreen('Scan a code')} />
            <Stack.Screen name="bridges" options={settingsScreen('Bridges')} />
            <Stack.Screen name="trackers" options={settingsScreen('Trackers')} />
            <Stack.Screen name="bridge-settings" options={settingsScreen('Bridge settings')} />
            <Stack.Screen name="tracker-settings" options={settingsScreen('Tracker settings')} />
            <Stack.Screen name="registries" options={settingsScreen('Registries')} />
            <Stack.Screen name="custom-pages" options={settingsScreen('Custom Pages')} />
            <Stack.Screen name="custom-page-editor" options={settingsScreen('Custom Page')} />
            <Stack.Screen name="custom-section-editor" options={settingsScreen('Section')} />
            <Stack.Screen name="registry-browse" options={settingsScreen('Browse registry')} />
            <Stack.Screen name="add-registry" options={settingsScreen('Add registry')} />
            <Stack.Screen name="diagnostics" options={settingsScreen('Diagnostics')} />
            <Stack.Screen name="gesture-trace" options={settingsScreen('Gesture trace')} />
            <Stack.Screen name="downloads" options={settingsScreen('Downloads')} />
            <Stack.Screen name="series-downloads" options={settingsScreen('Downloads')} />
            <Stack.Screen name="storage" options={settingsScreen('Storage')} />
            <Stack.Screen name="favorites-import" options={settingsScreen('Import favorites')} />
            <Stack.Screen name="tracker-import" options={settingsScreen('Import')} />
          </Stack>
        </SwiftUICardMenuProvider>
        <DemoBanner />
        {/* Root host for the native card long-press context menu (dim + lifted preview + menu). Only
            renders while a card menu is open; any card opens it via openSeriesCardMenu. */}
        <SeriesCardContextMenuHost />
        {/* Root host for the GENERIC hold menu — the card popup's menu system without its preview
            panel (chapter rows use it). Only renders while open, via openContextMenu. */}
        <ContextMenuHost />
        {/* Publishes the rows of an open iOS system context menu (SystemContextMenu); renders
            nothing, and only while one is up. */}
        <SystemContextMenuHost />
        {/* Root host for the reader's which-page-of-the-spread picker (openSpreadPick). */}
        <SpreadPickHost />
        {/* Root host for the "Add to collection…" picker. Mounted AFTER the card menu host so it STACKS
            on top of it (open it from the card menu's "Add to collection…" row), via openCollectionPicker. */}
        <CollectionPickerHost />
        {/* Root host for the destructive-action confirmation popup (openConfirm). */}
        <ConfirmPopupHost />
        {/* Root host for the transient notice pill (showToast). */}
        <ToastHost />
        {/* Corner panel of requests in flight / recent timeouts; null unless Settings → General turns it on. */}
        <RequestOverlay />
        {/* DEV-only floating Hermes JS profiler; null in production (see require above),
            and hidden unless the Settings → Developer toggle is on. Temporary tooling. */}
        {DevProfiler ? <DevProfiler /> : null}
      </OverlayProvider>
    </ThemeProvider>
  );
}

// Touch breadcrumbs stay on, but the per-touch fiber-tree walk is cut to the touched component
// alone: at the default depth (20 levels) the boundary's _onTouchStart costs ~20ms of JS on every
// touch-down — right when a page-swipe gesture needs the thread.
export default Sentry.wrap(RootLayout, { touchEventBoundaryProps: { maxComponentTreeSize: 1 } });
