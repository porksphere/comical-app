import { useWindowDimensions } from 'react-native';
import { makeMutable, useAnimatedStyle } from 'react-native-reanimated';

/**
 * EXPERIMENTAL series-reader companion: the PARALLAX of whatever the combined page opens over.
 *
 * UIKit gives a pushed screen this for free — the incoming card slides in at full width while the
 * outgoing one drifts left and dims. `/series-reader` can't have it: it's a contained transparent
 * modal (that's what lets the reader's swipe-away dissolve and reveal what's underneath), and a
 * modal's animation on iOS comes from `UIModalTransitionStyle` — cross-dissolve and flip only, no
 * horizontal push and no background motion (see RNSScreen.mm's setStackAnimation). So the page
 * animates itself (its `edgeX`), and the backdrop's half of the motion is driven from here.
 *
 * A module-level shared value rather than context or a store, for the same reason
 * `lib/tab-bar-visibility.ts` is hand-rolled: this is one number, written by one screen, read by a
 * screen that is NOT its descendant (the modal is a sibling of the tabs in the root Stack, so
 * there is no provider that could span both), and it must move on the UI thread every frame of a
 * finger-tracked drag — a re-render per frame would be exactly the jank this is meant to avoid.
 *
 * 0 = the series page is off-screen / flung away and the backdrop is at rest; 1 = the page fully
 * covers the screen and the backdrop sits at its parallax extreme. The series page writes it (see
 * SeriesReaderInstance, depth 0 only — drilled layers parallax each other IN-tree) and resets it
 * on unmount, so nothing can strand the backdrop off-centre.
 *
 * TWO values, because the page has two entrances. A page that SLIDES in from the edge is a push,
 * so the backdrop does the full push treatment: parallax plus dim. A page that ZOOMS out of the
 * card it was opened from (see lib/series-zoom) is not going anywhere sideways, and shoving the
 * grid left under it would read as a second, contradictory motion — so that entrance drives the
 * dim alone and leaves the parallax at rest, for the page's whole lifetime (including the back
 * swipe that closes it, which would otherwise have to parallax back from an offset never taken).
 *
 * Remove with the experiment: this file, its writer, and the wrapper in `components/app-tabs.tsx`.
 */
export const seriesReaderCover = makeMutable(0);
/** The dim's own driver — see above. Written by BOTH entrances; the slide keeps the two in step. */
export const seriesReaderDim = makeMutable(0);

/** How far the backdrop travels, as a fraction of screen width. UIKit uses about a third; a
 *  little less reads better here, where the page above it is a dark reader rather than an opaque
 *  card. */
const PARALLAX_FRACTION = 0.25;
/** Peak dim over the backdrop at full cover — the other half of the depth cue. Deliberately
 *  subtle: the page on top is already opaque, so this only has to keep the backdrop from looking
 *  like it's at the same elevation. */
export const BACKDROP_DIM_MAX = 0.14;

/** The backdrop's parallax transform. Safe to mount anywhere — it rests at 0 whenever no series
 *  page is open, and the shared value is reset on that page's unmount. */
export function useSeriesReaderBackdropStyle() {
  const { width } = useWindowDimensions();
  return useAnimatedStyle(
    () => ({ transform: [{ translateX: -PARALLAX_FRACTION * width * seriesReaderCover.value }] }),
    [width],
  );
}

/** The matching dim, for an absolutely-positioned overlay inside the same wrapper. */
export function useSeriesReaderBackdropDimStyle() {
  return useAnimatedStyle(() => ({ opacity: BACKDROP_DIM_MAX * seriesReaderDim.value }));
}
