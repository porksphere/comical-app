import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { collectionsQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Collection } from '@/data/types';

/**
 * The user's collections + their CRUD mutations, keyed on `queryKeys.collections`. Every mutation
 * invalidates the collections query (so the selector/pickers refresh) and — for delete, which drops
 * memberships — the library grid too (`libraryList` prefix-matches every grid view).
 *
 * Replaces `useLibraryLists`; collections took over from the library's custom lists, with identical
 * CRUD shapes. Shared by the Library tab's selector, the manage sheet, and the assign picker so they
 * all read and write one cache entry.
 *
 * Note on delete: the host also PRUNES series/chapter favorites left with zero memberships, so a
 * deleted collection can remove items from favorites listings as a side effect. Bare page favorites
 * survive — those are hearts the user set deliberately.
 */
export function useCollections() {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const collectionsKey = queryKeys.collections(mock);

  const { data: collections = [], isLoading, error, refetch } = useQuery(collectionsQuery(ds, mock));

  const invalidateCollections = () => queryClient.invalidateQueries({ queryKey: collectionsKey });
  const invalidateGrid = () => queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });

  const create = useMutation({
    mutationFn: (name: string) => ds.createCollection(name),
    onSuccess: invalidateCollections,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => ds.renameCollection(id, name),
    onSuccess: invalidateCollections,
  });
  const reorder = useMutation({
    // Always send the WHOLE ordering: an omitted collection keeps its old `order` and can tie with a
    // repositioned one (known runtime behaviour, matching the lists reorder it replaced).
    mutationFn: (orderedIds: string[]) => ds.reorderCollections(orderedIds),
    // Optimistically reorder so the manage sheet's rows move instantly under the arrow taps.
    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: collectionsKey });
      const prev = queryClient.getQueryData<Collection[]>(collectionsKey);
      if (prev) {
        const byId = new Map(prev.map((c) => [c.id, c]));
        const next = orderedIds.map((id, i) => ({ ...(byId.get(id) as Collection), order: i }));
        queryClient.setQueryData(collectionsKey, next);
      }
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(collectionsKey, ctx.prev);
    },
    onSettled: invalidateCollections,
  });
  const remove = useMutation({
    mutationFn: (id: string) => ds.deleteCollection(id),
    onSuccess: () => {
      invalidateCollections();
      invalidateGrid();
    },
  });

  return {
    collections,
    isLoading,
    error: error as Error | null,
    refetch,
    /** Create a collection, resolving to the new `Collection` (so a caller can select it). */
    createCollection: (name: string) => create.mutateAsync(name),
    renameCollection: (id: string, name: string) => rename.mutate({ id, name }),
    reorderCollections: (orderedIds: string[]) => reorder.mutate(orderedIds),
    deleteCollection: (id: string) => remove.mutate(id),
  };
}
