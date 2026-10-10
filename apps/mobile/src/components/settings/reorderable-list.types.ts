import type { ReactNode } from 'react';

/**
 * Props for the reorderable list (`reorderable-list.tsx`). It reorders **in place** on every
 * platform: the live list *is* the drag list, rendering each row with `renderRow` (the page's real
 * row — e.g. the swipe-to-uninstall row, kept exactly as-is). On a touch screen a ~200ms long-press
 * anywhere on the row lifts it; with a mouse the row is dragged by a grip handle revealed on hover
 * beside it, in the same lane the row's own hover actions use.
 */
export type ReorderableListProps<T> = {
  data: T[];
  keyOf: (item: T) => string;
  /** The real row for this item (full interactivity — tap, swipe, status). The drag wraps it. */
  renderRow: (item: T) => ReactNode;
  /** The full new key order, emitted on every committed move. */
  onReorder: (orderedKeys: string[]) => void;
  /** Set false while another mode owns row interaction (a screen's multi-select mode), so the
   *  long-press drag doesn't lift rows out from under it — and the web handle lane leaves with the
   *  row's action lanes. Defaults true. */
  dragEnabled?: boolean;
  /** Pull-to-refresh handler. Our own list owns the scroll, so it hosts the pull spinner itself. */
  refresh?: () => Promise<unknown>;
};
