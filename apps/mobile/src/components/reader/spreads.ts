// Two-page spreads: which pages of the reader's list share a screen.
//
// The pager's alignment rests on every item being exactly one viewport wide, so double-page reading
// doesn't size pages differently — it changes what an item IS: one spread of one or two pages.
// Everything here is pure; the readers translate between page indices (what the host speaks) and
// spread indices (what the pager scrolls) with the maps it returns.

import { containedSize, type Size } from '@/components/reader/page-geometry';
import { STRIP_ASPECT } from '@/components/reader/page-slicing';

export type { Size };

export type SpreadPage = { key: string; pageNumber: number };

export type SpreadPad = 'before' | 'after';

export interface Spread<T extends SpreadPage> {
  /** The first page's key — stable for as long as that page opens the spread, which is what the
   *  list anchors to while pairing settles around it. */
  key: string;
  /** Index of the first page in the page list. */
  first: number;
  /** One or two pages, in reading order. */
  pages: T[];
  /** A lone page that isn't wide is drawn in one half, against the spine, the way it sits in print:
   *  `before` leaves the half ahead of it in reading order blank (a cover, which opens on the far
   *  side), `after` the half behind it (a page whose partner was cut off). */
  pad?: SpreadPad;
}

export interface SpreadLayout<T extends SpreadPage> {
  spreads: Spread<T>[];
  /** Page index → spread index. */
  spreadOf: number[];
}

/** Drawn alone: a page that is wider than tall is already a spread of its own. */
export function isWidePage(size: Size | undefined): boolean {
  return !!size && size.width > size.height;
}

/** A stitched strip of panels (see `STRIP_ASPECT`): read by scrolling, so it never shares a screen
 *  — two strips side by side in a landscape frame are slivers a few panels wide — and is never
 *  pushed against a spine it doesn't have. */
export function isStripPage(size: Size | undefined): boolean {
  return !!size && size.height > size.width * STRIP_ASPECT;
}

// Halves of one printed sheet scan alike; a page whose shape differs by more than this (a credits
// page, an insert from another source) is a different sheet and doesn't pair. Mihon's tolerance.
const PAIR_ASPECT_TOLERANCE = 0.1;

/** Whether two pages are shaped alike enough to share a spread. Unknown pairs, like it's portrait. */
export function shapesPair(a: Size | undefined, b: Size | undefined): boolean {
  if (!a || !b) return true;
  return Math.abs(a.width / a.height - b.width / b.height) <= PAIR_ASPECT_TOLERANCE;
}

/**
 * Pairs pages two by two, the way print does: a chapter's first page (its cover) stands alone, as
 * does any wide page or strip, and pairing starts over after every lone page so one wide page in the
 * middle of a chapter doesn't throw the rest out of step. Two pages of different shapes don't pair
 * either (see `shapesPair`). `shift` pairs from the first page instead — for releases without a
 * cover, whose spreads otherwise land one page off. A chapter of exactly two pages pairs them
 * whatever the cover rule says: there is no spread for the cover to open, and two padded lone
 * pages is the one layout nobody wants from it. Spreads never cross into the next chapter. A page
 * whose size isn't known yet counts as portrait.
 */
export function buildSpreads<T extends SpreadPage>(
  pages: readonly T[],
  sizeOf: (page: T, index: number) => Size | undefined,
  shift: boolean,
): SpreadLayout<T> {
  const spreads: Spread<T>[] = [];
  const spreadOf: number[] = new Array(pages.length);
  let i = 0;
  while (i < pages.length) {
    const page = pages[i]!;
    const size = sizeOf(page, i);
    const next = pages[i + 1];
    const nextSize = next && sizeOf(next, i + 1);
    const wide = isWidePage(size);
    const strip = isStripPage(size);
    const pairable =
      !!next &&
      next.pageNumber !== 1 &&
      !wide &&
      !strip &&
      !isWidePage(nextSize) &&
      !isStripPage(nextSize) &&
      shapesPair(size, nextSize);
    const twoPageChapter = page.pageNumber === 1 && next?.pageNumber === 2 && (pages[i + 2]?.pageNumber ?? 1) === 1;
    const cover = page.pageNumber === 1 && !shift && !(twoPageChapter && pairable);
    const lone = cover || !pairable;
    const members = lone ? [page] : [page, next!];
    for (let k = 0; k < members.length; k++) spreadOf[i + k] = spreads.length;
    spreads.push({
      key: page.key,
      first: i,
      pages: members,
      ...(lone && !wide && !strip ? { pad: cover ? ('before' as const) : ('after' as const) } : {}),
    });
    i += members.length;
  }
  return { spreads, spreadOf };
}

/** What a spread draws across the screen's halves, in reading order: its pages, with null for the
 *  blank half of a padded one. */
export function spreadHalves<T>(spread: { pages: T[]; pad?: SpreadPad }): (T | null)[] {
  const page = spread.pages[0]!;
  if (spread.pad === 'before') return [null, page];
  if (spread.pad === 'after') return [page, null];
  return spread.pages;
}

/** One spread per page — what single-page reading is in these terms. */
export function singleSpreads<T extends SpreadPage>(pages: readonly T[]): SpreadLayout<T> {
  return {
    spreads: pages.map((page, i) => ({ key: page.key, first: i, pages: [page] })),
    spreadOf: pages.map((_, i) => i),
  };
}

/** The index of a spread's last page. */
export function lastPageOf<T extends SpreadPage>(spread: Spread<T>): number {
  return spread.first + spread.pages.length - 1;
}

/**
 * The page a spread reports as read: its FIRST, as Tachiyomi's forks, Kavita and YACReader record a
 * spread — except a chapter's final spread, which reports its last, since a chapter is finished
 * only once its last page has been reported. `pages` is the list the spread indexes into.
 */
export function reportedPage<T extends SpreadPage>(spread: Spread<T>, pages: readonly SpreadPage[]): number {
  const last = lastPageOf(spread);
  const after = pages[last + 1];
  return !after || after.pageNumber === 1 ? last : spread.first;
}

/** The counter's text for a spread on screen, 1-based and in screen order, as Tachiyomi's forks
 *  and Suwayomi print it: "3-4", or "4-3" right-to-left. */
export function spreadRangeLabel(first: number, last: number, rtl: boolean): string {
  return rtl ? `${last + 1}-${first + 1}` : `${first + 1}-${last + 1}`;
}

/**
 * Fractional spread position at the start of each page, plus one trailing entry for the end — the
 * scrubber drags a fractional PAGE index and the pager scrolls by spread, so a worklet interpolates
 * through this. A two-page spread spans two pages, so each of its pages covers half of it.
 */
export function spreadPositions<T extends SpreadPage>({ spreads }: SpreadLayout<T>): number[] {
  const at: number[] = [];
  spreads.forEach((spread, s) => {
    for (let k = 0; k < spread.pages.length; k++) at.push(s + k / spread.pages.length);
  });
  at.push(spreads.length);
  return at;
}

/** Maps a fractional page index through `spreadPositions`. Callable from a worklet. */
export function pageToSpreadPosition(positions: readonly number[], page: number): number {
  'worklet';
  const last = positions.length - 1;
  if (last <= 0) return 0;
  const p = Math.max(0, Math.min(last, page));
  const i = Math.min(last - 1, Math.floor(p));
  return positions[i]! + (positions[i + 1]! - positions[i]!) * (p - i);
}

/** Should pages pair at all: 'auto' reads double exactly when the reading frame is landscape. */
export function readsDouble(layout: 'single' | 'double' | 'auto', viewport: Size): boolean {
  return layout === 'double' || (layout === 'auto' && viewport.width > viewport.height);
}

// Page sizes seen this session, by source. A page's size is only known once it has loaded, so a
// reader opened on pages read before (a chapter reopened, the same pages under the other layout)
// pairs them right from its first frame instead of re-pairing as they arrive. Bounded; the oldest
// go first.
const SIZE_CACHE_LIMIT = 4000;
const sizeCache = new Map<string, Size>();

export function rememberPageSize(uri: string, size: Size): void {
  sizeCache.delete(uri);
  sizeCache.set(uri, size);
  if (sizeCache.size > SIZE_CACHE_LIMIT) sizeCache.delete(sizeCache.keys().next().value!);
}

export function knownPageSize(uri: string): Size | undefined {
  return sizeCache.get(uri);
}

/**
 * The picture a two-page spread draws at 1×: each page contained in its half of the viewport and
 * pushed against the spine, measured as a box twice the wider page's width so it stays centred —
 * which is what pan clamping and the rest assume of any content. Already contained, so it comes
 * back out of `pageGeometry` unscaled. Null until both pages have loaded. A padded spread's blank
 * half (`undefined`) is measured as its page's twin, so the page stays at the spine under zoom.
 */
export function spreadImage(halves: (Size | null | undefined)[], viewport: Size): Size | null {
  const known = halves.filter((h) => h !== undefined);
  const images = halves.map((h) => (h === undefined ? known[0] : h));
  if (!known.length || images.some((image) => !image)) return null;
  const half = { width: viewport.width / 2, height: viewport.height };
  const boxes = images.map((image) => containedSize(image!, half));
  return {
    width: 2 * Math.max(...boxes.map((b) => b.width)),
    height: Math.max(...boxes.map((b) => b.height)),
  };
}
