import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { type ReactNode, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BridgesIcon,
  ChevronRightIcon,
  DeveloperIcon,
  DiagnosticsIcon,
  GeneralSettingsIcon,
  RegistriesIcon,
  TrackersIcon,
} from '@/components/icons/ui-icons';
import { TabTitleBar } from '@/components/tab-title-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SettingsGutter, SettingsTopGap } from '@/components/settings/settings-row';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useHovered } from '@/hooks/use-hovered';
import { useTopBarHeight } from '@/hooks/use-responsive';
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnReselect('settings', scrollRef);
  const { onScroll } = useHideTabBarOnScroll();
  const barHeight = useTopBarHeight();
  const headerHeight = insets.top + barHeight;

  const counts = useCategoryCounts();

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.content,
          // flexGrow: fill the viewport even when the list is short, so the space below it is still
          // draggable (see SeriesGrid's note).
          { flexGrow: 1, paddingTop: headerHeight + SettingsTopGap, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        <View style={styles.list}>
          <CategoryRow
            icon={<GeneralSettingsIcon color={theme.textSecondary} size={22} />}
            title="General"
            description="Appearance, content visibility, and where bridges run."
            onPress={() => router.push('/settings-general')}
          />
          <Divider />
          <CategoryRow
            icon={<BridgesIcon color={theme.textSecondary} size={22} />}
            title="Bridges"
            description="The sources Comical reads from. Install, configure, and remove them."
            value={counts.bridges}
            onPress={() => router.push('/bridges')}
          />
          <Divider />
          <CategoryRow
            icon={<TrackersIcon color={theme.textSecondary} size={22} />}
            title="Trackers"
            description="Sync your reading progress to an external service."
            value={counts.trackers}
            onPress={() => router.push('/trackers')}
          />
          <Divider />
          <CategoryRow
            icon={<RegistriesIcon color={theme.textSecondary} size={22} />}
            title="Registries"
            description="The catalogs bridges and trackers are installed from."
            value={counts.registries}
            onPress={() => router.push('/registries')}
          />
          <Divider />
          <CategoryRow
            icon={<DiagnosticsIcon color={theme.textSecondary} size={22} />}
            title="Diagnostics"
            description="Page and thumbnail load failures, kept on this device only."
            onPress={() => router.push('/diagnostics')}
          />
          {PROFILING_ENABLED && (
            <>
              <Divider />
              <CategoryRow
                icon={<DeveloperIcon color={theme.textSecondary} size={22} />}
                title="Developer"
                description="Mock data, the JS profiler, and the server this build talks to."
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

  // Matches the filter the Bridges screen applies, so the count can't disagree with the list.
  const visibleBridges = bridges && hideNsfw ? bridges.filter((b) => !b.info.nsfw) : bridges;

  return {
    bridges: visibleBridges ? String(visibleBridges.length) : undefined,
    trackers: trackers ? String(trackers.length) : undefined,
    registries: registries ? String(registries.length) : undefined,
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
  onPress,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
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
            styles.row,
            (pressed || hovered) && Platform.OS !== 'android' && { backgroundColor: theme.backgroundSelected },
          ]}>
          <View style={styles.icon}>{icon}</View>
          <View style={styles.rowText}>
            <ThemedText type="default">{title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {description}
            </ThemedText>
          </View>
          {value !== undefined && (
            <ThemedText type="small" themeColor="textSecondary">
              {value}
            </ThemedText>
          )}
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
    paddingHorizontal: SettingsGutter,
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  list: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56,
    paddingVertical: Spacing.two,
    // Text sits at the gutter; the background and press/hover highlight run to the screen's edge.
    // Same trick as `SettingsRow` — see `SettingsGutter`.
    paddingHorizontal: SettingsGutter,
    marginHorizontal: -SettingsGutter,
    cursor: 'pointer',
  },
  icon: {
    width: 24,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    // Starts under the row's icon, runs off the right edge.
    marginRight: -SettingsGutter,
  },
});
