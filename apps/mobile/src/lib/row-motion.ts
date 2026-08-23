/**
 * How a row moves within a list — ONE spring, for every list that moves its rows.
 *
 * There are two motions and they are halves of the same event. A settings `ReorderableList` springs
 * its rows to their slots, which is what carries them up when one is removed; a swipeable row folds
 * itself shut before its screen drops it (see `SwipeableRow`'s `collapses`). A row leaving is the
 * fold and the slide happening together, so if the two disagree about their curve the same delete
 * reads as two animations that happen to overlap — the gap closing at one rate while the row that
 * left it closed at another.
 *
 * They did disagree: the fold shipped on `settleEase` over 210ms, which is the curve the auto-hiding
 * BARS settle on, borrowed for want of a better one. That curve is right for a gesture hand-off —
 * chrome leaving at the speed the finger left it — and this is not one. A row moving to where it
 * belongs is the spring case, and the reorderable list already had the spring; this is that constant,
 * moved somewhere both can reach it rather than copied.
 *
 * Lightly underdamped (ζ ≈ 0.87), so a row settles with the faintest overshoot rather than easing to
 * a dead stop. Anything folding to zero must pass `overshootClamping` — there is nothing past shut,
 * and a height that springs through 0 is a negative height.
 */
export const ROW_SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;
