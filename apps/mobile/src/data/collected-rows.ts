import type { ApiCollectionChapterItem, ApiCollectionItem, ApiCollectionPageItem, ApiCollectionSeriesItem } from './api';
import type { CollectedGrouping } from './collected-view';

/** Items that render as a 2:3 tile — a saved page, or a saved series (its cover). */
export type TileItem = ApiCollectionPageItem | ApiCollectionSeriesItem;

/** A section heading between grids of tiles. */
export type CollectedHeaderRow = { type: 'header'; key: string; label: string; count: number };
/** One grid row of up to `numColumns` tiles. */
export type CollectedTileRow = { type: 'row'; key: string; items: TileItem[] };
/** A saved CHAPTER — full width, because a chapter has no image of its own to show. */
export type CollectedChapterRow = { type: 'chapter'; key: string; item: ApiCollectionChapterItem };
export type CollectedRow = CollectedHeaderRow | CollectedTileRow | CollectedChapterRow;

const isTile = (i: ApiCollectionItem): i is TileItem => i.type === 'page' || i.type === 'series';

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
  items: ApiCollectionItem[],
  numColumns: number,
  grouping: CollectedGrouping,
  /** Injected so the caller controls locale/timezone — and so tests are deterministic. */
  formatDate: (epochMs: number) => string = defaultDateLabel,
): CollectedRow[] {
  if (numColumns < 1) return [];
  if (grouping === 'none') return chunk(items, numColumns, 'all');

  const buckets = new Map<string, { label: string; items: ApiCollectionItem[] }>();
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

/**
 * Walk the items IN ORDER, accumulating tile-able ones into grid rows and flushing that run
 * whenever a chapter appears — chapters are full-width, so they break the grid rather than sitting
 * in it.
 *
 * Order-preserving on purpose: the runtime interleaves a collection so a series leads its chapters
 * and a chapter leads its pages, and re-bucketing by type here would throw that away.
 */
function chunk(items: ApiCollectionItem[], numColumns: number, scope: string): CollectedRow[] {
  const rows: CollectedRow[] = [];
  let run: TileItem[] = [];
  const flush = () => {
    for (let i = 0; i < run.length; i += numColumns) {
      const slice = run.slice(i, i + numColumns);
      // Keyed by the items themselves, not by index: a row whose contents changed IS a different
      // row, and reusing an index key would leave a recycled row showing the previous items.
      rows.push({ type: 'row', key: `${scope}:${slice.map((p) => p.id).join('|')}`, items: slice });
    }
    run = [];
  };
  for (const item of items) {
    if (isTile(item)) {
      run.push(item);
      continue;
    }
    if (item.type === 'chapter') {
      flush();
      rows.push({ type: 'chapter', key: `${scope}:${item.id}`, item });
    }
  }
  flush();
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
