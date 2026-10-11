import { useQuery } from '@tanstack/react-query';

import { collectionItemsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/** Whether any chapters / pages are saved — the Library only lists "All Chapters" and "All Pages"
 *  once there is something in them. */
export function useSavedItemKinds(): { chapter: boolean; page: boolean } {
  const ds = useDataSource();
  const mock = useMockActive();
  const chapter = useQuery({
    ...collectionItemsQuery(ds, mock, { type: 'chapter' }),
    select: (items) => (items?.length ?? 0) > 0,
  });
  const page = useQuery({
    ...collectionItemsQuery(ds, mock, { type: 'page' }),
    select: (items) => (items?.length ?? 0) > 0,
  });
  return { chapter: chapter.data ?? false, page: page.data ?? false };
}
