/**
 * The series-screen "Download" action: enqueues every chapter (or the single page set of a direct
 * series) for offline reading, and reflects how much is already downloaded. Fire-and-forget — the
 * engine (`data/downloads/engine.ts`) drains the queue; this button just kicks it and reads the
 * manifest for its label.
 *
 * Downloads are device data, so it reads the `/downloads` manifest through `api.ts` (not the data
 * source). A backend without the downloads module yields `null` and the button simply reads "Download"
 * and no-ops usefully (the enqueue then fails quietly) — mirroring how the app degrades elsewhere.
 */
import { useQuery } from '@tanstack/react-query';

import { ActionButton } from '@/components/series/action-button';
import { dlGetSeries } from '@/data/api';
import { enqueueChapter } from '@/data/downloads/engine';
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
  const { data } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });

  const downloaded = data?.chapters ?? [];
  const completeCount = downloaded.filter((c) => c.state === 'complete').length;
  const pending = downloaded.some((c) => c.state !== 'complete');
  const total = direct ? 1 : (chapters?.length ?? 0);

  // A chaptered series needs its chapter list loaded before we can enqueue; a direct one doesn't.
  const ready = direct || (chapters !== undefined && chapters.length > 0);

  const label = pending
    ? '⤓  Downloading…'
    : total > 0 && completeCount >= total
      ? '✓  Downloaded'
      : completeCount > 0
        ? `⤓  ${completeCount}/${total}`
        : '⤓  Download';

  const onPress = () => {
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

  return (
    <ActionButton
      testID="series.action.download"
      label={label}
      onPress={onPress}
      disabled={!ready || pending}
    />
  );
}
