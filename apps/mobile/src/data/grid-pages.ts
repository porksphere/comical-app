import { useMemo, useRef } from 'react';
import type { InfiniteData } from '@tanstack/react-query';

import type { GridPage, SeriesEntry } from './types';

/**
 * Flatten react-query infinite pages into a single de-duplicated list, keyed by series id.
 *
 * Some bridges paginate a live-reordering feed by absolute offset (e.g. a "trending" or
 * "recently updated" list that re-ranks by recency/popularity between the serial, rate-limited
 * page fetches). A series bumped up the feed while scrolling then reappears at the top of the
 * next page, so the same `id` legitimately arrives on two adjacent pages — which
 * would collide on the grid's `keyExtractor` (id). First occurrence wins, so already-rendered
 * rows keep their position and object identity (good for LegendList recycling + scroll).
 *
 * Performance: this replaces a plain `pages.flatMap((p) => p.items)` and is strictly cheaper.
 * The seen-set and output are cached across renders keyed on the pages-array prefix, so only the
 * newly-appended page(s) are processed — each item is hashed exactly once across an entire
 * infinite scroll (flatMap re-scanned every item of every page on every append). A manual loop
 * avoids flatMap's per-page intermediate arrays, and a dup-only append returns the *same* array
 * reference so no downstream memo / list work is triggered. On a reset (pull-to-refresh / scope
 * switch / keepPreviousData swap) the pages prefix no longer matches the cache and it rebuilds.
 */
/** Incremental dedup state, carried across renders in a ref (or across calls in a test). */
export type DedupCache = { pages: readonly GridPage[]; seen: Set<string>; out: SeriesEntry[] };

/**
 * Pure core of {@link useDedupedPages} — exported for testing. Given the previous cache (or null)
 * and the current pages array, returns the next cache. `out` is the de-duplicated flat list.
 *
 * The returned `out` array preserves referential stability wherever possible: it is the exact
 * same array as `prev.out` when no new pages arrived, or when the appended page(s) contributed no
 * new unique items — so downstream memos / the list do no work in those cases.
 */
export function dedupPages(prev: DedupCache | null, pages: readonly GridPage[]): DedupCache {
  // Reuse cached work only when the new pages array extends the cached prefix (same page object
  // identities — react-query preserves already-fetched page refs on append). Otherwise (reset /
  // refetch / scope swap) start fresh.
  const canExtend =
    !!prev && prev.pages.length <= pages.length && prev.pages.every((p, i) => p === pages[i]);
  const base: DedupCache = canExtend ? prev! : { pages: [], seen: new Set<string>(), out: [] };
  const start = base.pages.length;
  if (start === pages.length) {
    // No new pages — reuse the same cache (and thus the same `out` reference).
    return canExtend ? base : { pages, seen: base.seen, out: base.out };
  }
  // Collect only the NEW unique items from the appended page(s): one manual loop, no per-page
  // intermediate arrays (unlike flatMap), each item hashed exactly once ever.
  const seen = base.seen;
  let added: SeriesEntry[] | null = null;
  for (let i = start; i < pages.length; i++) {
    for (const item of pages[i].items) {
      const key = String(item.id);
      if (seen.has(key)) continue;
      seen.add(key);
      (added ??= []).push(item);
    }
  }
  // Appended page(s) were entirely duplicates — keep the SAME `out` reference so no downstream
  // memo / list work is triggered. Otherwise one new array: a bulk pointer-copy + the new tail.
  const out = added ? base.out.concat(added) : base.out;
  return { pages, seen, out };
}

export function useDedupedPages(data: InfiniteData<GridPage> | undefined): SeriesEntry[] {
  const cache = useRef<DedupCache | null>(null);
  return useMemo(() => {
    const next = dedupPages(cache.current, data?.pages ?? []);
    cache.current = next;
    return next.out;
  }, [data]);
}
