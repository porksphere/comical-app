import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ReaderPageItem } from '@/components/reader/paged-reader';
import {
  buildSpreads,
  knownPageSize,
  rememberPageSize,
  singleSpreads,
  type Size,
  type SpreadLayout,
} from '@/components/reader/spreads';

type Sizes = ReadonlyMap<string, Size>;

// The sizes pairing may use: everything this session has seen of these pages, less those held back.
function sizesOf(pages: readonly ReaderPageItem[], held: ReadonlySet<string>): Sizes {
  const sizes = new Map<string, Size>();
  for (const p of pages) {
    const size = held.has(p.key) ? undefined : knownPageSize(p.uri);
    if (size) sizes.set(p.key, size);
  }
  return sizes;
}

function pair(pages: readonly ReaderPageItem[], sizes: Sizes, shift: boolean): SpreadLayout<ReaderPageItem> {
  return buildSpreads(pages, (p) => sizes.get(p.key), shift);
}

const shapeOf = ({ spreads }: SpreadLayout<ReaderPageItem>) =>
  spreads.map((s) => `${s.key}/${s.pages.length}/${s.pad ?? ''}`).join(',');

/**
 * The spreads both pagers show, and the sink for the page sizes that decide them.
 *
 * A size only reaches the layout when it changes it — most pages arrive the shape their neighbours
 * already assumed, and re-pairing on each would re-render every mounted cell for nothing. And it is
 * held back where acting on it would move the page being read: a page's shape decides the pairing
 * after it, so a size that arrives for a page BEHIND the spread on screen waits until reading goes
 * back to it. Applied only at or after the anchor, every change leaves the anchor's spread opening
 * on the same page — the same key — which is what the list anchors to. A whole chapter joining the
 * window can't disturb it either: spreads never cross a chapter boundary.
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
  const held = useRef(new Set<string>());
  const [sizes, setSizes] = useState<Sizes>(() => sizesOf(pages, new Set()));
  const pageIndex = useMemo(() => new Map(pages.map((p, i) => [p.key, i])), [pages]);

  // A chapter joining the window brings whatever this session already knows about its pages.
  const seen = useRef(new Set(pages.map((p) => p.key)));
  useLayoutEffect(() => {
    const fresh = pages.filter((p) => !seen.current.has(p.key));
    if (!fresh.length) return;
    for (const p of fresh) seen.current.add(p.key);
    if (fresh.some((p) => knownPageSize(p.uri))) setSizes(sizesOf(pages, held.current));
  }, [pages]);

  const layout = useMemo(
    () => (double ? pair(pages, sizes, shift) : singleSpreads(pages)),
    [pages, double, shift, sizes],
  );

  const anchorPage =
    (anchorKey != null ? pageIndex.get(anchorKey) : undefined) ??
    layout.spreads[layout.spreadOf[Math.max(0, Math.min(pages.length - 1, initialPage))] ?? 0]?.first ??
    0;

  // What reading went back to: sizes held for it can land now.
  useEffect(() => {
    const ready = [...held.current].filter((key) => (pageIndex.get(key) ?? -1) >= anchorPage);
    if (!ready.length) return;
    for (const key of ready) held.current.delete(key);
    setSizes(sizesOf(pages, held.current));
  }, [anchorPage, pageIndex, pages]);

  const live = useRef({ pages, pageIndex, anchorPage, double, shift, layout });
  useLayoutEffect(() => {
    live.current = { pages, pageIndex, anchorPage, double, shift, layout };
  });
  const onPageSize = useCallback((key: string, size: Size) => {
    const { pages, pageIndex, anchorPage, double, shift, layout } = live.current;
    const at = pageIndex.get(key);
    if (at === undefined) return;
    rememberPageSize(pages[at]!.uri, size);
    if (!double) return;
    const next = sizesOf(pages, held.current);
    if (shapeOf(pair(pages, next, shift)) === shapeOf(layout)) return;
    if (at >= anchorPage) setSizes(next);
    else held.current.add(key);
  }, []);

  return { layout, onPageSize };
}
