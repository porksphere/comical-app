/**
 * The download action for a series' quick-actions menu (the long-press popover / web 3-dot menu),
 * shared by the native host and the web `SeriesActionsMenu`. The download-status query is gated on
 * `enabled` so it runs ONLY while a menu is actually open — never once per card in the grid (the whole
 * point of the lazy, open-only menu). Reports a label/active state for the row and an `onPress` that:
 *   - not downloaded → enqueues the whole series (a direct series' pages, or every chapter — fetched
 *     lazily on tap, not on open),
 *   - already downloading / downloaded → opens the Downloads screen focused on this series.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { deriveSeriesState } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { useLiveDownloadProgress } from '@/data/downloads/state';
import { dlGetSeries } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';

export interface SeriesDownloadAction {
  label: string;
  /** Downloaded or in-progress — tints the row like the other active actions. */
  active: boolean;
  /** Status still resolving. */
  loading: boolean;
  onPress: () => void;
}

export function useSeriesDownloadAction(
  bridgeId: string | undefined,
  seriesId: string,
  direct: boolean,
  snapshot: { title: string; cover?: string },
  enabled: boolean,
): SeriesDownloadAction {
  const router = useRouter();
  const ds = useDataSource();
  const live = useLiveDownloadProgress();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId ?? '', seriesId),
    queryFn: () => dlGetSeries(bridgeId ?? '', seriesId).catch(() => null),
    enabled: enabled && !!bridgeId,
  });

  const chapters = data?.chapters ?? [];
  const state = chapters.length > 0 ? deriveSeriesState(chapters, live) : undefined;
  const inProgress = state !== undefined && state !== 'complete';
  const label = inProgress ? 'Downloading' : state === 'complete' ? 'Downloaded' : 'Download';

  const onPress = () => {
    if (!bridgeId) return;
    // Already tracked → open the Downloads screen focused here to watch/manage it.
    if (state !== undefined) {
      router.push(`/downloads?focus=${encodeURIComponent(`${bridgeId}:${seriesId}`)}`);
      return;
    }
    const snap = { bridgeId, seriesId, title: snapshot.title, ...(snapshot.cover ? { thumbnailUrl: snapshot.cover } : {}) };
    if (direct) {
      void enqueueChapter({ ...snap, chapterId: seriesId, direct: true });
      return;
    }
    // Fetch the chapter list lazily (on tap, not on open) and enqueue each.
    void ds
      .getSeriesList(bridgeId, seriesId, false)
      .then((list) => {
        for (const c of list.chapters ?? []) {
          void enqueueChapter({
            ...snap,
            chapterId: c.id,
            chapterName: c.name,
            ...(c.number !== undefined && { number: c.number }),
          });
        }
      })
      .catch(() => {});
  };

  return { label, active: state !== undefined, loading: isLoading && enabled, onPress };
}
