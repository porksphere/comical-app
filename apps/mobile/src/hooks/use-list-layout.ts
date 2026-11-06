import type { LegendListRef } from '@legendapp/list/react-native';
import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react';

/**
 * Brings a mounted LegendList up to date with a new layout, and returns the `extraData` to hand it.
 * `layoutKey` names everything the list's rows and item sizes are worked out from (a content width,
 * a card width, a side inset); `extraData` is whatever the caller would have passed anyway.
 *
 * A fold, a rotation or a resize leaves two things in a mounted list out of date. LegendList asks
 * `getFixedItemSize` once per item key and keeps the answer (only a new column count clears it), so
 * rows sat in slots sized for the old window. And it renders a mounted row again only for a new item
 * or a new `extraData`, never for a new `renderItem`, so a row kept the widths its old closure held:
 * a Browse rail laid out for the open Duo kept its wide cards' spacing after the phone turned, which
 * was the gaps between its covers. Every list whose rows or sizes come out of the window goes
 * through here.
 */
export function useListLayout(
  listRef: RefObject<LegendListRef | null>,
  layoutKey: string | number,
  extraData?: unknown,
): unknown {
  const laidOutFor = useRef(layoutKey);
  useLayoutEffect(() => {
    if (laidOutFor.current === layoutKey) return;
    laidOutFor.current = layoutKey;
    listRef.current?.clearCaches();
  }, [listRef, layoutKey]);
  return useMemo(() => [layoutKey, extraData], [layoutKey, extraData]);
}
