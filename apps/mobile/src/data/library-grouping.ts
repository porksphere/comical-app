import type { SeriesGridItem } from '@/components/series-grid';
import type { LibraryGridItem } from './library-card';
import { dayKey, dayLabel } from './grouped-rows';

/** The Library grid's grouping axes. Client-side sectioning applied over the server-sorted list —
 *  it composes with the sort (see `buildGroupedRows`) instead of replacing it. */
export type LibraryGrouping = 'none' | 'bridge' | 'added' | 'lastRead';

/**
 * The library's group definition for `SeriesGrid`'s grouped mode. Returns `null` for 'none' so the
 * grid takes its ordinary ungrouped path.
 *
 * Typed against `SeriesGridItem` (the grid's item) and narrowed inside: the library's cards are
 * `LibraryGridItem`s — `SeriesGridItem` plus the timestamps — but a prop of functions is
 * contravariant in its parameter, so the narrower signature couldn't be handed to the grid.
 */
export function libraryGroupOf(
  grouping: LibraryGrouping,
  /** Injected so the caller controls locale/timezone — and so tests are deterministic. */
  formatDate: (epochMs: number) => string = dayLabel,
): ((item: SeriesGridItem) => { key: string; label: string }) | null {
  if (grouping === 'none') return null;
  return (item) => {
    const e = item as LibraryGridItem;
    switch (grouping) {
      case 'bridge':
        // The display name when the bridge is installed; the raw id keeps uninstalled bridges'
        // entries grouped (and labelled recognizably) rather than lumped together.
        return { key: e.bridgeId ?? '', label: e.bridge ?? e.bridgeId ?? 'Unknown source' };
      case 'added':
        return e.addedAt !== undefined
          ? { key: dayKey(e.addedAt), label: formatDate(e.addedAt) }
          : { key: 'unknown', label: 'Earlier' };
      case 'lastRead':
        // A series never opened has no lastReadAt — a real bucket, not an error state.
        return e.lastReadAt !== undefined
          ? { key: dayKey(e.lastReadAt), label: formatDate(e.lastReadAt) }
          : { key: 'never', label: 'Not read yet' };
    }
  };
}
