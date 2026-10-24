import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ReaderPageItem } from '@/components/reader/paged-reader';
import {
  buildSpreads,
  isWidePage,
  knownPageSize,
  rememberPageSize,
  singleSpreads,
  type Size,
  type SpreadLayout,
} from '@/components/reader/spreads';

function cachedWide(pages: readonly ReaderPageItem[]): string[] {
  return pages.filter((p) => isWidePage(knownPageSize(p.uri))).map((p) => p.key);
}

/**
 * The spreads both pagers show, and the sink for the page sizes that decide them.
 *
 * Only WIDENESS moves pairing (an unknown page already counts as portrait), so that is all that is
 * held. And it is held back where acting on it would move the page being read: a page learning it
 * is wide re-pairs everything after it, so a size that arrives for a page BEHIND the spread on
 * screen waits until reading goes back to it. Applied only at or after the anchor, every change
 * leaves the anchor's spread opening on the same page — the same key — which is what the list
 * anchors to. A whole chapter joining the window can't disturb it either: spreads never cross a
 * chapter boundary.
 *
 * `double` and `shift` re-pair everything at once and aren't expected to change under a mounted
 * reader — the host remounts it on the page being read instead.
 */
export function useSpreadLayout(
  pages: readonly ReaderPageItem[],
  double: boolean,
  shift: boolean,
  anchorKey: string | null,
  initialPage: number,
): { layout: SpreadLayout<ReaderPageItem>; onPageSize: (key: string, size: Size) => void } {
  const [wide, setWide] = useState<ReadonlySet<string>>(() => new Set(cachedWide(pages)));
  const pending = useRef(new Set<string>());
  const pageIndex = useMemo(() => new Map(pages.map((p, i) => [p.key, i])), [pages]);

  // A chapter joining the window brings whatever this session already knows about its pages.
  const seen = useRef(new Set(pages.map((p) => p.key)));
  useLayoutEffect(() => {
    const fresh = pages.filter((p) => !seen.current.has(p.key));
    if (!fresh.length) return;
    for (const p of fresh) seen.current.add(p.key);
    const known = cachedWide(fresh);
    if (known.length) setWide((prev) => new Set([...prev, ...known]));
  }, [pages]);

  const layout = useMemo(
    () => (double ? buildSpreads(pages, (p) => (wide.has(p.key) ? { width: 2, height: 1 } : undefined), shift) : singleSpreads(pages)),
    [pages, double, shift, wide],
  );

  const anchorPage =
    (anchorKey != null ? pageIndex.get(anchorKey) : undefined) ??
    layout.spreads[layout.spreadOf[Math.max(0, Math.min(pages.length - 1, initialPage))] ?? 0]?.first ??
    0;

  // What reading went back to: sizes held for it can land now.
  useEffect(() => {
    const ready = [...pending.current].filter((key) => (pageIndex.get(key) ?? -1) >= anchorPage);
    if (!ready.length) return;
    for (const key of ready) pending.current.delete(key);
    setWide((prev) => new Set([...prev, ...ready]));
  }, [anchorPage, pageIndex]);

  const live = useRef({ pages, pageIndex, anchorPage, double });
  useLayoutEffect(() => {
    live.current = { pages, pageIndex, anchorPage, double };
  });
  const onPageSize = useCallback((key: string, size: Size) => {
    const { pages, pageIndex, anchorPage, double } = live.current;
    const at = pageIndex.get(key);
    if (at === undefined) return;
    rememberPageSize(pages[at]!.uri, size);
    if (!double || !isWidePage(size)) return;
    if (at >= anchorPage) setWide((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
    else pending.current.add(key);
  }, []);

  return { layout, onPageSize };
}
