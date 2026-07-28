/**
 * The download action for a series' quick-actions menu (the long-press popover / web 3-dot menu),
 * shared by the native host and the web `SeriesActionsMenu`. The download-status query is gated on
 * `enabled` so it runs ONLY while a menu is actually open — never once per card in the grid (the whole
 * point of the lazy, open-only menu). Reports a label/active state for the row and an `onPress` that:
 *   - not downloaded, chaptered → opens the chapter-selection screen (`/download-select`, which
 *     fetches the chapter list itself),
 *   - not downloaded, direct → enqueues the series' single page set immediately,
 *   - already downloading / downloaded → opens the Downloads screen focused on this series.
 */
import { useQuery } from '@tanstack/react-query';

import { deriveSeriesState } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { dlGetSeries } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useRouter } from '@/lib/nav';

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

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId ?? '', seriesId),
    queryFn: () => dlGetSeries(bridgeId ?? '', seriesId).catch(() => null),
    enabled: enabled && !!bridgeId,
  });

  // Manifest-driven (the events pipe patches this query per page), so the row stays in sync.
  const chapters = data?.chapters ?? [];
  const state = chapters.length > 0 ? deriveSeriesState(chapters) : undefined;
  const inProgress = state !== undefined && state !== 'complete';
  const label = inProgress ? 'Downloading' : state === 'complete' ? 'Downloaded' : 'Download';

  const onPress = () => {
    if (!bridgeId) return;
    // Already tracked → the per-series download screen, to watch/manage it.
    if (state !== undefined) {
      router.push({
        pathname: '/series-downloads',
        params: {
          bridgeId,
          id: seriesId,
          title: snapshot.title,
          all: '1',
          ...(snapshot.cover ? { cover: snapshot.cover } : {}),
        },
      });
      return;
    }
    if (direct) {
      void enqueueChapter({
        bridgeId,
        seriesId,
        chapterId: seriesId,
        direct: true,
        title: snapshot.title,
        ...(snapshot.cover ? { thumbnailUrl: snapshot.cover } : {}),
      });
      return;
    }
    // Chaptered → the per-series download screen in select mode (fetches the chapter list itself).
    router.push({
      pathname: '/series-downloads',
      params: {
        bridgeId,
        id: seriesId,
        title: snapshot.title,
        all: '1',
        select: '1',
        ...(snapshot.cover ? { cover: snapshot.cover } : {}),
      },
    });
  };

  return { label, active: state !== undefined, loading: isLoading && enabled, onPress };
}
