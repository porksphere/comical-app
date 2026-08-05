import { makeMutable, useAnimatedStyle } from 'react-native-reanimated';

/**
 * EXPERIMENTAL series-reader companion: the DIM over whatever the combined page opens on top of.
 *
 * A contained transparent modal (that's what lets the reader's swipe-away dissolve and reveal
 * what's underneath) gets no say in how the screen beneath it is treated — a modal's animation on
 * iOS comes from `UIModalTransitionStyle`, which is cross-dissolve and flip only, with no
 * background treatment at all (see RNSScreen.mm's setStackAnimation). So the page animates itself
 * (the zoom in app/series-reader), and the backdrop's half is driven from here.
 *
 * A module-level shared value rather than context or a store, for the same reason
 * `lib/tab-bar-visibility.ts` is hand-rolled: this is one number, written by one screen, read by a
 * screen that is NOT its descendant (the modal is a sibling of the tabs in the root Stack, so
 * there is no provider that could span both), and it must move on the UI thread every frame of a
 * finger-tracked drag — a re-render per frame would be exactly the jank this is meant to avoid.
 *
 * 0 = the series page is collapsed into the card it came from (or flung away) and the backdrop is
 * at rest; 1 = the page fully covers the screen. The series page writes it (depth 0 only — drilled
 * layers sit inside the same modal, over each other, never over the tabs) and resets it on
 * unmount, so nothing can strand the backdrop dimmed.
 *
 * DIM ONLY — the parallax that used to live here is gone. The page now grows out of the card it
 * was opened from instead of sliding in from the edge, so it isn't going anywhere sideways, and
 * shoving the grid left under something expanding in place read as a second, contradictory motion.
 *
 * Remove with the experiment: this file, its writer, and the wrapper in `components/app-tabs.tsx`.
 */
export const seriesReaderDim = makeMutable(0);

/** Peak dim at full cover — the depth cue. Deliberately subtle: the page on top is already opaque,
 *  so this only has to keep the backdrop from looking like it's at the same elevation. */
export const BACKDROP_DIM_MAX = 0.14;

/** The dim, for an absolutely-positioned overlay over the backdrop. Safe to mount anywhere — it
 *  rests fully transparent whenever no series page is open, and is reset on that page's unmount. */
export function useSeriesReaderBackdropDimStyle() {
  return useAnimatedStyle(() => ({ opacity: BACKDROP_DIM_MAX * seriesReaderDim.value }));
}
