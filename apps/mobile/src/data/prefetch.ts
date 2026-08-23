import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { chapterPagesQuery, directPagesQuery, seriesDetailQuery, type SeriesDetailOpts } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { warmPageImages } from '@/data/warm-pages';

/**
 * Start the destination's fetch on press-IN instead of on navigate.
 *
 * The zoom is most of a second of a cover growing over the list, and the page it grows into used to
 * begin fetching only when its route mounted — so the entire flight was dead time and the page
 * landed empty. Press-in is already where the transition measures its source rect, for the same
 * reason (see `useZoomOriginSource`); this rides along with it.
 *
 * `prefetchQuery` no-ops on data that is still fresh and swallows failures, so a warm that misses
 * costs nothing and a warm that fails leaves the screen's own query to report it. A press that turns
 * out to be the start of a scroll spends one request — the price of starting when the finger lands.
 *
 * Pass the opts the DESTINATION will pass, not merely ones that produce the same key. Only `direct`
 * is keyed, but `bridgeName` is written into the cached detail (`bridge: opts.bridgeName ?? ''`), so
 * a warm that disagrees wins the race and leaves the page showing the wrong one.
 */
export function useWarmSeriesDetail() {
  const qc = useQueryClient();
  const ds = useDataSource();
  const mock = useMockActive();
  return useCallback(
    (bridgeId: string | undefined, seriesId: string, opts: SeriesDetailOpts) => {
      if (!bridgeId || !seriesId) return;
      void qc.prefetchQuery(seriesDetailQuery(ds, mock, bridgeId, seriesId, opts));
    },
    [ds, mock, qc],
  );
}

/**
 * The pages a "carry on reading" tap opens straight into, and the image it will land on — see
 * `useWarmSeriesDetail`.
 *
 * Takes the chapter id the caller is about to put in the route params, and branches on it exactly as
 * the destination does (`override`, series/index): an id means that chapter's pages, none means the
 * series' direct page list. Re-deriving "is this direct" here instead would be a second answer to a
 * question the params have already settled, free to disagree and warm a key nothing reads.
 *
 * The URL list alone doesn't put a picture on screen, so `start` chains one more step: the page the
 * reader will open on goes through the same resolve-then-prefetch the reader's own warm-ahead uses.
 * Only that one — the rest is the warm-ahead's job once it mounts.
 */
export function useWarmChapterPages() {
  const qc = useQueryClient();
  const ds = useDataSource();
  const mock = useMockActive();
  return useCallback(
    (bridgeId: string | undefined, seriesId: string, chapterId: string | undefined, start = 0) => {
      if (!bridgeId || !seriesId) return;
      const options = chapterId
        ? chapterPagesQuery(ds, mock, bridgeId, seriesId, chapterId)
        : directPagesQuery(ds, mock, bridgeId, seriesId);
      // `fetchQuery` rather than `prefetchQuery` only to get the list back; the catch restores
      // prefetch's swallow-and-move-on, leaving the screen's own query to report a failure.
      void qc
        .fetchQuery(options)
        .then((pages) => {
          const landing = pages?.[start];
          if (landing) warmPageImages([landing]);
        })
        .catch(() => {});
    },
    [ds, mock, qc],
  );
}
