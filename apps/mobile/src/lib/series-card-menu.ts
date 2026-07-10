import { observable } from '@legendapp/state';

import type { SeriesEntry } from '@/data/types';

/** On-screen rect of the pressed card (window coords, from `measureInWindow`). */
export type CardRect = { x: number; y: number; width: number; height: number };

export type SeriesCardMenuRequest = {
  entry: SeriesEntry;
  bridgeId: string;
  /** The cover's real (capped) aspect ratio, so the lifted preview matches the card's shape. */
  coverAspect?: number;
  rect: CardRect;
};

/**
 * The currently-open native card context menu (the iOS/X-style hold-down), or null. In-memory local
 * UI state (Legend State, per the app's state split) — a single root-mounted host
 * (`SeriesCardContextMenuHost`) renders it, and any card opens it on long-press. Kept out of the
 * generic overlay because it's a bespoke presentation (dimmed backdrop + lifted card preview + menu),
 * not a sheet/popover.
 */
export const seriesCardMenu$ = observable<SeriesCardMenuRequest | null>(null);

export function openSeriesCardMenu(req: SeriesCardMenuRequest): void {
  seriesCardMenu$.set(req);
}

export function closeSeriesCardMenu(): void {
  seriesCardMenu$.set(null);
}
