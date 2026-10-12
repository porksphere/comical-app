import { useQuery } from '@tanstack/react-query';

import { collectionItemsQuery } from '@/data/queries';
import type { KindsPresent } from '@/data/selected-collection';
import { useDataSource, useMockActive } from '@/data/source';

/** Which kinds a Library view holds — All (`null`) or one collection. All always offers Series,
 *  since its series view is the library grid, which has its own empty state. */
export function useSavedItemKinds(collection: string | null): KindsPresent {
  const ds = useDataSource();
  const mock = useMockActive();
  const { data } = useQuery({
    ...collectionItemsQuery(ds, mock, collection ? { collection } : {}),
    select: (items) => {
      const present = { series: collection === null, chapter: false, page: false };
      for (const item of items ?? []) present[item.type] = true;
      return present;
    },
  });
  return data ?? null;
}
