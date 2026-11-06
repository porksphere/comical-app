import { useEffect, useState } from 'react';
import { LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { useContentWidth, useSideInsets } from '@/hooks/use-content-width';

/** The spring every list row moves on — the reorderable list's slide to its slot, and a swiped
 *  row's fold shut. One constant because a row leaving and the gap closing are one event.
 *  Underdamped, so anything folding to zero must add `overshootClamping`. */
export const ROW_SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;

/**
 * The same spring, as a layout transition, for the lists that RE-SORT themselves while you are
 * looking away — reading a series moves its row to the top of History and Activity, and its card
 * to the front of a Library sorted by last read. Without it the item teleports the moment the
 * refetch lands, which is what a reorder looks like when nothing carries the eye from the old slot
 * to the new one.
 *
 * Safe under recycling as well as without it: LegendList skips the transition on a container the
 * moment it is handed a different item, so no row is ever seen flying the length of the list on its
 * way to being recycled. Columns work too — a card moving across a row slides diagonally.
 */
export const ROW_REORDER_TRANSITION = LinearTransition.springify()
  .damping(ROW_SPRING.damping)
  .stiffness(ROW_SPRING.stiffness)
  .mass(ROW_SPRING.mass)
  .reduceMotion(ReduceMotion.System);

/**
 * `transition`, except across a change of the content width or the safe area's sides — a fold, a
 * rotation — when every row moves at once and the transition would carry each from its old place
 * to its new: nothing for that commit and the frames the list takes to reposition after it, as
 * LegendList itself gives a recycled container no transition. A tab folded while hidden showed
 * its grid laid out for the open display sliding left into the folded one when it was opened.
 */
export function useRowTransition<T>(transition: T): T | undefined {
  const insets = useSideInsets();
  const width = useContentWidth();
  const key = `${width}:${insets.left}:${insets.right}`;
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    if (settled === key) return;
    const timer = setTimeout(() => setSettled(key), RELAYOUT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [key, settled]);
  return settled === key ? transition : undefined;
}

const RELAYOUT_HOLD_MS = 300;
