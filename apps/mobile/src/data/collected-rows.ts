import type { ApiSavedItem } from './api';
import type { CollectedGrouping } from './collected-view';
import { buildGroupedRows, dayKey, dayLabel, type GroupedHeaderRow, type GroupedItemsRow, type GroupedRow } from './grouped-rows';

/** A section heading between grids of tiles. */
export type CollectedHeaderRow = GroupedHeaderRow;
/** One grid row of up to `numColumns` tiles. */
export type CollectedTileRow = GroupedItemsRow<ApiSavedItem>;
export type CollectedRow = GroupedRow<ApiSavedItem>;

/**
 * Turn a server-ordered list of collected items into the flat row array the list renders — the
 * collected grid's grouping definitions over the shared `buildGroupedRows` machinery (see that
 * module for the compose-with-sort semantics and the row-key discipline).
 */
export function buildCollectedRows(
  items: ApiSavedItem[],
  numColumns: number,
  grouping: CollectedGrouping,
  /** Injected so the caller controls locale/timezone — and so tests are deterministic. */
  formatDate: (epochMs: number) => string = dayLabel,
): CollectedRow[] {
  const groupOf =
    grouping === 'none'
      ? null
      : grouping === 'series'
        ? (item: ApiSavedItem) => ({ key: `${item.bridgeId}:${item.seriesId}`, label: item.seriesTitle })
        : (item: ApiSavedItem) => ({ key: dayKey(item.collectedAt), label: formatDate(item.collectedAt) });
  return buildGroupedRows(items, numColumns, (item) => item.id, groupOf);
}
