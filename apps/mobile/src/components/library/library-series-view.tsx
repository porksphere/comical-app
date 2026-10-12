import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { LibraryFilterButton, SHOW_LABELS } from '@/components/library-filter-button';
import { LibrarySortButton } from '@/components/library-sort-button';
import {
  COLLECTION_EMPTY,
  holdWithinView,
  listingStatus,
  orList,
  useRefetchOnRefocus,
  type LibraryViewProps,
  type ListingMessage,
} from '@/components/library/library-listing';
import { SeriesGrid } from '@/components/series-grid';
import { toLibraryCard, type LibraryGridItem } from '@/data/library-card';
import { libraryGroupOf } from '@/data/library-grouping';
import { libraryQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { ReadState } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import {
  onlyBridges,
  onlyReadStates,
  useLibraryBridges,
  useLibraryGrouping,
  useLibraryShow,
  useLibrarySort,
} from '@/hooks/use-library-sort';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';

// What an empty grid says under each "Show" choice — the filter emptied it, not the view.
const SHOW_EMPTY: Record<ReadState, (where: string) => ListingMessage> = {
  unstarted: (where) => ['Everything’s been started', `Every series ${where} has a chapter read.`],
  behind: (where) => ['You’re all caught up', `No series ${where} has unread chapters.`],
  'caught-up': (where) => ['Nothing caught up', `No series ${where} is read up to its latest chapter.`],
  finished: (where) => ['Nothing finished', `No completed series ${where} is read to the end.`],
};

/**
 * A view's SERIES — the library itself for All, or the series saved into a collection. Both are the
 * library query (a collection only narrows it), so both are the same cards with the same sort,
 * Show filter and grouping.
 */
export function LibrarySeriesView({ collection, term, ready, chrome }: LibraryViewProps) {
  const ds = useDataSource();
  const mock = useMockActive();
  const [sort] = useLibrarySort(collection);
  const [grouping] = useLibraryGrouping();
  const show = useLibraryShow();
  const bridges = useLibraryBridges();

  // Unfiltered by reading state: the server takes one state at a time, and every item carries its
  // own, so the set is applied here.
  const query = useQuery({
    ...libraryQuery(ds, mock, term, sort, collection, null),
    ...holdWithinView(`series|${collection ?? ''}`),
  });
  useRefetchOnRefocus(query.refetch);

  const { knownById: bridgeById, nameOf } = useBridgeMap();
  const visible = useVisibleByBridge(query.data ?? undefined);
  const cards = useMemo<LibraryGridItem[]>(
    () =>
      onlyReadStates(onlyBridges(visible, bridges), show).map((e) => toLibraryCard(e, bridgeById.get(e.bridgeId))),
    [visible, bridges, show, bridgeById],
  );
  const groupOf = useMemo(() => libraryGroupOf(grouping) ?? undefined, [grouping]);

  const source = bridges.length ? orList(bridges.map(nameOf)) : null;
  const where = `${source ? `from ${source} ` : ''}${collection ? 'in this collection' : 'in your library'}`;
  const header = listingStatus({
    query,
    ready,
    count: cards.length,
    failed: 'Failed to load library',
    unavailable: [
      'Library isn’t available here',
      'This server has no library. Switch to the remote server, or run bridges on this device, to keep a library.',
    ],
    empty: () => {
      if (term) return ['No matches', `No series ${where} match your filter.`];
      const states = orList(show.map((s) => `“${SHOW_LABELS[s]}”`));
      if (show.length === 1) {
        const [title, detail] = SHOW_EMPTY[show[0]](where);
        return [title, `${detail} Showing ${states}${source ? ` from ${source}` : ''} — change that from the filter menu.`];
      }
      if (show.length) return ['Nothing matches the filter', `No series ${where} is ${states} — change that from the filter menu.`];
      if (source) return [`Nothing from ${source}`, `No series ${where}. Showing only ${source} — change that from the filter menu.`];
      if (collection) return COLLECTION_EMPTY;
      return ['Your library is empty', 'Open a series and tap “＋ Library” to add it here.'];
    },
  });

  return (
    <SeriesGrid
      {...chrome}
      items={ready ? cards : []}
      scopeKey={`${term}|${sort}|${grouping}|${show.join(',')}|${bridges.join(',')}|${collection ?? ''}`}
      header={header}
      // Library cards carry an app-made sub (the bridge name), regardless of any bridge flag.
      hasSub
      // The one grid that re-sorts under an open page: closing a series moves its card to the
      // front of a last-read sort, and an unfollow closes a gap under any sort.
      animateReorder
      groupOf={groupOf}
    />
  );
}

export function LibrarySeriesControls({ collection }: { collection: string | null }) {
  const [sort, setSort] = useLibrarySort(collection);
  const [grouping, setGrouping] = useLibraryGrouping();
  // The view's own listing minus its search and Show filter, so the sources on offer are the shelf's
  // and don't shift as you type. Unfiltered, it is the very query the grid itself runs.
  const ds = useDataSource();
  const mock = useMockActive();
  const { data: present } = useQuery(libraryQuery(ds, mock, '', sort, collection, null));
  return (
    <>
      <LibraryFilterButton withShow present={present ?? undefined} />
      <LibrarySortButton value={sort} onChange={setSort} grouping={grouping} onGroupingChange={setGrouping} />
    </>
  );
}
