import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { type ReactNode, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
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
import { settingsRowFrame } from '@/components/settings/settings-row';
import { TabTitleBar } from '@/components/tab-title-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

import { MaxTopLevelWidth, SettingsGutter } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { dlStorageUsage } from '@/data/api';
import { useCustomPages } from '@/data/custom-pages';
import { overallProgress } from '@/data/downloads/derive';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useHovered } from '@/hooks/use-hovered';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';
import { PROFILING_ENABLED } from '@/lib/profiling';
import { hapticImpactLight } from '@/lib/haptics';

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
  const { onScroll } = useHideTabBarOnScroll();
  const contentPadding = useSettingsScrollPadding();

  const counts = useCategoryCounts();
  const customPageCount = useCustomPages().length;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.content,
          contentPadding,
          // flexGrow: fill the viewport even when the list is short, so the space below it is still
          // draggable (see SeriesGrid's note).
          styles.fill,
        ]}>
        <View style={styles.list}>
          {/* Descriptions are kept short enough to land on ONE line — every settings row in the app
              is exactly `SettingsRowHeight` tall, and a description that wraps is what used to make
              these rows stand 30px taller than the ones they lead to. */}
          <CategoryRow
            testID="settings.category.general"
            icon={<GeneralSettingsIcon color={theme.textSecondary} size={22} />}
            title="General"
            description="Appearance, content, and where bridges run."
            onPress={() => router.push('/settings-general')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.notifications"
            icon={<NotificationsIcon color={theme.textSecondary} size={22} />}
            title="Notifications"
            description="New-chapter checks, alerts, and badges."
            onPress={() => router.push('/settings-notifications')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.bridges"
            icon={<BridgesIcon color={theme.textSecondary} size={22} />}
            title="Bridges"
            description="The sources Comical reads from."
            value={counts.bridges}
            onPress={() => router.push('/bridges')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.trackers"
            icon={<TrackersIcon color={theme.textSecondary} size={22} />}
            title="Trackers"
            description="Sync your progress to another service."
            value={counts.trackers}
            onPress={() => router.push('/trackers')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.registries"
            icon={<RegistriesIcon color={theme.textSecondary} size={22} />}
            title="Registries"
            description="Where bridges and trackers come from."
            value={counts.registries}
            onPress={() => router.push('/registries')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.custom-pages"
            icon={<CustomPagesIcon color={theme.textSecondary} size={22} />}
            title="Custom Pages"
            description="Compose your own Comical pages from any bridge."
            value={customPageCount ? String(customPageCount) : undefined}
            onPress={() => router.push('/custom-pages')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.downloads"
            icon={<DownloadsIcon color={theme.textSecondary} size={22} />}
            title="Downloads"
            description="Chapters kept on this device for offline reading."
            value={counts.downloads}
            progress={counts.downloadsProgress}
            onPress={() => router.push('/downloads')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.storage"
            icon={<StorageIcon color={theme.textSecondary} size={22} />}
            title="Storage"
            description="Image cache and downloaded content on this device."
            onPress={() => router.push('/storage')}
          />
          <Divider />
          <CategoryRow
            testID="settings.category.diagnostics"
            icon={<DiagnosticsIcon color={theme.textSecondary} size={22} />}
            title="Diagnostics"
            description="Page and thumbnail load failures."
            onPress={() => router.push('/diagnostics')}
          />
          {PROFILING_ENABLED && (
            <>
              <Divider />
              <CategoryRow
                testID="settings.category.developer"
                icon={<DeveloperIcon color={theme.textSecondary} size={22} />}
                title="Developer"
                description="Mock data, profiler, and server."
                onPress={() => router.push('/settings-developer')}
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
  const { data: downloads } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    // Device-local downloads; a backend without the module yields an empty tree, not an error.
    queryFn: () => dlStorageUsage().catch(() => null),
  });
  // Manifest-driven (the engine patches this query per page — see engine.ts), so the row's radial
  // advances through the reliable useQuery subscription without the live-overlay re-render gap.
  const downloadsOverall = downloads ? overallProgress(downloads.bySeries) : null;

  // Matches the filter the Bridges screen applies, so the count can't disagree with the list.
  const visibleBridges = bridges && hideNsfw ? bridges.filter((b) => !b.info.nsfw) : bridges;

  return {
    bridges: visibleBridges ? String(visibleBridges.length) : undefined,
    trackers: trackers ? String(trackers.length) : undefined,
    registries: registries ? String(registries.length) : undefined,
    downloads: downloads && downloads.seriesCount > 0 ? String(downloads.seriesCount) : undefined,
    // Cumulative progress across all series, shown as a small radial while anything is downloading.
    downloadsProgress: downloadsOverall?.inProgress ? downloadsOverall.fraction : undefined,
  };
}

/** A top-level Settings entry: leading glyph, title over a one-line explanation of what lives
 *  behind it, an optional count, and a chevron. Taller and more explanatory than a `SettingsRow` —
 *  this is a table of contents, and the description is what makes it scannable without tapping in. */
function CategoryRow({
  icon,
  title,
  description,
  value,
  progress,
  onPress,
  testID,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value?: string;
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
          <View style={styles.icon}>{icon}</View>
          <View style={settingsRowFrame.text}>
            <ThemedText type="small" numberOfLines={1}>
              {title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {description}
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
  divider: {
    height: StyleSheet.hairlineWidth,
    // Starts under the row's icon, runs off the right edge.
    marginRight: -SettingsGutter,
  },
});
