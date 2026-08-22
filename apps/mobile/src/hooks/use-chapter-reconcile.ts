import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/**
 * Re-anchor one chapter's collected pages against the page list the reader just fetched, seeding
 * the indices query with the verified result.
 *
 * A collected page is a POSITION, and sources insert and remove pages, so `pageIndex` rots.
 * Reconcile matches stored items by content hash first, then URL, then falls back to page count —
 * repairing the ones that moved and flagging the ones it can't place as `stale` (never deleting
 * them). Stale items drop out of the returned indices, so the reader won't highlight or jump to a
 * page that isn't the one that was saved.
 *
 * This runs INSTEAD of the plain indices fetch whenever the page list is in hand: same one request
 * per chapter open, but it verifies rather than trusting. It costs no extra network — the page list
 * was already fetched to display the chapter.
 *
 * `contentHash` is deliberately absent here. It is expected to be sparse — a client fills in only
 * the pages it already holds bytes for — and hashing a whole chapter would mean downloading it just
 * to open it. Hashes ride along at collect time instead (see `usePageCollected`), and items adopt
 * the ones they're handed, so a chapter becomes more rot-proof the more of it is actually read.
 */
export function useChapterReconcile(
  bridgeId: string | undefined,
  seriesId: string | undefined,
  chapterId: string | undefined,
  pages: string[] | null | undefined,
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  // One reconcile per (chapter, page-list identity). Without this the effect would re-fire on every
  // unrelated re-render of the screen, and a reconcile is a write.
  const doneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bridgeId || !seriesId || !chapterId || !pages || pages.length === 0) return;
    const runKey = `${bridgeId}:${seriesId}:${chapterId}:${pages.length}`;
    if (doneRef.current === runKey) return;
    doneRef.current = runKey;

    let cancelled = false;
    void (async () => {
      try {
        const result = await ds.reconcileChapterPages(
          bridgeId,
          seriesId,
          chapterId,
          pages.map((url) => ({ url })),
        );
        if (cancelled) return;
        // Seed the query the heart reads, so the button is correct without a second round trip.
        queryClient.setQueryData(
          queryKeys.chapterPageIndices(mock, bridgeId, seriesId, chapterId),
          result.indices,
        );
        // A repair re-keys item ids, so any collected grid on screen is now showing stale rows.
        if (result.repaired > 0 || result.stale > 0) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.collectionItemsAll(mock) });
        }
      } catch {
        // A library-less server 404s here. The indices query is the fallback and fails soft to
        // "nothing collected", so a peripheral control never surfaces an error.
        doneRef.current = null; // let a later mount retry
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ds, mock, queryClient, bridgeId, seriesId, chapterId, pages]);
}
