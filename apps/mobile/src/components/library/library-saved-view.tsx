import { useQuery } from '@tanstack/react-query';

import { CollectedItemsGrid } from '@/components/collections/collected-items-grid';
import { CollectedSortButton } from '@/components/collections/collected-sort-button';
import {
  COLLECTION_EMPTY,
  holdWithinView,
  listingStatus,
  useRefetchOnRefocus,
  type LibraryViewProps,
} from '@/components/library/library-listing';
import type { ApiCollectionItem, ApiSavedItem } from '@/data/api';
import { collectedListing, useCollectedView } from '@/data/collected-view';
import { useWarmChapterPages } from '@/data/prefetch';
import { collectionItemsQuery } from '@/data/queries';
import { ITEM_KIND_LABELS, type SavedKind } from '@/data/selected-collection';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';
import { useRouter } from '@/lib/nav';
import { encodeSeriesParam } from '@/lib/series-nav';

const NONE_SAVED: Record<SavedKind, [title: string, detail: string]> = {
  chapter: ['No saved chapters', 'Long-press a chapter on a series page and tap “Save chapter”.'],
  page: ['No saved pages', 'While reading, tap the bookmark in the top bar to save a page.'],
};

const isSaved = (item: ApiCollectionItem): item is ApiSavedItem => item.type !== 'series';
const selectSaved = (items: ApiCollectionItem[] | null) => items?.filter(isSaved) ?? null;

/**
 * A view's saved CHAPTERS or PAGES — everywhere they were saved for All, or one collection's. Both
 * open THE reader — the same series screen History rows push into, not a viewer of their own — so a
 * saved item inherits every reading surface (the reveal to details, the collapse dismissal, the
 * settings sheet, the save button) and any change there applies here.
 */
export function LibrarySavedView({ collection, kind, term, ready, chrome }: LibraryViewProps & { kind: SavedKind }) {
  const ds = useDataSource();
  const mock = useMockActive();
  const router = useRouter();
  const warmPages = useWarmChapterPages();
  const { knownById: bridgeById } = useBridgeMap();
  const [view] = useCollectedView(collection, kind);

  const query = useQuery({
    ...collectionItemsQuery(ds, mock, collectedListing(collection, kind, view, term)),
    select: selectSaved,
    ...holdWithinView(`${kind}|${collection ?? ''}`),
  });
  useRefetchOnRefocus(query.refetch);
  // The library grid's NSFW rule, applied to what was saved out of those series too.
  const visible = useVisibleByBridge(query.data ?? undefined);

  const noun = ITEM_KIND_LABELS[kind].toLowerCase();
  const header = listingStatus({
    query,
    ready,
    count: visible.length,
    failed: `Failed to load saved ${noun}`,
    unavailable: [
      'Collections aren’t available here',
      'This server has no library. Switch to the remote server, or run bridges on this device, to save pages.',
    ],
    empty: () => {
      if (term) return ['No matches', `No saved ${noun} ${collection ? 'in this collection ' : ''}match your filter.`];
      return collection ? COLLECTION_EMPTY : NONE_SAVED[kind];
    },
  });

  const onOpen = (item: ApiSavedItem) => {
    if (item.type === 'page') {
      // SEQUENCE mode: the pager runs over this view's saved pages — the same listing, so the album
      // order IS the grid order and paging past a page crosses into the next one, whatever series
      // it belongs to (see use-reader-sequence.ts).
      router.push({
        pathname: '/series',
        params: {
          seq: '1',
          seqCollection: collection ?? '',
          seqSort: view.sort,
          seqDir: view.dir,
          ...(term ? { seqQ: term } : {}),
          seqStart: item.id,
        },
      });
      return;
    }
    const direct = item.chapterId === DIRECT_CHAPTER_ID;
    router.push({
      pathname: '/series',
      params: {
        id: item.seriesId,
        title: item.seriesTitle,
        bridge: encodeSeriesParam(bridgeById.get(item.bridgeId)?.name ?? item.bridgeId),
        bridgeId: item.bridgeId,
        reader: '1',
        // A saved chapter reads normally, from its first page.
        start: '0',
        ...(direct ? { direct: '1' } : { chapterId: item.chapterId, chapterName: item.chapterName ?? '' }),
      },
    });
  };

  return (
    <CollectedItemsGrid
      {...chrome}
      items={ready ? visible : []}
      grouping={view.grouping}
      // Every axis is in the key: a sort/dir/grouping switch is a scroll-to-top moment and must
      // reset recycled rows, exactly as a search or view switch does.
      scopeKey={`collected|${term}|${collection ?? ''}|${kind}|${view.sort}|${view.dir}|${view.grouping}`}
      header={header}
      // A saved page opens in sequence mode, where the sequence IS the page list — nothing to warm,
      // and its image is the one its tile is already showing.
      onWarm={(item) => {
        if (item.type !== 'chapter') return;
        const direct = item.chapterId === DIRECT_CHAPTER_ID;
        warmPages(item.bridgeId, item.seriesId, direct ? undefined : item.chapterId);
      }}
      onOpen={onOpen}
    />
  );
}

export function LibrarySavedControls({ collection, kind }: { collection: string | null; kind: SavedKind }) {
  const [view, setView] = useCollectedView(collection, kind);
  return <CollectedSortButton value={view} onChange={setView} />;
}
