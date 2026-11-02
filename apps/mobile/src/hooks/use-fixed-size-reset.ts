import type { LegendListRef } from '@legendapp/list/react-native';
import { type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * Drops a list's remembered item sizes when what they were worked out from changes. LegendList asks
 * `getFixedItemSize` once per item key and keeps the answer (only a new column count clears it), so
 * a size derived from the window outlives the window: after a fold, a rotation or a resize the
 * items drew at their new size in their old slots until they were scrolled away and back.
 */
export function useFixedSizeReset(listRef: RefObject<LegendListRef | null>, sizeKey: string | number) {
  const sizedFor = useRef(sizeKey);
  useLayoutEffect(() => {
    if (sizedFor.current === sizeKey) return;
    sizedFor.current = sizeKey;
    listRef.current?.clearCaches();
  }, [listRef, sizeKey]);
}
