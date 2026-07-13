import type { ReactNode } from 'react';

/**
 * Shared props for the reorderable list, split by platform (native = `reorderable-list.tsx`, web =
 * `reorderable-list.web.tsx`) because the drag library is native-only and must never enter the web
 * bundle. Both implementations honour the same contract so pages import one symbol.
 *
 * - **Native** reorders **in place**: the live list *is* a drag list. It renders each row with
 *   `renderRow` (the page's real row — e.g. the swipe-to-uninstall row, kept exactly as-is), and a
 *   ~200ms long-press anywhere on it lifts it to drag. `editing`/`label`/`leading` are unused.
 * - **Web** keeps a lightweight **mode**: when `editing`, rows collapse to `label` (+ optional
 *   `leading`) with ▲/▼ buttons; otherwise it renders the normal `renderRow` rows.
 */
export type ReorderableListProps<T> = {
  data: T[];
  keyOf: (item: T) => string;
  /** The real row for this item (full interactivity — tap, swipe, status). Native drag wraps it. */
  renderRow: (item: T) => ReactNode;
  /** Short label for the web up/down mode. */
  label: (item: T) => string;
  /** Optional leading glyph for the web up/down mode. */
  leading?: (item: T) => ReactNode;
  /** The full new key order, emitted on every committed move. */
  onReorder: (orderedKeys: string[]) => void;
  /** Web only: when true, show the ▲/▼ reorder mode instead of the normal rows. Ignored on native. */
  editing?: boolean;
  /** Pull-to-refresh handler. Our own list owns the scroll, so it hosts the pull spinner itself. */
  refresh?: () => Promise<unknown>;
};
