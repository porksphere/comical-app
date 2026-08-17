import type { ApiCollectionPageItem } from './api';
import type { CollectedGrouping } from './collected-view';

/** A section heading between grids of tiles. */
export type CollectedHeaderRow = { type: 'header'; key: string; label: string; count: number };
/** One grid row of up to `numColumns` tiles. */
export type CollectedTileRow = { type: 'row'; key: string; items: ApiCollectionPageItem[] };
export type CollectedRow = CollectedHeaderRow | CollectedTileRow;

/**
 * Turn a server-ordered list of saved pages into the flat row array the list renders.
 *
 * Grouping is applied **over** the server's order rather than replacing it: items are bucketed in
 * order of first appearance, and each bucket keeps its incoming order. That means grouping composes
 * with any sort — group by series while sorted newest-first and you get series in the order they
 * were most recently added to, each series' pages newest-first — instead of grouping silently
 * overriding the sort the user picked.
 *
 * Rows are pre-computed rather than left to a columned list because headers and tile rows have
 * different heights, and a flat array of typed rows is what lets the list size each one without
 * measuring it.
 */
export function buildCollectedRows(
  items: ApiCollectionPageItem[],
  numColumns: number,
  grouping: CollectedGrouping,
  /** Injected so the caller controls locale/timezone — and so tests are deterministic. */
  formatDate: (epochMs: number) => string = defaultDateLabel,
): CollectedRow[] {
  if (numColumns < 1) return [];
  if (grouping === 'none') return chunk(items, numColumns, 'all');

  const buckets = new Map<string, { label: string; items: ApiCollectionPageItem[] }>();
  for (const item of items) {
    const { key, label } =
      grouping === 'series'
        ? { key: `${item.bridgeId}:${item.seriesId}`, label: item.seriesTitle }
        : { key: dayKey(item.collectedAt), label: formatDate(item.collectedAt) };
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(item);
    else buckets.set(key, { label, items: [item] });
  }

  const rows: CollectedRow[] = [];
  for (const [key, bucket] of buckets) {
    rows.push({ type: 'header', key: `h:${key}`, label: bucket.label, count: bucket.items.length });
    rows.push(...chunk(bucket.items, numColumns, key));
  }
  return rows;
}

function chunk(items: ApiCollectionPageItem[], numColumns: number, scope: string): CollectedTileRow[] {
  const rows: CollectedTileRow[] = [];
  for (let i = 0; i < items.length; i += numColumns) {
    const slice = items.slice(i, i + numColumns);
    // Keyed by the items themselves, not by index: a row whose contents changed IS a different row,
    // and reusing an index key would leave a recycled row showing the previous items.
    rows.push({ type: 'row', key: `${scope}:${slice.map((p) => p.id).join('|')}`, items: slice });
  }
  return rows;
}

/** Calendar-day bucket key. Local time deliberately — "what did I save today" is a local question. */
function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function defaultDateLabel(epochMs: number): string {
  const d = new Date(epochMs);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(epochMs) === dayKey(today.getTime())) return 'Today';
  if (dayKey(epochMs) === dayKey(yesterday.getTime())) return 'Yesterday';
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
