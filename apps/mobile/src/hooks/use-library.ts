import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { LibrarySnapshot } from '@/data/api';
import { inLibraryQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/**
 * Per-series library membership + optimistic toggle, shared by the Series screen and the reader's
 * settings panel so both stay in exact lockstep — same cache key, same optimistic-update /
 * rollback / Library-tab invalidation flow.
 *
 * `inLibrary` is `null` while the initial check is still loading (toggle disabled); an errored check
 * reads as `false` so the button stays usable (`isInLibrary` maps a no-library-store 404 to `false`,
 * so a genuine error is rare). `snapshot` builds the entry data written on ADD (title / thumbnail /
 * author) — passed as a thunk because those fields come from different places per caller (series
 * detail vs. reader props) and are only needed at mutate time.
 */
export function useLibrary(bridgeId: string | undefined, seriesId: string, snapshot: () => LibrarySnapshot) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const key = queryKeys.inLibrary(mock, bridgeId ?? '', seriesId);
  const { data, isError } = useQuery({ ...inLibraryQuery(ds, mock, bridgeId ?? '', seriesId), retry: false });
  const inLibrary = data ?? (isError ? false : null);

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? ds.addToLibrary(bridgeId!, seriesId, snapshot()) : ds.removeFromLibrary(bridgeId!, seriesId),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) queryClient.setQueryData(key, ctx.prev ?? false);
    },
    // The Library tab keys its grid on ['library', mock, …] — refresh it so an add/remove here shows
    // up when the user switches back to that tab.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) }),
  });

  const toggle = () => {
    if (!bridgeId || inLibrary === null) return;
    mutation.mutate(!inLibrary);
  };
  return { inLibrary, toggle };
}
