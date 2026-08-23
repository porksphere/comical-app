/** The spring every list row moves on — the reorderable list's slide to its slot, and a swiped
 *  row's fold shut. One constant because a row leaving and the gap closing are one event.
 *  Underdamped, so anything folding to zero must add `overshootClamping`. */
export const ROW_SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;
