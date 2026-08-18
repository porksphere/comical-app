import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { ApiCollectionPageItem } from '@/data/api';
import { collectionItemsQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useCollectedPageUris } from '@/hooks/use-collected-page-uris';

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

  // Only pages are readable; series and chapter items in the collection stay grid-only.
  const pages = useMemo(
    () => (data ?? []).filter((i): i is ApiCollectionPageItem => i.type === 'page'),
    [data],
  );
  const uriMap = useCollectedPageUris(active ? pages : []);

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
  const built = pages.map((p) => uriMap.get(p.id) ?? '');
  const [stableUris, setStableUris] = useState(built);
  const unchanged = stableUris.length === built.length && built.every((u, i) => u === stableUris[i]);
  if (!unchanged) setStableUris(built);

  if (!active) return null;
  return { entries, uris: unchanged ? stableUris : built, resolved: isFetched };
}
