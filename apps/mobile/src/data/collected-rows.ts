import type { ApiCollectionItem } from './api';
import type { CollectedGrouping } from './collected-view';
import { buildGroupedRows, dayKey, dayLabel, type GroupedHeaderRow, type GroupedItemsRow, type GroupedRow } from './grouped-rows';

/** A section heading between grids of tiles. */
export type CollectedHeaderRow = GroupedHeaderRow;
/** One grid row of up to `numColumns` tiles. Every item type is a tile — same 2:3 card, with a
 *  type-icon badge telling a series from a chapter from a page (see collection-icons.tsx). */
export type CollectedTileRow = GroupedItemsRow<ApiCollectionItem>;
export type CollectedRow = GroupedRow<ApiCollectionItem>;

/**
 * Turn a server-ordered list of collected items into the flat row array the list renders — the
 * collected grid's grouping definitions over the shared `buildGroupedRows` machinery (see that
 * module for the compose-with-sort semantics and the row-key discipline).
 */
export function buildCollectedRows(
  items: ApiCollectionItem[],
  numColumns: number,
  grouping: CollectedGrouping,
  /** Injected so the caller controls locale/timezone — and so tests are deterministic. */
  formatDate: (epochMs: number) => string = dayLabel,
): CollectedRow[] {
  const groupOf =
    grouping === 'none'
      ? null
      : grouping === 'series'
        ? (item: ApiCollectionItem) => ({ key: `${item.bridgeId}:${item.seriesId}`, label: item.seriesTitle })
        : (item: ApiCollectionItem) => ({ key: dayKey(item.collectedAt), label: formatDate(item.collectedAt) });
  return buildGroupedRows(items, numColumns, (item) => item.id, groupOf);
}
