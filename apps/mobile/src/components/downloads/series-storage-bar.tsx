/**
 * The Downloads page storage breakdown: the shared `StorageBreakdownBar` fed per-series segments —
 * each series a distinct colour, sized to its share. Only the largest `MAX_SERIES` get their own
 * segment/colour; everything smaller is folded into one muted "Other" segment so the bar and key
 * stay readable and compact (this sits above the download-management list, which should stay the
 * focus).
 */
import { useState } from 'react';

import { StorageBreakdownBar, STORAGE_PALETTE, type StorageSegment } from '@/components/downloads/storage-breakdown-bar';
import { useTheme } from '@/hooks/use-theme';
import type { StorageUsageSeries } from '@comical/downloads';

const skey = (s: { bridgeId: string; seriesId: string }) => `${s.bridgeId}:${s.seriesId}`;

/** How many series get their own colour/segment before the rest fold into "Other". */
const MAX_SERIES = 10;

export function SeriesStorageBar({ bySeries, totalBytes }: { bySeries: StorageUsageSeries[]; totalBytes: number }) {
  const theme = useTheme();

  const sized = bySeries.filter((s) => s.bytes > 0);
  const byKey = new Map(sized.map((s) => [skey(s), s]));
  const topKeys = [...sized].sort((a, b) => b.bytes - a.bytes).slice(0, MAX_SERIES).map(skey);
  const topSet = new Set(topKeys);

  // Keep a STABLE display order across renders: a downloading series' bytes tick every page, which — if
  // we re-sorted each render — would reshuffle the segments/labels (and reassign colours) constantly.
  // Instead hold the order fixed: retain prior positions for series still in the top set, and only
  // append a newly-promoted one. So segment WIDTHS and sizes update in place while nothing jumps around.
  //
  // The remembered order is STATE, not a ref, for the same reason as the per-item resets elsewhere
  // (AGENTS.md → "Suppressing a React Compiler rule"): the colours are assigned by POSITION in this
  // list, so if a render React discards could advance the memory without the output being kept, a
  // series could silently change colour. `order` is recomputed from `heldOrder` every render and used
  // directly, so this render already paints the right thing — the write-back only carries it forward.
  const [heldOrder, setHeldOrder] = useState<string[]>(topKeys);
  const order = heldOrder.filter((k) => topSet.has(k));
  for (const k of topKeys) if (!order.includes(k)) order.push(k);
  // Converges: the next render recomputes the same list from it, finds nothing to drop or append, and
  // this comparison is equal — so the swap of a series in or out of the top set costs one re-render.
  if (order.length !== heldOrder.length || order.some((k, i) => k !== heldOrder[i])) setHeldOrder(order);

  const segments: StorageSegment[] = order.map((k, i) => {
    const s = byKey.get(k)!;
    return { key: k, label: s.title, bytes: s.bytes, color: STORAGE_PALETTE[i % STORAGE_PALETTE.length] };
  });
  const otherKeys = sized.filter((s) => !topSet.has(skey(s)));
  if (otherKeys.length > 0) {
    const bytes = otherKeys.reduce((n, s) => n + s.bytes, 0);
    segments.push({ key: '__other', label: `Other (${otherKeys.length})`, bytes, color: theme.textSecondary });
  }

  return <StorageBreakdownBar segments={segments} totalBytes={totalBytes} />;
}
