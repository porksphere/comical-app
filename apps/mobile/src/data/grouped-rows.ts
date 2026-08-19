/** A section heading between grids of items. */
export type GroupedHeaderRow = { type: 'header'; key: string; label: string; count: number };
/** One grid row of up to `numColumns` items. */
export type GroupedItemsRow<T> = { type: 'row'; key: string; items: T[] };
export type GroupedRow<T> = GroupedHeaderRow | GroupedItemsRow<T>;

/**
 * Turn an ordered list of items into the flat row array a grouped grid renders — the shared
 * machinery behind the collected grid's grouping AND the library's (see `buildCollectedRows` /
 * `libraryGroupOf` for the per-surface group definitions).
 *
 * Grouping is applied **over** the incoming order rather than replacing it: items are bucketed in
 * order of first appearance, and each bucket keeps its incoming order. That means grouping composes
 * with any sort — group by series while sorted newest-first and you get series in the order they
 * were most recently added to, each bucket's items newest-first — instead of grouping silently
 * overriding the sort the user picked.
 *
 * Rows are pre-computed rather than left to a columned list because headers and item rows have
 * different heights, and a flat array of typed rows is what lets the list size each one without
 * measuring it.
 */
export function buildGroupedRows<T>(
  items: T[],
  numColumns: number,
  /** The item's stable identity — row keys derive from it (see `chunk`). */
  keyOf: (item: T) => string,
  /** Which bucket an item belongs to, or `null` for no grouping (one plain chunked grid). */
  groupOf: ((item: T) => { key: string; label: string }) | null,
): GroupedRow<T>[] {
  if (numColumns < 1) return [];
  if (!groupOf) return chunk(items, numColumns, 'all', keyOf);

  const buckets = new Map<string, { label: string; items: T[] }>();
  for (const item of items) {
    const { key, label } = groupOf(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(item);
    else buckets.set(key, { label, items: [item] });
  }

  const rows: GroupedRow<T>[] = [];
  for (const [key, bucket] of buckets) {
    rows.push({ type: 'header', key: `h:${key}`, label: bucket.label, count: bucket.items.length });
    rows.push(...chunk(bucket.items, numColumns, key, keyOf));
  }
  return rows;
}

/** Chunk in incoming order. */
function chunk<T>(items: T[], numColumns: number, scope: string, keyOf: (item: T) => string): GroupedItemsRow<T>[] {
  const rows: GroupedItemsRow<T>[] = [];
  for (let i = 0; i < items.length; i += numColumns) {
    const slice = items.slice(i, i + numColumns);
    // Keyed by the items themselves, not by index: a row whose contents changed IS a different
    // row, and reusing an index key would leave a recycled row showing the previous items.
    rows.push({ type: 'row', key: `${scope}:${slice.map(keyOf).join('|')}`, items: slice });
  }
  return rows;
}

/** Calendar-day bucket key. Local time deliberately — "what did I save today" is a local question. */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "12 March" (year added when it isn't this year). */
export function dayLabel(epochMs: number): string {
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
