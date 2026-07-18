import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { libraryListsQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { LibraryList } from '@/data/types';

/**
 * The user's custom library lists collection + its CRUD mutations, keyed on `queryKeys.libraryLists`.
 * Every mutation invalidates the lists query (so the selector/pickers refresh) and — for delete,
 * which strips membership — the library grid too (`libraryList` prefix-matches every grid view).
 *
 * Shared by the Library tab's list selector, the manage-lists sheet, and the assign picker so they
 * all read/write one cache entry.
 */
export function useLibraryLists() {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const listsKey = queryKeys.libraryLists(mock);

  const { data: lists = [], isLoading, error, refetch } = useQuery(libraryListsQuery(ds, mock));

  const invalidateLists = () => queryClient.invalidateQueries({ queryKey: listsKey });
  const invalidateGrid = () => queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });

  const create = useMutation({
    mutationFn: (name: string) => ds.createList(name),
    onSuccess: invalidateLists,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => ds.renameList(id, name),
    onSuccess: invalidateLists,
  });
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => ds.reorderLists(orderedIds),
    // Optimistically reorder so the manage sheet's rows move instantly under the arrow taps.
    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: listsKey });
      const prev = queryClient.getQueryData<LibraryList[]>(listsKey);
      if (prev) {
        const byId = new Map(prev.map((l) => [l.id, l]));
        const next = orderedIds.map((id, i) => ({ ...(byId.get(id) as LibraryList), order: i }));
        queryClient.setQueryData(listsKey, next);
      }
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(listsKey, ctx.prev);
    },
    onSettled: invalidateLists,
  });
  const remove = useMutation({
    mutationFn: (id: string) => ds.deleteList(id),
    onSuccess: () => {
      invalidateLists();
      invalidateGrid();
    },
  });

  return {
    lists,
    isLoading,
    error: error as Error | null,
    refetch,
    /** Create a list, resolving to the new `LibraryList` (so a caller can select it). */
    createList: (name: string) => create.mutateAsync(name),
    renameList: (id: string, name: string) => rename.mutate({ id, name }),
    reorderLists: (orderedIds: string[]) => reorder.mutate(orderedIds),
    deleteList: (id: string) => remove.mutate(id),
  };
}
