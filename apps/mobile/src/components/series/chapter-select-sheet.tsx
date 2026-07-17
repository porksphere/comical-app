/**
 * The multi-select chapter picker — the download sheet's "Select chapters…" and the first consumer
 * of the `components/multi-select` kit. A recycled `LegendList` of every logical chapter in
 * ascending reading order: tap toggles, long-press range-fills from the last tap (the "tap 30,
 * long-press 50" span gesture), already-settled chapters render checked-and-dimmed with their
 * download glyph and stay out of the count. The CTA fires the standard per-chapter enqueue loop.
 *
 * Recycling discipline (see docs/download-selection-plan.md §3): rows carry NO local selection
 * state, row objects keep a stable identity until their own fields change (so one toggle re-renders
 * one row), items are never null, and every row is one fixed unit tall.
 */
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { DownloadStateVisual } from '@/components/downloads/download-status-indicator';
import { SelectBar } from '@/components/multi-select/select-bar';
import { SelectableRow } from '@/components/multi-select/selectable-row';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { MeasuredHeader, OverlayHeading, useOverlay, useOverlayPresentation } from '@/components/overlay/overlay';
import { ActionButton } from '@/components/series/action-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dlGetSeries } from '@/data/api';
import { enqueueChapters } from '@/data/downloads/engine';
import { selectableGroups, toEnqueue } from '@/data/downloads/select';
import { relativeTime } from '@/data/mock';
import { queryKeys } from '@/data/queries';
import type { Chapter } from '@/data/types';
import { hapticSelection } from '@/lib/haptics';
import { usePreferredGroup } from '@/lib/preferred-group';
import { testId } from '@/lib/test-id';
import type { DownloadedChapter, DownloadState } from '@comical/downloads';

/** One list unit: the row's fixed height plus the gap below it (LegendList sizes on this). */
const ROW_UNIT = 46;

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
function settledGlyph(versionIds: string[], manifest: DownloadedChapter[]): { state: DownloadState; fraction: number } | undefined {
  const rank: Record<DownloadState, number> = { complete: 4, downloading: 3, queued: 2, paused: 1, failed: 0 };
  let best: DownloadedChapter | undefined;
  for (const d of manifest) {
    if (versionIds.includes(d.chapterId) && (!best || rank[d.state] > rank[best.state])) best = d;
  }
  if (!best) return undefined;
  return { state: best.state, fraction: best.pageCount > 0 ? best.completedPages / best.pageCount : 0 };
}

export function ChapterSelectSheet({
  bridgeId,
  seriesId,
  title,
  cover,
  author,
  chapters,
}: {
  bridgeId: string;
  seriesId: string;
  title: string;
  cover?: string;
  author?: string;
  chapters: Chapter[];
}) {
  const { closeTop } = useOverlay();
  const { height: winHeight } = useWindowDimensions();
  const preferredGroup = usePreferredGroup();

  const { data: dlData } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });
  const manifest = useMemo(() => dlData?.chapters ?? [], [dlData]);
  const sel = useMemo(() => selectableGroups(chapters, manifest), [chapters, manifest]);
  const selectableKeys = useMemo(() => sel.filter((s) => !s.settled).map((s) => s.group.key), [sel]);
  const ms = useMultiSelect(selectableKeys);

  // Row objects rebuild when the selection set changes. No identity cache here (unlike the
  // downloads screen's ticking-progress list): only the windowed handful of rows re-render on a
  // toggle, and a ref-based cache would read refs during render.
  const rows: PickRow[] = useMemo(
    () =>
      sel.map((s) => {
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

  const download = () => {
    const picked = sel.filter((s) => !s.settled && ms.isSelected(s.group.key)).map((s) => s.group);
    if (picked.length === 0) return;
    enqueueChapters(
      { bridgeId, seriesId, title, ...(cover && { thumbnailUrl: cover }), ...(author && { author }) },
      toEnqueue(picked, preferredGroup),
    );
    closeTop();
  };

  // Explicit height: LegendList needs a definite box (a maxHeight-capped ancestor resolves to ~0 on
  // native — the same Yoga wrinkle OptionList documents), sized to content up to ~55% of the window
  // as a sheet, tighter as the desktop popover (whose room is anchor-clamped).
  const popover = useOverlayPresentation() === 'popover';
  const cap = popover ? 320 : Math.max(Math.round(winHeight * 0.55), 240);
  const listHeight = Math.min(cap, rows.length * ROW_UNIT + Spacing.two);

  const renderItem = ({ item }: { item: PickRow }) => (
    <View style={styles.rowWrap}>
      <SelectableRow
        testID={testId('series.pick', item.key)}
        selected={item.selected}
        done={item.done}
        onToggle={() => ms.toggle(item.key)}
        onRangeFill={() => {
          hapticSelection(); // the hold paid off — tick like every other selection
          ms.rangeFill(item.key);
        }}
        trailing={item.state ? <DownloadStateVisual state={item.state} fraction={item.fraction} size={14} strokeWidth={2} /> : undefined}>
        <View style={styles.rowInner}>
          <ThemedText type="small" numberOfLines={1} style={styles.rowName}>
            {item.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item.when}
          </ThemedText>
        </View>
      </SelectableRow>
    </View>
  );

  return (
    <View style={styles.body}>
      <MeasuredHeader>
        <OverlayHeading>Select chapters</OverlayHeading>
        <SelectBar
          count={ms.count}
          onAll={ms.selectAll}
          onInvert={ms.invert}
          onClear={ms.clear}
          testID="series.pick"
          cta={
            <ActionButton
              testID="series.pick.cta"
              variant="primary"
              label={ms.count > 0 ? `⤓  Download ${ms.count}` : '⤓  Download'}
              disabled={ms.count === 0}
              onPress={download}
            />
          }
        />
      </MeasuredHeader>
      <View style={{ height: listHeight }}>
        <LegendList
          data={rows}
          keyExtractor={(r) => r.key}
          recycleItems
          getFixedItemSize={() => ROW_UNIT}
          maintainVisibleContentPosition={{ data: false, size: false }}
          renderItem={renderItem}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  rowWrap: {
    height: ROW_UNIT,
    paddingBottom: Spacing.one,
    justifyContent: 'center',
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
});
