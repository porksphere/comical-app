import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import type { ApiCollectionPageItem } from '@/data/api';
import { collectionItemsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';

/** How long the album's URI resolution stays cache-only after opening — long enough to cover the
 *  zoom entrance (~400ms spring plus the settle commit), short enough to be invisible behind the
 *  page skeletons if a cold chapter is actually needed. */
const ENTRANCE_QUIET_MS = 700;

/**
 * One entry of a cross-series READER SEQUENCE — a page the reader can land on, with everything the
 * chrome needs to describe it (title, chapter) and everything a save-state toggle needs to address
 * it (the full coordinates).
 */
export type ReaderSequenceEntry = {
  /** The collected item's derived id — what `seqStart` names to pick the opening entry. */
  id: string;
  bridgeId: string;
  seriesId: string;
  chapterId: string;
  pageIndex: number;
  seriesTitle: string;
  chapterName?: string;
  pageCount?: number;
  sourceUrl?: string;
};

/** The `/series` route params that put the reader in SEQUENCE mode. Scope, not data: the entries
 *  are re-resolved from the query cache (the grid that pushed this just rendered them), never
 *  serialised through navigation. */
export type ReaderSequenceParams = {
  /** '1' = the reader pages over a collected sequence instead of a chapter. */
  seq?: string;
  seqCollection?: string;
  seqSort?: string;
  seqDir?: string;
  seqQ?: string;
  /** The collected item id to open on. */
  seqStart?: string;
};

/**
 * Resolve a reader sequence from its route params: the collection's saved PAGES, in the exact
 * order the grid showed them, plus their resolved image URIs.
 *
 * Same query key as the grid — collection, search, sort, dir — so with a warm cache this is
 * synchronous on first render; a cold deep-link fetches and the caller shows a loading state.
 * URIs resolve one request per CHAPTER (`useCollectedPageUris`), lazily; an unresolved entry's
 * uri is '' and the reader's page skeleton covers it.
 *
 * Returns `null` when the params don't describe a sequence at all.
 */
export function useReaderSequence(params: ReaderSequenceParams): {
  entries: ReaderSequenceEntry[];
  uris: string[];
  /** True once the underlying query has answered (even with zero entries). */
  resolved: boolean;
} | null {
  const ds = useDataSource();
  const mock = useMockActive();
  const active = params.seq === '1';

  const { data, isFetched } = useQuery({
    ...collectionItemsQuery(ds, mock, {
      collection: params.seqCollection ?? '',
      sort: (params.seqSort as 'added' | 'series' | 'chapter') ?? 'added',
      dir: (params.seqDir as 'asc' | 'desc') ?? 'desc',
      ...(params.seqQ ? { q: params.seqQ } : {}),
    }),
    enabled: active,
  });

  // The album is built from the collection's contents, so it needs the SAME NSFW rule the grid
  // applies — otherwise a page hidden from the collection could still be swiped into from a
  // neighbouring one.
  const visible = useVisibleByBridge(data ?? undefined);
  // Only pages are readable; series and chapter items in the collection stay grid-only.
  const filtered = useMemo(
    () => visible.filter((i): i is ApiCollectionPageItem => i.type === 'page'),
    [visible],
  );
  // LATCHED on the first resolved answer, for the album's whole life. The sequence is the mounted
  // pager's verbatim page list, and the collection query it derives from is live — un-saving the
  // page on screen (or any album page) invalidates it, and a refetched, shorter list would shift
  // every page under the reader's thumb mid-swipe. The membership change still shows everywhere it
  // should: the save button reads the indices query, and the grid rebuilds on return. Only THIS
  // open's roster is frozen — the next open resolves fresh.
  const [latched, setLatched] = useState<ApiCollectionPageItem[] | null>(null);
  if (active && isFetched && latched === null) setLatched(filtered);
  const pages = latched ?? filtered;

  // The entrance QUIET WINDOW: for the album's first beat, URIs resolve from the query cache only
  // — no fetches. The open animation scales the whole reader behind its mask, and a burst of
  // chapter-list fetches (one per album chapter) landing mid-flight re-renders the reader per
  // arrival, on the thread the animation draws on. The tapped page's chapter is cached whenever
  // the album was opened from the grid (its tile just rendered from that very list), so the
  // entrance always has its image; the remaining chapters fetch the moment the window closes. A
  // cold deep link pays the window once, against a loading state that was up anyway.
  const [quietOver, setQuietOver] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setQuietOver(true), ENTRANCE_QUIET_MS);
    return () => clearTimeout(t);
  }, [active]);
  const uriMap = useCollectedPageUris(active ? pages : [], { fetch: quietOver });

  const entries = useMemo<ReaderSequenceEntry[]>(
    () =>
      pages.map((p) => ({
        id: p.id,
        bridgeId: p.bridgeId,
        seriesId: p.seriesId,
        chapterId: p.chapterId,
        pageIndex: p.pageIndex,
        seriesTitle: p.seriesTitle,
        ...(p.chapterName !== undefined && { chapterName: p.chapterName }),
        ...(p.pageCount !== undefined && { pageCount: p.pageCount }),
        ...(p.sourceUrl !== undefined && { sourceUrl: p.sourceUrl }),
      })),
    [pages],
  );

  // `uriMap` is a fresh Map per render by design, so the array is rebuilt each render — but its
  // IDENTITY must hold while its contents do: the reader hands it to the pager as the page list,
  // and a fresh array per render would re-seed list memos on every unrelated parent render. The
  // previous array is kept in state and swapped only on a content change (the adjust-state-on-
  // render form this repo standardises on — see AGENTS.md).
  //
  // And each entry's URL is FROZEN once resolved. The chapter queries behind `uriMap` stay live
  // (the grid shares them, and the quiet window closing refetches the cold ones), and on sources
  // with SIGNED page URLs a refetch mints a DIFFERENT string for the same page. Handing the pager
  // a changed uri for a mounted page makes expo-image reload it in place — a recording shows
  // `page loaded` re-firing with no `page mount` right after the quiet window closes, which on
  // the VISIBLE page is a one-frame blank exactly as the entrance lands. The first resolved URL
  // is fresh (the grid fetched it moments ago) and lives for the open; '' still upgrades the
  // moment a cold chapter's list arrives, which is the only change a mounted page should see.
  const [stableUris, setStableUris] = useState<string[]>(() =>
    pages.map((p) => uriMap.get(p.id) || ''),
  );
  const built = pages.map((p, i) => stableUris[i] || uriMap.get(p.id) || '');
  const unchanged = stableUris.length === built.length && built.every((u, i) => u === stableUris[i]);
  if (!unchanged) setStableUris(built);

  if (!active) return null;
  return { entries, uris: unchanged ? stableUris : built, resolved: isFetched };
}
