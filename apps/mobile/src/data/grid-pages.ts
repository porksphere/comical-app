import { useState } from 'react';
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
/** Incremental dedup state, carried across renders in state (or across calls in a test). */
export type DedupCache = {
  pages: readonly GridPage[];
  seen: Set<string>;
  out: SeriesEntry[];
  /**
   * Set once this cache has been EXTENDED, which is the moment its `seen` stops describing its own
   * `pages`/`out`: extending mutates the set in place (that's what keeps the whole scroll O(items)
   * rather than O(items x pages)), so afterwards it lists ids that only the successor's `out`
   * actually contains. Extending from it a second time would then find those ids already seen and
   * silently drop their items — so `canExtend` refuses, and a caller holding a superseded cache
   * rebuilds from scratch instead. Costs one O(items) rebuild in a case that shouldn't arise.
   *
   * Nothing in this app hands back a superseded cache today; it needs React to discard a render
   * after the mutation, which takes a concurrent feature (`startTransition`, `useDeferredValue`,
   * Suspense retries) and none is in use. This makes the function safe if one is ever adopted,
   * rather than leaving a silently-wrong grid waiting for it.
   */
  superseded?: boolean;
};

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
    !!prev && !prev.superseded && prev.pages.length <= pages.length && prev.pages.every((p, i) => p === pages[i]);
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
  // `seen` above is `base.seen` — the same Set object — and the loop has just added the new page's
  // ids to it. From here `base` no longer describes itself; only the cache being returned does. (A
  // no-op when `base` is the fresh object built for a from-scratch pass: nothing holds it.)
  base.superseded = true;
  return { pages, seen, out };
}

/**
 * The cache lives in state rather than a ref, and the work happens during render rather than inside a
 * `useMemo`. Both for the same reason: `useMemo` is a performance hint, not a guarantee — React is
 * free to drop a memoized value and recompute — so pairing it with a ref that the recompute has
 * already advanced made the output depend on how many times a render happened to run. Calling
 * `dedupPages` unconditionally is cheap by construction: with nothing new to fold in it returns the
 * cached object itself (see the early return above), so the common render does one array-prefix
 * comparison and hands back the very same `out` reference.
 *
 * The `setCache` therefore only fires on a genuine append or reset, and converges immediately — the
 * re-render it triggers finds `next === cache` and stops.
 *
 * Known limit, currently unreachable: `dedupPages` mutates the previous cache's `seen` set in place
 * (that's what makes it O(new items) instead of O(total)). If React ever discarded a render after
 * that mutation and re-ran it from the pre-render cache, the ids would already be marked seen and
 * their items would be dropped. Nothing in this app can trigger that today — it needs a concurrent
 * feature (`startTransition`, `useDeferredValue`, Suspense retries), and none is in use. Revisit this
 * function's mutation if one is adopted.
 */
export function useDedupedPages(data: InfiniteData<GridPage> | undefined): SeriesEntry[] {
  const [cache, setCache] = useState<DedupCache | null>(null);
  const next = dedupPages(cache, data?.pages ?? []);
  if (next !== cache) setCache(next);
  return next.out;
}
