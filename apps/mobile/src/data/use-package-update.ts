import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';

import { bumpDataEpoch } from '@/data/data-epoch';
import { useDataSource } from '@/data/source';

type PackageKind = 'bridge' | 'tracker';

const updateKey = (kind: PackageKind) => ['packageUpdate', kind] as const;

/**
 * Updates one installed bridge/tracker by id. Keyed in the mutation cache rather than held in the
 * screen, so an update started from the list still reads as in flight on its settings page (and
 * back), and survives the screen that started it unmounting.
 *
 * The broad invalidate runs INSIDE the mutation, so it stays pending until the refetched list has
 * landed — otherwise the spinner would clear onto the stale "Update available" for a frame.
 */
export function usePackageUpdate(kind: PackageKind) {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: updateKey(kind),
    mutationFn: (id: string) => (kind === 'bridge' ? ds.updateBridge(id) : ds.updateTracker(id)),
    onSuccess: async () => {
      bumpDataEpoch();
      await queryClient.invalidateQueries();
    },
  });
}

/** Ids of the bridges/trackers with an update in flight, wherever it was started. */
export function useUpdatingIds(kind: PackageKind): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: updateKey(kind), status: 'pending' },
    select: (m) => m.state.variables as string,
  });
  return new Set(ids);
}
