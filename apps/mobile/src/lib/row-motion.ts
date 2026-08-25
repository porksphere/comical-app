import { LinearTransition, ReduceMotion } from 'react-native-reanimated';

/** The spring every list row moves on — the reorderable list's slide to its slot, and a swiped
 *  row's fold shut. One constant because a row leaving and the gap closing are one event.
 *  Underdamped, so anything folding to zero must add `overshootClamping`. */
export const ROW_SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;

/**
 * The same spring, as a layout transition, for the two feeds that RE-SORT themselves while you are
 * looking away — reading a series moves its row to the top of History and Activity. Without it the
 * row teleports the moment the refetch lands, which is what a reorder looks like when nothing
 * carries the eye from the old slot to the new one.
 *
 * Single-column only (a Reanimated constraint), which both feeds are. Safe here specifically because
 * they pass `recycleItems={false}`: LegendList then keys each container by its item, so a container
 * handed a different row REMOUNTS rather than transitioning, and no row is ever seen flying the
 * length of the list on its way to being recycled.
 */
export const ROW_REORDER_TRANSITION = LinearTransition.springify()
  .damping(ROW_SPRING.damping)
  .stiffness(ROW_SPRING.stiffness)
  .mass(ROW_SPRING.mass)
  .reduceMotion(ReduceMotion.System);
