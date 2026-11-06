import { useQuery } from '@tanstack/react-query';
import { Platform, StyleSheet } from 'react-native';

import {
  AboutIcon,
  BridgesIcon,
  CustomPagesIcon,
  DeveloperIcon,
  DiagnosticsIcon,
  DownloadsIcon,
  GeneralSettingsIcon,
  KeyboardIcon,
  NotificationsIcon,
  RegistriesIcon,
  StorageIcon,
  SyncIcon,
  TrackersIcon,
} from '@/components/icons/ui-icons';
import { fields, type SettingsFormSection, type SettingsIcon } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { NativeTabHeader } from '@/components/native-tab-header';
import { TabTitleBar } from '@/components/tab-title-bar';
import { ThemedView } from '@/components/themed-view';

import { MaxTopLevelWidth } from '@/constants/theme';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { dlStorageUsage } from '@/data/api';
import { useCustomPages } from '@/data/custom-pages';
import { EMPTY_STORAGE_USAGE, overallProgress } from '@/data/downloads/derive';
import { queryKeys } from '@/data/queries';
import { useRegistryUpdateCounts } from '@/data/use-settings-badge';
import { useAppUpdateCheck } from '@/data/use-app-update';
import { useDataSource, useHideNsfw } from '@/data/source';
import { usePinnedTabBar } from '@/hooks/use-pinned-tab-bar';
import { APP_VERSION } from '@/lib/build-info';
import { PROFILING_ENABLED } from '@/lib/profiling';
import { useRouter } from '@/lib/nav';

// The keys are only listened for on web, which is also what the desktop app runs. A phone has no
// keyboard to rebind, so the row isn't there at all rather than greyed out: nothing about the device
// could ever make it apply.
const HAS_SHORTCUTS = Platform.OS === 'web';

/** Each category's glyph, in both languages (`SettingsIcon`): the lucide icon the app's rows draw
 *  and the SF Symbol the iOS form draws, chosen to say the same thing. */
const ICONS = {
  general: { symbol: 'slider.horizontal.3', glyph: (color, size) => <GeneralSettingsIcon color={color} size={size} /> },
  notifications: { symbol: 'bell', glyph: (color, size) => <NotificationsIcon color={color} size={size} /> },
  sync: { symbol: 'macbook.and.iphone', glyph: (color, size) => <SyncIcon color={color} size={size} /> },
  keyboard: { symbol: 'keyboard', glyph: (color, size) => <KeyboardIcon color={color} size={size} /> },
  bridges: { symbol: 'puzzlepiece', glyph: (color, size) => <BridgesIcon color={color} size={size} /> },
  trackers: { symbol: 'arrow.clockwise', glyph: (color, size) => <TrackersIcon color={color} size={size} /> },
  registries: { symbol: 'cylinder', glyph: (color, size) => <RegistriesIcon color={color} size={size} /> },
  customPages: { symbol: 'square.grid.2x2', glyph: (color, size) => <CustomPagesIcon color={color} size={size} /> },
  downloads: { symbol: 'arrow.down.circle', glyph: (color, size) => <DownloadsIcon color={color} size={size} /> },
  storage: { symbol: 'externaldrive', glyph: (color, size) => <StorageIcon color={color} size={size} /> },
  diagnostics: { symbol: 'ladybug', glyph: (color, size) => <DiagnosticsIcon color={color} size={size} /> },
  about: { symbol: 'info.circle', glyph: (color, size) => <AboutIcon color={color} size={size} /> },
  developer: { symbol: 'apple.terminal', glyph: (color, size) => <DeveloperIcon color={color} size={size} /> },
} satisfies Record<string, SettingsIcon>;

/**
 * The Settings landing screen is a table of contents, nothing more: every category owns its own
 * pushed screen, where ALL of that category's management lives (installing and uninstalling bridges
 * on `/bridges`, adding and removing registries on `/registries`, and so on). It used to inline
 * every section here, which meant management was scattered — you uninstalled a bridge from inside
 * its detail page and removed a registry from a text button wedged into a row.
 *
 * The titles alone carry the table of contents — the per-category explanation lives on the pushed
 * screen. A row's trailing count reads the SAME query its screen does (`useCategoryCounts`).
 */
export default function SettingsScreen() {
  const router = useRouter();
  // Settings keeps its bottom bar: this screen IS navigation, so sliding the nav away under the
  // finger only takes away the thing you came here to tap. See `usePinnedTabBar`.
  usePinnedTabBar();

  const counts = useCategoryCounts();
  // Same sources as the Settings tab pip — badge the exact rows that produced it so opening Settings
  // shows what surfaced the tab dot, instead of a mystery pip with no in-page counterpart. That pip
  // is `useSettingsBadgeCount` = these registry counts PLUS the in-app update check, so BOTH have to
  // be represented here: registry updates land on Bridges/Trackers, an app update on About (whose
  // pushed screen owns the "Check for updates" row).
  const updates = useRegistryUpdateCounts();
  const appUpdate = useAppUpdateCheck();
  const customPageCount = useCustomPages().length;

  const sections: SettingsFormSection[] = [
    {
      fields: fields(
        { kind: 'link', testID: 'settings.category.general', icon: ICONS.general, label: 'General', onPress: () => router.push('/settings-general') },
        {
          kind: 'link',
          testID: 'settings.category.notifications',
          icon: ICONS.notifications,
          label: 'Notifications',
          onPress: () => router.push('/settings-notifications'),
        },
        { kind: 'link', testID: 'settings.category.sync', icon: ICONS.sync, label: 'Sync', onPress: () => router.push('/settings-sync') },
        HAS_SHORTCUTS && {
          kind: 'link',
          testID: 'settings.category.shortcuts',
          icon: ICONS.keyboard,
          label: 'Keyboard',
          onPress: () => router.push('/settings-shortcuts'),
        },
      ),
    },
    {
      fields: [
        {
          kind: 'link',
          testID: 'settings.category.bridges',
          icon: ICONS.bridges,
          label: 'Bridges',
          value: counts.bridges,
          badge: updates.bridges,
          onPress: () => router.push('/bridges'),
        },
        {
          kind: 'link',
          testID: 'settings.category.trackers',
          icon: ICONS.trackers,
          label: 'Trackers',
          value: counts.trackers,
          badge: updates.trackers,
          onPress: () => router.push('/trackers'),
        },
        {
          kind: 'link',
          testID: 'settings.category.registries',
          icon: ICONS.registries,
          label: 'Registries',
          value: counts.registries,
          onPress: () => router.push('/registries'),
        },
        {
          kind: 'link',
          testID: 'settings.category.custom-pages',
          icon: ICONS.customPages,
          label: 'Custom Pages',
          value: customPageCount ? String(customPageCount) : undefined,
          onPress: () => router.push('/custom-pages'),
        },
      ],
    },
    {
      fields: [
        {
          kind: 'link',
          testID: 'settings.category.downloads',
          icon: ICONS.downloads,
          label: 'Downloads',
          value: counts.downloads,
          progress: counts.downloadsProgress,
          onPress: () => router.push('/downloads'),
        },
        { kind: 'link', testID: 'settings.category.storage', icon: ICONS.storage, label: 'Storage', onPress: () => router.push('/storage') },
      ],
    },
    {
      fields: fields(
        { kind: 'link', testID: 'settings.category.diagnostics', icon: ICONS.diagnostics, label: 'Diagnostics', onPress: () => router.push('/diagnostics') },
        {
          kind: 'link',
          testID: 'settings.category.about',
          icon: ICONS.about,
          label: 'About',
          // The version doubles as the row's value, so the answer to "which build am I on?" is on
          // the landing screen itself — the screen behind it is for the rest of the readout.
          value: APP_VERSION,
          // A newer build of this channel exists. Only ever 0 or 1 (there's one app, not a list of
          // them), which still goes through the counted pip rather than a bare UpdateDot: this is a
          // CATEGORY row like Bridges/Trackers, and keeping the same pill means the tab badge's
          // total is exactly the sum of the pips visible on this screen.
          badge: appUpdate.status === 'update-available' ? 1 : 0,
          onPress: () => router.push('/settings-about'),
        },
        PROFILING_ENABLED && {
          kind: 'link',
          testID: 'settings.category.developer',
          icon: ICONS.developer,
          label: 'Developer',
          onPress: () => router.push('/settings-developer'),
        },
        // THROWAWAY: the bar slide-away test inside this tab's stack (components/bar-test).
        PROFILING_ENABLED &&
          Platform.OS === 'ios' && {
            kind: 'link',
            testID: 'settings.category.bar-test',
            icon: ICONS.developer,
            label: 'Bar test (in tab)',
            onPress: () => router.push('/bar-test'),
          },
      ),
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <SettingsList sections={sections} column={MaxTopLevelWidth} reselectRoute="settings" />
      {NATIVE_HEADER ? (
        <NativeTabHeader title="Settings" />
      ) : (
        <TabTitleBar title="Settings" />
      )}
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
    queryFn: ({ signal }) =>
      dlStorageUsage(signal).catch((e: unknown) => {
        if (signal.aborted) throw e;
        return EMPTY_STORAGE_USAGE;
      }),
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
