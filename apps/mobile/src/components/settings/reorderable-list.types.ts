import type { ReactNode } from 'react';

/**
 * Shared props for the reorderable list. Split by platform (see `reorderable-list.tsx` for the
 * native drag via `react-native-reanimated-dnd`, `reorderable-list.web.tsx` for web up/down) — the
 * DnD library is native-only, so it must never enter the web bundle; keeping the props here lets both
 * implementations share one contract without either importing the other.
 */
export type ReorderableListProps<T> = {
  data: T[];
  keyOf: (item: T) => string;
  label: (item: T) => string;
  leading?: (item: T) => ReactNode;
  /** The full new key order, emitted on every committed move. */
  onReorder: (orderedKeys: string[]) => void;
};
