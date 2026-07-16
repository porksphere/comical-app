/**
 * The series-screen "Download" action. Three modes driven by the download manifest:
 *  - nothing downloaded → "Download", enqueues every chapter (or a direct series' page set).
 *  - in progress → a progress radial + status; tapping opens the Downloads screen focused on this
 *    series (expanded + scrolled into view) so the user can watch/cancel it.
 *  - fully downloaded → "Downloaded"; tapping opens the Downloads screen focused here to manage it.
 *
 * Downloads are device data, so it reads the `/downloads` manifest through `api.ts` (not the data
 * source). A backend without the module yields `null` and it falls back to the plain "Download".
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { DownloadStateVisual } from '@/components/downloads/download-status-indicator';
import { ActionButton } from '@/components/series/action-button';
import { dlGetSeries } from '@/data/api';
import { deriveSeriesState, seriesFraction } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { useLiveDownloadProgress } from '@/data/downloads/state';
import { queryKeys } from '@/data/queries';
import type { Chapter } from '@/data/types';

export function SeriesDownloadButton({
  bridgeId,
  seriesId,
  direct,
  title,
  cover,
  author,
  chapters,
}: {
  bridgeId: string;
  seriesId: string;
  direct: boolean;
  title: string;
  cover?: string;
  author?: string;
  /** The series' chapters (undefined while the list still loads); unused for a direct series. */
  chapters?: Chapter[];
}) {
  const router = useRouter();
  const live = useLiveDownloadProgress();

  const { data } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });

  const downloaded = data?.chapters ?? [];
  const state = downloaded.length > 0 ? deriveSeriesState(downloaded) : undefined;
  const inProgress = state !== undefined && state !== 'complete';
  const isComplete = state === 'complete';
  const frac = seriesFraction(downloaded, live);

  // A chaptered series needs its chapter list loaded before we can enqueue; a direct one doesn't.
  const ready = direct || (chapters !== undefined && chapters.length > 0);

  const openDownloads = () => router.push(`/downloads?focus=${encodeURIComponent(`${bridgeId}:${seriesId}`)}`);

  const enqueueAll = () => {
    const snapshot = { bridgeId, seriesId, title, ...(cover && { thumbnailUrl: cover }), ...(author && { author }) };
    if (direct) {
      void enqueueChapter({ ...snapshot, chapterId: seriesId, direct: true });
      return;
    }
    for (const c of chapters ?? []) {
      void enqueueChapter({
        ...snapshot,
        chapterId: c.id,
        chapterName: c.name,
        ...(c.number !== undefined && { number: c.number }),
      });
    }
  };

  if (inProgress) {
    // Keep the label short — a per-chapter count overflows the button; the radial shows progress.
    const label = state === 'paused' ? 'Paused' : state === 'failed' ? 'Failed' : 'Downloading';
    return (
      <ActionButton
        testID="series.action.download"
        label={label}
        leading={<DownloadStateVisual state={state} fraction={frac} size={16} strokeWidth={2} />}
        onPress={openDownloads}
      />
    );
  }

  if (isComplete) {
    return <ActionButton testID="series.action.download" label="✓  Downloaded" onPress={openDownloads} />;
  }

  return <ActionButton testID="series.action.download" label="⤓  Download" onPress={enqueueAll} disabled={!ready} />;
}
