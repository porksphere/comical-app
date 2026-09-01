import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AboutIcon,
  BridgesIcon,
  ChevronRightIcon,
  CustomPagesIcon,
  DeveloperIcon,
  DiagnosticsIcon,
  DownloadsIcon,
  GeneralSettingsIcon,
  NotificationsIcon,
  RegistriesIcon,
  StorageIcon,
  TrackersIcon,
} from '@/components/icons/ui-icons';
import { CumulativeDownloadRadial } from '@/components/downloads/cumulative-radial';
import { UpdatePip } from '@/components/tab-badge';
import { settingsRowFrame } from '@/components/settings/settings-row';
import { TabTitleBar } from '@/components/tab-title-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { MaxTopLevelWidth, SettingsGutter } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { dlStorageUsage } from '@/data/api';
import { useCustomPages } from '@/data/custom-pages';
import { EMPTY_STORAGE_USAGE, overallProgress } from '@/data/downloads/derive';
import { queryKeys } from '@/data/queries';
import { useRegistryUpdateCounts } from '@/data/use-settings-badge';
import { useAppUpdateCheck } from '@/data/use-app-update';
import { useDataSource, useHideNsfw } from '@/data/source';
import { useHovered } from '@/hooks/use-hovered';
import { usePinnedTabBar } from '@/hooks/use-pinned-tab-bar';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';
import { APP_VERSION } from '@/lib/build-info';
import { PROFILING_ENABLED } from '@/lib/profiling';
import { hapticImpactLight } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';

/**
 * The Settings landing screen is a table of contents, nothing more: every category owns its own
 * pushed screen, where ALL of that category's management lives (installing and uninstalling bridges
 * on `/bridges`, adding and removing registries on `/registries`, and so on). It used to inline
 * every section here, which meant management was scattered — you uninstalled a bridge from inside
 * its detail page and removed a registry from a text button wedged into a row.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnReselect('settings', scrollRef);
  // Settings keeps its bottom bar: this screen IS navigation, so sliding the nav away under the
  // finger only takes away the thing you came here to tap. See `usePinnedTabBar`.
  usePinnedTabBar();
  const contentPadding = useSettingsScrollPadding();

  const counts = useCategoryCounts();
  // Same sources as the Settings tab pip — badge the exact rows that produced it so opening Settings
  // shows what surfaced the tab dot, instead of a mystery pip with no in-page counterpart. That pip
  // is `useSettingsBadgeCount` = these registry counts PLUS the in-app update check, so BOTH have to
  // be represented here: registry updates land on Bridges/Trackers, an app update on About (whose
  // pushed screen owns the "Check for updates" row).
  const updates = useRegistryUpdateCounts();
  const appUpdate = useAppUpdateCheck();
  const customPageCount = useCustomPages().length;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        // No scroll reporting and no gesture phases: the bar is pinned here, and the phase
        // broadcast is global — a blurred screen's bar would still be listening to this one's
        // scrolling.
        contentContainerStyle={[
          styles.content,
          contentPadding,
          // flexGrow: fill the viewport even when the list is short, so the space below it is still
          // draggable (see SeriesGrid's note).
          styles.fill,
        ]}>
        <View style={styles.list}>
          <CategoryRow
            testID="settings.category.general"
            icon={<GeneralSettingsIcon color={theme.textSecondary} size={22} />}
            title="General"
            onPress={() => router.push('/settings/general')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.notifications"
            icon={<NotificationsIcon color={theme.textSecondary} size={22} />}
            title="Notifications"
            onPress={() => router.push('/settings/notifications')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.bridges"
            icon={<BridgesIcon color={theme.textSecondary} size={22} />}
            title="Bridges"
            value={counts.bridges}
            updates={updates.bridges}
            onPress={() => router.push('/bridges')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.trackers"
            icon={<TrackersIcon color={theme.textSecondary} size={22} />}
            title="Trackers"
            value={counts.trackers}
            updates={updates.trackers}
            onPress={() => router.push('/trackers')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.registries"
            icon={<RegistriesIcon color={theme.textSecondary} size={22} />}
            title="Registries"
            value={counts.registries}
            onPress={() => router.push('/registries')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.custom-pages"
            icon={<CustomPagesIcon color={theme.textSecondary} size={22} />}
            title="Custom Pages"
            value={customPageCount ? String(customPageCount) : undefined}
            onPress={() => router.push('/custom-pages')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.downloads"
            icon={<DownloadsIcon color={theme.textSecondary} size={22} />}
            title="Downloads"
            value={counts.downloads}
            progress={counts.downloadsProgress}
            onPress={() => router.push('/downloads')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.storage"
            icon={<StorageIcon color={theme.textSecondary} size={22} />}
            title="Storage"
            onPress={() => router.push('/storage')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.diagnostics"
            icon={<DiagnosticsIcon color={theme.textSecondary} size={22} />}
            title="Diagnostics"
            onPress={() => router.push('/diagnostics')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.about"
            icon={<AboutIcon color={theme.textSecondary} size={22} />}
            title="About"
            // The version doubles as the row's value, so the answer to "which build am I on?" is on
            // the landing screen itself — the screen behind it is for the rest of the readout.
            value={APP_VERSION}
            // A newer build of this channel exists. Only ever 0 or 1 (there's one app, not a list of
            // them), which still goes through the counted pip rather than a bare UpdateDot: this is a
            // CATEGORY row like Bridges/Trackers, and keeping the same pill means the tab badge's
            // total is exactly the sum of the pips visible on this screen.
            updates={appUpdate.status === 'update-available' ? 1 : 0}
            onPress={() => router.push('/settings/about')}
          />
          {PROFILING_ENABLED && (
            <>
              <Divider />
              <CategoryRow
                testID="settings.category.developer"
                icon={<DeveloperIcon color={theme.textSecondary} size={22} />}
                title="Developer"
                onPress={() => router.push('/settings/developer')}
              />
            </>
          )}
        </View>
      </ScrollView>

      <TabTitleBar title="Settings" />
    </ThemedView>
  );
}

/** The trailing count on the Bridges/Trackers/Registries rows. These read the SAME query keys their
 *  screens do, so the numbers are served from cache (no extra fetch) and drop immediately when
 *  something is uninstalled or removed. `undefined` while loading, or where the server has no
 *  tracker/registry support at all — the row just shows no count then, rather than a lying "0". */
function useCategoryCounts() {
  const ds = useDataSource();
  const hideNsfw = useHideNsfw();

  const { data: bridges } = useQuery({
    queryKey: queryKeys.bridgeSummaries(),
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });
  const { data: trackers } = useQuery({
    queryKey: queryKeys.trackers(),
    queryFn: ({ signal }) => ds.getTrackers(signal),
  });
  const { data: registries } = useQuery({
    queryKey: queryKeys.registries(),
    queryFn: ({ signal }) => ds.getRegistries(signal),
  });
  const { data: downloads = EMPTY_STORAGE_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    // Device-local downloads; a backend without the module yields an empty tree, not an error. Must
    // resolve to the SAME empty shape the Downloads/Storage screens fall back to (EMPTY_STORAGE_USAGE),
    // not null/undefined — they share this cache entry, and a null cached here crashes whichever of
    // those screens reads it next (its own `= EMPTY_STORAGE_USAGE` default only guards `undefined`).
    queryFn: () => dlStorageUsage().catch(() => EMPTY_STORAGE_USAGE),
  });
  // Manifest-driven (the engine patches this query per page — see engine.ts), so the row's radial
  // advances through the reliable useQuery subscription without the live-overlay re-render gap.
  const downloadsOverall = overallProgress(downloads.bySeries);

  // Matches the filter the Bridges screen applies, so the count can't disagree with the list.
  const visibleBridges = bridges && hideNsfw ? bridges.filter((b) => !b.info.nsfw) : bridges;

  return {
    bridges: visibleBridges ? String(visibleBridges.length) : undefined,
    trackers: trackers ? String(trackers.length) : undefined,
    registries: registries ? String(registries.length) : undefined,
    downloads: downloads.seriesCount > 0 ? String(downloads.seriesCount) : undefined,
    // Cumulative progress across all series, shown as a small radial while anything is downloading.
    downloadsProgress: downloadsOverall.inProgress ? downloadsOverall.fraction : undefined,
  };
}

/** A top-level Settings entry: leading glyph, title, an optional count, and a chevron. The titles
 *  alone carry the table of contents — the per-category explanation lives on the pushed screen. */
function CategoryRow({
  icon,
  title,
  value,
  updates,
  progress,
  onPress,
  testID,
}: {
  icon: ReactNode;
  title: string;
  value?: string;
  /** Updates available for this category — registry updates on Bridges/Trackers, a pending app
   *  update on About. Renders the same accent pip as the tab badge. */
  updates?: number;
  /** Cumulative download progress [0,1] — renders a small radial before the chevron while in flight. */
  progress?: number;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        hapticImpactLight();
        onPress();
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {({ pressed }) => (
        <View
          style={[
            settingsRowFrame.row,
            settingsRowFrame.escape,
            styles.row,
            (pressed || hovered) && Platform.OS !== 'android' && { backgroundColor: theme.backgroundSelected },
          ]}>
          <View style={styles.icon}>
            {icon}
            {/* The registry-update pip sits on the row's icon exactly the way the tab pip sits on the
                tab icon — same glyph-corner placement, so the two read as the same signal. */}
            {updates !== undefined && updates > 0 && (
              <View style={styles.iconPip} pointerEvents="none">
                <UpdatePip count={updates} />
              </View>
            )}
          </View>
          <View style={settingsRowFrame.text}>
            <ThemedText type="small" numberOfLines={1}>
              {title}
            </ThemedText>
          </View>
          {value !== undefined && (
            <ThemedText type="small" themeColor="textSecondary">
              {value}
            </ThemedText>
          )}
          {progress !== undefined && <CumulativeDownloadRadial fraction={progress} size={20} strokeWidth={2.5} />}
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        </View>
      )}
    </Pressable>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.hairline }]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    // Horizontal padding comes from `useSettingsScrollPadding` — see `SettingsGutter`.
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  fill: {
    flexGrow: 1,
  },
  list: {
    width: '100%',
  },
  // Only what a category row adds ON TOP of `settingsRowFrame.row` (which it spreads): a pointer
  // cursor, and no `justifyContent` — its icon/text/count/chevron lay out left to right rather than
  // pushing a single control to the far end.
  row: {
    justifyContent: 'flex-start',
    cursor: 'pointer',
  },
  icon: {
    width: 24,
    alignItems: 'center',
  },
  // Hugs the top-right corner of the 24-wide icon box so the pip overlaps the glyph like the tab pip.
  iconPip: {
    position: 'absolute',
    top: -6,
    right: -4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    // Starts under the row's icon, runs off the right edge.
    marginRight: -SettingsGutter,
  },
});
