/**
 * The Downloads screen (a Settings sub-page): the storage bar and the SERIES list — ordered
 * queue-first then most-recent, each row showing its cover, its state and size, its progress while in
 * flight, and swipe/hover actions that match its state (Cancel an in-flight download, Resume a paused
 * one, Delete a finished one). One form like every settings screen (`settings-form.ts`): the system's
 * list on iOS, the app's rows elsewhere. Tapping a series opens its own download screen (`series-downloads.tsx`) with the chapter
 * roster — there is no inline foldout anymore. The storage bar + size accounting live on the Storage
 * screen; this page is management.
 *
 * A `focus=<bridgeId>:<seriesId>` param scrolls that series' row into view and tints it briefly —
 * how a DIRECT (chapterless) series' Download button lands here, since it has no chapter roster of
 * its own to open (see `data/downloads/nav.ts`).
 *
 * This reads the `/downloads` storage tree through `api.ts`; a backend without the module yields an
 * empty tree. Mutations (delete/cancel/resume) go to the HOST's download engine — embedded or remote
 * server — which owns the blobs and aborts in-flight work; this screen only prunes the offline index
 * and refetches. The Wi-Fi-only / background download policies live in General settings now.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openConfirm } from '@/components/confirm-popup';
import { seriesActions, seriesCan } from '@/components/downloads/row-actions';
import { SeriesStorageBar } from '@/components/downloads/series-storage-bar';
import { DOWNLOAD_STATE_ICON } from '@/components/downloads/state-icon';
import { CheckIcon, ClearIcon, PauseIcon, PlayIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useSelectMode, useSelectToggle } from '@/components/multi-select/select-mode';
import { SelectPillBar } from '@/components/multi-select/select-pill-bar';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import type { SettingsField, SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { SettingsCardInset, Spacing } from '@/constants/theme';
import { dlDeleteChapter, dlDeleteSeries, dlStorageUsage, peekResolvedAssetSource } from '@/data/api';
import { bySortValue, deriveSeriesState, EMPTY_STORAGE_USAGE, seriesFraction, seriesSortValue } from '@/data/downloads/derive';
import { kickDownloads, pauseSeries, resumeSeriesDownload, retryChapter } from '@/data/downloads/engine';
import { forgetChapter, forgetSeries } from '@/data/downloads/index-cache';
import { seriesRowKey } from '@/data/downloads/nav';
import { formatBytes } from '@/data/downloads/format';
import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { useSeriesSubPath } from '@/lib/series-nav';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';
import type { DownloadState, StorageUsageSeries } from '@comical/downloads';

function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
}

const seriesKey = (s: { bridgeId: string; seriesId: string }) => seriesRowKey(s.bridgeId, s.seriesId);

/** What a row says of its series' state ahead of its size; a finished series says nothing. */
const STATE_LABEL: Record<DownloadState, string | undefined> = {
  downloading: 'Downloading',
  queued: 'Queued',
  paused: 'Paused',
  failed: 'Failed',
  complete: undefined,
};

/** The series, queue-first then most recent. */
function ordered(bySeries: StorageUsageSeries[]): StorageUsageSeries[] {
  // Decorated once: `seriesSortValue` walks a series' chapters, so calling it per comparison
  // re-walked them O(n log n) times.
  return bySeries
    .map((s) => ({ s, sv: seriesSortValue(s.chapters) }))
    .sort((a, b) => bySortValue(a.sv, b.sv))
    .map(({ s }) => s);
}

export default function DownloadsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const contentPadding = useSettingsScrollPadding();

  const { data: usage = EMPTY_STORAGE_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    queryFn: ({ signal }) =>
      dlStorageUsage(signal).catch((e: unknown) => {
        if (signal.aborted) throw e;
        return EMPTY_STORAGE_USAGE;
      }),
  });

  // Opening this screen nudges the queue to drain — a safety net so a download that didn't resume at
  // boot (or was held back) starts moving while you're watching it, rather than sitting idle.
  useEffect(() => {
    kickDownloads();
  }, []);

  // The host's engine unlinks the blobs itself (its delete routes return `files: []`); this side
  // only drops the sync offline-index entries and refetches.
  const deleteSeries = async (s: StorageUsageSeries) => {
    await dlDeleteSeries(s.bridgeId, s.seriesId);
    forgetSeries(s.bridgeId, s.seriesId);
    refresh();
  };
  const deleteChapter = async (bridgeId: string, seriesId: string, chapterId: string) => {
    await dlDeleteChapter(bridgeId, seriesId, chapterId);
    forgetChapter(bridgeId, seriesId, chapterId);
    refresh();
  };
  // Retrying a whole series re-queues each of its failed chapters.
  const retrySeries = (s: StorageUsageSeries) => {
    for (const c of s.chapters) if (c.state === 'failed') void retryChapter(c.bridgeId, c.seriesId, c.chapterId);
  };
  // Cancel a series' in-flight downloads: stop them, then discard the incomplete chapters (their
  // partial bytes). Completed chapters are kept — so the series drops to complete-only (or is removed
  // if nothing finished), and its swipe naturally becomes Delete.
  const cancelSeriesInflight = async (s: StorageUsageSeries) => {
    await pauseSeries(s.bridgeId, s.seriesId);
    for (const c of s.chapters) {
      if (c.state !== 'complete') await deleteChapter(c.bridgeId, c.seriesId, c.chapterId);
    }
  };

  const series = useMemo(() => ordered(usage.bySeries), [usage.bySeries]);

  // Arriving from a direct series' Download button (`focus=<bridgeId>:<seriesId>`): the list brings
  // that row into view and marks it — see `data/downloads/nav.ts`.
  const focus = useLocalSearchParams<{ focus?: string }>().focus || undefined;

  // ── Multi-select mode (the shared select-mode chrome) — bulk-manage SERIES here ──
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(() => series.map(seriesKey), [series]);
  const ms = useMultiSelect(allKeys);
  const toggleSelecting = () => {
    if (selecting) ms.clear();
    mode.toggle();
  };
  const selectToggle = useSelectToggle(selecting, toggleSelecting, 'downloads.select-toggle');

  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      symbol: allSelected ? ('xmark.circle' as const) : ('checkmark.circle' as const),
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('downloads.menu', 'all'),
    },
  ];

  // Contextual bulk verbs over the selected SERIES — the SAME per-state rules as the rows' swipe
  // actions (`seriesCan`, row-actions.tsx): Delete only for settled series (complete/paused/failed),
  // Cancel for in-flight ones (discards their incomplete chapters, keeps the finished),
  // Pause/Resume for in-flight/paused.
  const picked = series.filter((s) => ms.selected.has(seriesKey(s)));
  const stateOf = (s: StorageUsageSeries) => deriveSeriesState(s.chapters);
  const toPause = picked.filter((s) => seriesCan.pause(stateOf(s)));
  const toResume = picked.filter((s) => seriesCan.resume(stateOf(s)));
  const toCancel = picked.filter((s) => seriesCan.cancel(stateOf(s)));
  const toDelete = picked.filter((s) => seriesCan.delete(stateOf(s)));
  const pauseSelected = () => {
    for (const s of toPause) void pauseSeries(s.bridgeId, s.seriesId);
  };
  const resumeSelected = () => {
    for (const s of toResume) void resumeSeriesDownload(s.bridgeId, s.seriesId);
  };
  const cancelSelected = async () => {
    for (const s of toCancel) await cancelSeriesInflight(s);
    ms.clear();
    mode.exit();
  };
  const deleteSelected = async () => {
    for (const s of toDelete) await deleteSeries(s);
    ms.clear();
    mode.exit();
  };
  const confirmDeleteSeries = (s: StorageUsageSeries) =>
    openConfirm({
      message: `"${s.title}" and its ${s.chapterCount} downloaded chapter${s.chapterCount === 1 ? '' : 's'} will be deleted from this device.`,
      confirmLabel: 'Delete Series',
      onConfirm: () => void deleteSeries(s),
    });
  const confirmDeleteSelected = () =>
    openConfirm({
      message: `${toDelete.length} series and their downloaded chapters will be deleted from this device.`,
      confirmLabel: `Delete ${toDelete.length} Series`,
      onConfirm: () => void deleteSelected(),
    });

  // `toSubPath` keeps the row push inside the series page's nested stack when this screen is
  // its /series page/downloads twin — see useSeriesSubPath.
  const toSubPath = useSeriesSubPath();
  const openSeries = (s: StorageUsageSeries) =>
    router.push({
      pathname: toSubPath('/series-downloads'),
      params: {
        bridgeId: s.bridgeId,
        id: s.seriesId,
        title: s.title,
        ...(s.thumbnailUrl ? { cover: s.thumbnailUrl } : {}),
        ...(s.author ? { author: s.author } : {}),
      },
    });

  // A series: its cover as the tile (a proxied one only once it has been resolved elsewhere — the
  // state's glyph stands in), its state and size under the title, its progress while it downloads.
  const row = (s: StorageUsageSeries): SettingsField => {
    const key = seriesKey(s);
    const state = deriveSeriesState(s.chapters);
    const chapters = `${s.chapterCount} chapter${s.chapterCount === 1 ? '' : 's'}`;
    return {
      kind: 'link',
      key,
      testID: testId('downloads.row', key),
      label: s.title,
      description: [STATE_LABEL[state], chapters, formatBytes(s.bytes)].filter(Boolean).join(' · '),
      tone: state === 'failed' ? 'danger' : undefined,
      icon: { ...DOWNLOAD_STATE_ICON[state], uri: s.thumbnailUrl ? peekResolvedAssetSource(s.thumbnailUrl) : undefined },
      progress: state === 'downloading' ? seriesFraction(s.chapters) : undefined,
      onPress: () => openSeries(s),
      actions: seriesActions(state, {
        onPause: () => void pauseSeries(s.bridgeId, s.seriesId),
        onResume: () => void resumeSeriesDownload(s.bridgeId, s.seriesId),
        onRetry: () => retrySeries(s),
        onCancel: () => void cancelSeriesInflight(s),
        onDelete: () => confirmDeleteSeries(s),
      }),
    };
  };

  // Total downloaded + a per-series colour breakdown of that space (top 10 + "Other"). Always drawn,
  // an empty track and "0 B" when nothing is downloaded, so a fresh download grows the bar in place.
  const sections: SettingsFormSection[] = [
    {
      fields: [
        {
          kind: 'custom',
          testID: 'downloads.storage',
          render: () => (
            <View style={styles.storage}>
              <SeriesStorageBar bySeries={usage.bySeries} totalBytes={usage.totalBytes} />
            </View>
          ),
        },
      ],
    },
    series.length > 0
      ? {
          fields: series.map(row),
          unbounded: true,
          selection: { selecting, progress: mode.progress, selected: ms.selected, toggle: ms.toggle, rangeFill: ms.rangeFill, selectSet: ms.selectSet },
        }
      : {
          fields: [
            {
              kind: 'note',
              testID: 'downloads.empty',
              title: 'No downloads yet',
              text: 'Open a series and tap Download to keep chapters for offline reading.',
            },
          ],
        },
  ];

  return (
    <ThemedView style={styles.container}>
      <TopBar title={selecting ? `${ms.count} selected` : 'Downloads'} actions={[selectToggle]} />
      <SettingsList sections={sections} focus={focus} />

      {/* The select-mode chrome, over the selected SERIES: staging "…" leading, the valid verbs
          trailing. */}
      {selecting && (
        <SelectPillBar
          left={contentPadding.paddingLeft}
          right={contentPadding.paddingRight}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="downloads.select-options"
          verbs={[
            ...(toPause.length > 0
              ? [{ key: 'pause', symbol: 'pause' as const, label: `Pause ${toPause.length} series`, Icon: PauseIcon, onPress: pauseSelected, testID: 'downloads.pause' }]
              : []),
            ...(toResume.length > 0
              ? [{ key: 'resume', symbol: 'play' as const, label: `Resume ${toResume.length} series`, Icon: PlayIcon, onPress: resumeSelected, testID: 'downloads.resume' }]
              : []),
            ...(toCancel.length > 0
              ? [{ key: 'cancel', symbol: 'xmark' as const, label: `Cancel ${toCancel.length} in-flight series`, Icon: ClearIcon, color: theme.danger, onPress: () => void cancelSelected(), testID: 'downloads.cancel' }]
              : []),
            ...(toDelete.length > 0
              ? [{ key: 'delete', symbol: 'trash' as const, label: `Delete ${toDelete.length} series`, Icon: TrashIcon, color: theme.danger, onPress: confirmDeleteSelected, testID: 'downloads.delete' }]
              : []),
          ]}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  storage: {
    paddingVertical: Spacing.three,
    paddingHorizontal: SettingsCardInset,
  },
});
