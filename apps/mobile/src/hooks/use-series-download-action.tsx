/**
 * The download action for a series' quick-actions menu (the long-press popover / web 3-dot menu),
 * shared by the native host and the web `SeriesActionsMenu`. The download-status query is gated on
 * `enabled` so it runs ONLY while a menu is actually open — never once per card in the grid (the whole
 * point of the lazy, open-only menu). Reports a label/active state for the row and an `onPress` that:
 *   - not downloaded, chaptered → opens the download sheet (all / unread / next 10 / select — the
 *     sheet fetches the chapter list lazily; see download-sheet.tsx),
 *   - not downloaded, direct → enqueues the series' single page set immediately,
 *   - already downloading / downloaded → opens the Downloads screen focused on this series.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useOverlay } from '@/components/overlay/overlay';
import { DownloadSheet } from '@/components/series/download-sheet';
import { deriveSeriesState } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { dlGetSeries } from '@/data/api';
import { queryKeys } from '@/data/queries';

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
  const { open } = useOverlay();

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
    // Already tracked → open the Downloads screen focused here to watch/manage it.
    if (state !== undefined) {
      router.push(`/downloads?focus=${encodeURIComponent(`${bridgeId}:${seriesId}`)}`);
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
    // Chaptered → the selection sheet (stacks over the quick-actions menu; fetches chapters itself).
    open(() => (
      <DownloadSheet
        bridgeId={bridgeId}
        seriesId={seriesId}
        title={snapshot.title}
        {...(snapshot.cover ? { cover: snapshot.cover } : {})}
      />
    ));
  };

  return { label, active: state !== undefined, loading: isLoading && enabled, onPress };
}
