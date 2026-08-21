import { useMutation, useQueryClient } from '@tanstack/react-query';

import { openConfirm } from '@/components/confirm-popup';
import { showToast } from '@/components/toast';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/**
 * "Reset read progress" for one series — behind a confirmation, because it is the ONLY action that
 * destroys read state.
 *
 * Nothing else does any more, deliberately. Uncollecting a series keeps its progress, and so does
 * deleting a collection that takes a series with it: since the library dissolved into collections,
 * an ordinary tidying action can now remove a series, and letting that reach read state would mean
 * quietly destroying the one thing the user cannot get back. Re-collect and the reader is exactly
 * where it was.
 *
 * The flip side is that progress left behind by an uncollected series is never swept, so this has
 * to work on a series that ISN'T collected — which is why it lives on the per-series menu (reachable
 * from a Browse card) rather than on a library-only surface.
 */
export function useResetReadProgress(bridgeId: string, seriesId: string, title: string) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => ds.resetReadProgress(bridgeId, seriesId),
    onSuccess: () => showToast('Read progress reset'),
    onSettled: () => {
      // The chapter rows' read flags, the library's unread pills, and the resume point behind
      // Continue reading / History all derive from what this just cleared.
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapterProgress(mock, bridgeId, seriesId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.history(mock) });
    },
  });

  return () =>
    openConfirm({
      message: `Reading progress for “${title}” will be cleared — every chapter back to unread, and no resume point. The series itself stays where it is.`,
      confirmLabel: 'Reset Progress',
      onConfirm: () => mutation.mutate(),
    });
}
