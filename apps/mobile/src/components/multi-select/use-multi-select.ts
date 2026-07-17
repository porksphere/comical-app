/**
 * The app's multi-select store — the reusable half of the multi-select pattern (see
 * docs/download-selection-plan.md §3). Selection is a plain `Set` in component state; rows NEVER
 * hold their own selected flag (a recycled list row would carry it to the wrong item), they receive
 * `selected` as a prop derived from this set.
 *
 * `toggle` records its key as the range ANCHOR; `rangeFill` (bind to long-press) selects everything
 * between the anchor and the target in `allKeys` order — the "tap 30, long-press 50" span gesture.
 * `allKeys` is the caller's SELECTABLE keys in display order (disabled rows simply aren't in it).
 */
import { useRef, useState } from 'react';

/** Pure core of the range gesture — exported for unit tests. */
export function fillRange<K>(allKeys: readonly K[], anchor: K, target: K, prev: ReadonlySet<K>): Set<K> {
  const next = new Set(prev);
  const i = allKeys.indexOf(anchor);
  const j = allKeys.indexOf(target);
  if (i === -1 || j === -1) {
    next.add(target);
    return next;
  }
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  for (let x = lo; x <= hi; x++) next.add(allKeys[x]!);
  return next;
}

export interface MultiSelect<K> {
  selected: ReadonlySet<K>;
  count: number;
  isSelected: (key: K) => boolean;
  /** Toggle one key; it becomes the range anchor. */
  toggle: (key: K) => void;
  /** Select the span between the last anchor and `key` (falls back to a toggle without one). */
  rangeFill: (key: K) => void;
  selectAll: () => void;
  /** Replace the selection with exactly `keys` — a deliberate, repeatable staged state (e.g.
   *  "Select unread"), not an additive merge. */
  selectOnly: (keys: readonly K[]) => void;
  invert: () => void;
  clear: () => void;
}

export function useMultiSelect<K>(allKeys: readonly K[]): MultiSelect<K> {
  const [selected, setSelected] = useState<ReadonlySet<K>>(() => new Set<K>());
  // Anchor is interaction state, not render state — a ref, only touched in handlers.
  const anchor = useRef<K | null>(null);

  const toggle = (key: K) => {
    anchor.current = key;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const rangeFill = (key: K) => {
    const from = anchor.current;
    if (from === null || from === key) {
      toggle(key);
      return;
    }
    anchor.current = key;
    setSelected((prev) => fillRange(allKeys, from, key, prev));
  };

  return {
    selected,
    count: selected.size,
    isSelected: (key) => selected.has(key),
    toggle,
    rangeFill,
    selectAll: () => {
      anchor.current = null;
      setSelected(new Set(allKeys));
    },
    selectOnly: (keys) => {
      anchor.current = null;
      setSelected(new Set(keys));
    },
    invert: () => {
      anchor.current = null;
      setSelected((prev) => new Set(allKeys.filter((k) => !prev.has(k))));
    },
    clear: () => {
      anchor.current = null;
      setSelected(new Set());
    },
  };
}
