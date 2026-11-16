import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';

import { bumpDataEpoch } from '@/data/data-epoch';
import { useDataSource } from '@/data/source';

type PackageKind = 'bridge' | 'tracker';

const updateKey = (kind: PackageKind) => ['packageUpdate', kind] as const;

/** An update of several that some of failed; `failed` is their ids. */
export class PackageUpdateError extends Error {
  constructor(readonly failed: string[]) {
    super(`${failed.length} failed to update`);
  }
}

/**
 * Updates installed bridges/trackers by id: one, or several one after another (a select mode's
 * Update). Keyed in the mutation cache rather than held in the screen, so an update started from the
 * list still reads as in flight on its settings page (and back), and survives the screen that
 * started it unmounting.
 *
 * The broad invalidate runs INSIDE the mutation, so it stays pending until the refetched list has
 * landed — otherwise the spinner would clear onto the stale "Update available" for a frame. Several
 * refresh once, at the end: it refetches every active query, the home rails on every source among
 * them. A run where some failed refreshes too, since the rest did update.
 */
export function usePackageUpdate(kind: PackageKind) {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: updateKey(kind),
    mutationFn: async (ids: string | string[]) => {
      const failed: string[] = [];
      for (const id of typeof ids === 'string' ? [ids] : ids) {
        try {
          await (kind === 'bridge' ? ds.updateBridge(id) : ds.updateTracker(id));
        } catch (e) {
          if (typeof ids === 'string') throw e;
          failed.push(id);
        }
      }
      if (failed.length) throw new PackageUpdateError(failed);
    },
    onSettled: async (_data, error, ids) => {
      if (error && typeof ids === 'string') return;
      bumpDataEpoch();
      await queryClient.invalidateQueries();
    },
  });
}

/** Ids of the bridges/trackers with an update in flight, wherever it was started. */
export function useUpdatingIds(kind: PackageKind): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: updateKey(kind), status: 'pending' },
    select: (m) => m.state.variables as string | string[],
  });
  return new Set(ids.flat());
}
