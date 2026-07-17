/**
 * The download sheet — what the series Download button (and the card menu's Download action) opens
 * instead of blindly enqueueing every chapter. Options are computed from the chapter list, read
 * flags, and the download manifest, each showing its chapter count and disabling at zero:
 * all/remaining, unread, next 10, and "Select chapters…" (the multi-select picker). Chapters can be
 * passed in (series page) or fetched lazily (card menu). See docs/download-selection-plan.md.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChapterSelectSheet } from '@/components/series/chapter-select-sheet';
import { MeasuredHeader, OptionList, OverlayHeading, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { dlGetSeries } from '@/data/api';
import { enqueueChapters } from '@/data/downloads/engine';
import { nextN, remaining, selectableGroups, toEnqueue, unread } from '@/data/downloads/select';
import { queryKeys, seriesListQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Chapter } from '@/data/types';
import { usePreferredGroup } from '@/lib/preferred-group';
import { testId } from '@/lib/test-id';
import { useTheme } from '@/hooks/use-theme';
import type { ChapterGroup } from '@/lib/chapter-order';

export function DownloadSheet({
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
  /** The series page passes its loaded list; the card menu omits it and the sheet fetches lazily. */
  chapters?: Chapter[];
}) {
  const { closeTop } = useOverlay();
  const theme = useTheme();
  const ds = useDataSource();
  const mock = useMockActive();
  const preferredGroup = usePreferredGroup();
  // "Select chapters…" swaps THIS overlay's content to the picker (same sheet/popover, same anchor)
  // rather than close-and-reopen — a same-tick overlay swap leaves the desktop popover anchorless.
  const [picking, setPicking] = useState(false);

  const { data: fetched } = useQuery(seriesListQuery(ds, mock, bridgeId, seriesId, false, !chapters));
  const list = chapters ?? fetched?.chapters;

  const { data: dlData } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });

  const sel = useMemo(() => (list ? selectableGroups(list, dlData?.chapters) : undefined), [list, dlData]);
  const anyComplete = sel?.some((s) => s.complete) ?? false;

  const run = (groups: ChapterGroup[]) => {
    enqueueChapters(
      { bridgeId, seriesId, title, ...(cover && { thumbnailUrl: cover }), ...(author && { author }) },
      toEnqueue(groups, preferredGroup),
    );
    closeTop();
  };

  const options = sel
    ? [
        { id: 'all', label: anyComplete ? 'Download remaining' : 'Download all', groups: remaining(sel) },
        { id: 'unread', label: 'Download unread', groups: unread(sel) },
        { id: 'next10', label: 'Download next 10', groups: nextN(sel, 10) },
      ]
    : [];
  const selectableCount = sel?.filter((s) => !s.settled).length ?? 0;

  if (picking && list) {
    return (
      <ChapterSelectSheet
        bridgeId={bridgeId}
        seriesId={seriesId}
        title={title}
        {...(cover !== undefined && { cover })}
        {...(author !== undefined && { author })}
        chapters={list}
      />
    );
  }

  const row = (opt: { id: string; label: string; count: number; onPress: () => void }) => (
    <Pressable
      key={opt.id}
      testID={testId('series.download.option', opt.id)}
      onPress={opt.count === 0 ? undefined : opt.onPress}
      disabled={opt.count === 0}
      style={opt.count === 0 && styles.disabled}>
      <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.hairline }]}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.rowLabel}>
          {opt.label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {opt.count === 1 ? '1 chapter' : `${opt.count} chapters`}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );

  return (
    <View style={styles.body}>
      <MeasuredHeader>
        <OverlayHeading>Download</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
        {!sel ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.loading}>
            Loading chapters…
          </ThemedText>
        ) : (
          <>
            {options.map((o) => row({ id: o.id, label: o.label, count: o.groups.length, onPress: () => run(o.groups) }))}
            {row({
              id: 'select',
              label: 'Select chapters…',
              count: selectableCount,
              onPress: () => setPicking(true),
            })}
          </>
        )}
      </OptionList>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.one,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
  },
  disabled: {
    opacity: 0.45,
  },
  loading: {
    paddingVertical: Spacing.three,
    textAlign: 'center',
  },
});
