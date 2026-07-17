/**
 * The chapter-selection screen — what the series Download button (and the card menu's Download
 * action) opens instead of blindly enqueueing every chapter. A whole screen, not an overlay: a
 * 300-chapter list deserves full height, standard settings-row sizing, and a reachable CTA.
 *
 * Layout, top to bottom:
 *  - TopBar ("Download", back).
 *  - A FIXED selection strip: live "N selected" count on the left; "Select all" (flips to
 *    "Deselect all" once everything selectable is selected) and "Select unread" accent actions on
 *    the right. These REPLACE the old one-shot "Download all / unread / next 10" options — they
 *    only stage a selection, and the single Download button commits it, so every path reads the
 *    same way: select, then download.
 *  - The full chapter list (recycled LegendList, every logical chapter in ascending reading order,
 *    settings-standard row height with inset hairline dividers). Tap toggles; long-press
 *    range-fills from the last tap; already-settled chapters render checked-and-dimmed with their
 *    download glyph and stay out of the count.
 *  - A PINNED footer with the one primary CTA ("Download N") above the safe area — reachable while
 *    scrolled anywhere in a long list.
 *
 * Recycling discipline (docs/download-selection-plan.md §3): rows carry NO local selection state,
 * row objects keep a stable identity until their own fields change, items are never null, and every
 * row is exactly one settings-row tall (declared fixed to the list).
 */
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DownloadStateVisual } from '@/components/downloads/download-status-indicator';
import { SelectableRow } from '@/components/multi-select/selectable-row';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { ActionButton } from '@/components/series/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { MaxContentWidth, SettingsGutter, SettingsRowHeight, Spacing } from '@/constants/theme';
import { dlGetSeries } from '@/data/api';
import { enqueueChapters } from '@/data/downloads/engine';
import { selectableGroups, toEnqueue, unread } from '@/data/downloads/select';
import { relativeTime } from '@/data/mock';
import { queryKeys, seriesListQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { hapticSelection } from '@/lib/haptics';
import { usePreferredGroup } from '@/lib/preferred-group';
import { testId } from '@/lib/test-id';
import { useTheme } from '@/hooks/use-theme';
import type { DownloadedChapter, DownloadState } from '@comical/downloads';

interface PickRow {
  key: string;
  name: string;
  when: string;
  selected: boolean;
  done: boolean;
  state?: DownloadState;
  fraction: number;
}

/** The manifest state to glyph a settled row with (best across the group's versions). */
function settledGlyph(
  versionIds: string[],
  manifest: DownloadedChapter[],
): { state: DownloadState; fraction: number } | undefined {
  const rank: Record<DownloadState, number> = { complete: 4, downloading: 3, queued: 2, paused: 1, failed: 0 };
  let best: DownloadedChapter | undefined;
  for (const d of manifest) {
    if (versionIds.includes(d.chapterId) && (!best || rank[d.state] > rank[best.state])) best = d;
  }
  if (!best) return undefined;
  return { state: best.state, fraction: best.pageCount > 0 ? best.completedPages / best.pageCount : 0 };
}

export default function DownloadSelectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const { width } = useWindowDimensions();
  const ds = useDataSource();
  const mock = useMockActive();
  const preferredGroup = usePreferredGroup();

  // `bridgeId` is the machine id (same convention as series.tsx, where `bridge` is a display name).
  const { bridgeId: bridgeParam, id, title, cover, author } = useLocalSearchParams<{
    bridgeId: string;
    id: string;
    title: string;
    cover?: string;
    author?: string;
  }>();
  const bridgeId = bridgeParam ?? '';
  const seriesId = id ?? '';

  // The chapter list (a cache hit when arriving from the series page) + the download manifest.
  const { data: fetched } = useQuery(seriesListQuery(ds, mock, bridgeId, seriesId, false, !!bridgeId && !!seriesId));
  const chapters = fetched?.chapters;
  const { data: dlData } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });
  const manifest = useMemo(() => dlData?.chapters ?? [], [dlData]);

  const sel = useMemo(() => (chapters ? selectableGroups(chapters, manifest) : undefined), [chapters, manifest]);
  const selectableKeys = useMemo(() => (sel ?? []).filter((s) => !s.settled).map((s) => s.group.key), [sel]);
  const unreadKeys = useMemo(() => (sel ? unread(sel).map((g) => g.key) : []), [sel]);
  const ms = useMultiSelect(selectableKeys);

  // Row objects rebuild when the selection set changes; only the windowed handful re-render.
  const rows: PickRow[] = useMemo(
    () =>
      (sel ?? []).map((s) => {
        const glyph = s.settled ? settledGlyph(s.group.versions.map((v) => v.id), manifest) : undefined;
        const row: PickRow = {
          key: s.group.key,
          name: s.group.name,
          when: relativeTime(s.group.versions[0]?.date ?? 0),
          selected: !s.settled && ms.selected.has(s.group.key),
          done: s.settled,
          fraction: glyph?.fraction ?? 0,
        };
        if (glyph) row.state = glyph.state;
        return row;
      }),
    [sel, manifest, ms.selected],
  );

  const allSelected = selectableKeys.length > 0 && ms.count === selectableKeys.length;

  const download = () => {
    if (!sel) return;
    const picked = sel.filter((s) => !s.settled && ms.isSelected(s.group.key)).map((s) => s.group);
    if (picked.length === 0) return;
    enqueueChapters(
      { bridgeId, seriesId, title: title ?? '', ...(cover && { thumbnailUrl: cover }), ...(author && { author }) },
      toEnqueue(picked, preferredGroup),
    );
    router.back();
  };

  // Full-width scroller centered within the settings column (same treatment as the Downloads page).
  const sidePad = SettingsGutter + Math.max(0, (width - MaxContentWidth) / 2);

  const strip = (label: string, onPress: () => void, disabled: boolean, id2: string) => (
    <Pressable key={id2} testID={testId('series.pick', id2)} onPress={disabled ? undefined : onPress} hitSlop={6} disabled={disabled}>
      <ThemedText type="small" style={{ color: disabled ? theme.textSecondary : theme.accent }}>
        {label}
      </ThemedText>
    </Pressable>
  );

  const renderItem = ({ item, index }: { item: PickRow; index: number }) => (
    <View>
      <SelectableRow
        variant="list"
        testID={testId('series.pick', item.key)}
        selected={item.selected}
        done={item.done}
        onToggle={() => ms.toggle(item.key)}
        onRangeFill={() => {
          hapticSelection(); // the hold paid off — tick like every other selection
          ms.rangeFill(item.key);
        }}
        trailing={
          item.state ? <DownloadStateVisual state={item.state} fraction={item.fraction} size={14} strokeWidth={2} /> : undefined
        }>
        <View style={styles.rowInner}>
          <ThemedText type="small" numberOfLines={1} style={styles.rowName}>
            {item.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.when}
          </ThemedText>
        </View>
      </SelectableRow>
      {index < rows.length - 1 && (
        <View pointerEvents="none" style={[styles.divider, { backgroundColor: theme.hairline }]} />
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Download" />

      {/* The selection strip stays fixed while the list scrolls — it acts ON the list. The TopBar
          is an absolute overlay, so the strip (this screen's first in-flow content) pads past it. */}
      <View style={[styles.strip, { paddingTop: topBarInset + Spacing.three, paddingLeft: sidePad, paddingRight: sidePad }]}>
        <ThemedText type="smallBold" testID={testId('series.pick', 'count')}>
          {ms.count} selected
        </ThemedText>
        <View style={styles.stripActions}>
          {strip(allSelected ? 'Deselect all' : 'Select all', allSelected ? ms.clear : ms.selectAll, selectableKeys.length === 0, 'all')}
          {/* Stages exactly the unread set (a deliberate, repeatable state — not additive). */}
          {strip('Select unread', () => ms.selectOnly(unreadKeys), unreadKeys.length === 0, 'unread')}
        </View>
      </View>

      <LegendList
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.key}
        recycleItems
        estimatedItemSize={SettingsRowHeight}
        getFixedItemSize={() => SettingsRowHeight}
        maintainVisibleContentPosition={{ data: false, size: false }}
        renderItem={renderItem}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {chapters ? 'No chapters to download.' : 'Loading chapters…'}
          </ThemedText>
        }
        contentContainerStyle={{
          flexGrow: 1,
          paddingLeft: sidePad,
          paddingRight: sidePad,
          paddingBottom: Spacing.three,
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />

      {/* Pinned CTA: the ONE way anything gets enqueued from this screen. */}
      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.hairline,
            paddingLeft: sidePad,
            paddingRight: sidePad,
            paddingBottom: Math.max(insets.bottom, Spacing.three),
          },
        ]}>
        <ActionButton
          testID="series.pick.cta"
          variant="primary"
          label={ms.count > 0 ? `⤓  Download ${ms.count}` : '⤓  Download'}
          disabled={ms.count === 0}
          onPress={download}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.two,
  },
  stripActions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  list: {
    flex: 1,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    fontWeight: '600',
  },
  // The settings-standard inset divider (starts at the gutter, runs off the row's escaped right
  // edge), absolutely positioned so rows stay exactly one settings-row tall for the fixed-size list.
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: -SettingsGutter,
    height: StyleSheet.hairlineWidth,
  },
  empty: {
    paddingTop: Spacing.five,
    textAlign: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
});
