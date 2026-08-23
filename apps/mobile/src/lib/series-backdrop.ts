import { Dimensions } from 'react-native';
import { makeMutable, useAnimatedStyle } from 'react-native-reanimated';

import { sharedPushback } from '@/lib/pushback-signal';
import { armSettleCheck, cancelSettleCheck, notePushback } from '@/lib/pushback-watchdog';

/**
 * The DIM over whatever the combined page opens on top of.
 *
 * A contained transparent modal (that's what lets the reader's swipe-away dissolve and reveal
 * what's underneath) gets no say in how the screen beneath it is treated — a modal's animation on
 * iOS comes from `UIModalTransitionStyle`, which is cross-dissolve and flip only, with no
 * background treatment at all (see RNSScreen.mm's setStackAnimation). So the page animates itself
 * (the zoom in app/series), and the backdrop's half is driven from here.
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
 * The treatment is the one react-native-screen-transitions' navigation zoom gives the screen it
 * opens over — a small scale-down plus a dim, NOT the sideways parallax a push gets. The page
 * expands in place out of one of this screen's own cards, so moving the grid laterally under it
 * read as a second, contradictory motion.
 *
 */
export const seriesReaderDim = makeMutable(0);

/** Which signal this is, in the watchdog's log and in `armSettleCheck`'s bookkeeping. */
const SOURCE = 'series-backdrop';

/**
 * How many series pages are currently entitled to hold the backdrop back. Only ever 0 or 1 in
 * practice (depth 0 of one modal route), but counted rather than flagged so a transition that
 * briefly has the outgoing and incoming route both mounted can't have the first one's teardown
 * cancel the second one's hold.
 *
 * The COUNT is what makes the strand detectable at all. Resetting on unmount, which is what this
 * used to do on its own, is correct and still happens first here — but it is a single write on the
 * JS thread against a value that a UI-thread reaction is writing every frame, and it has no way to
 * notice when it loses that race. Knowing that nobody owns the dim any more is what lets the
 * watchdog come back a moment later and ask whether the reset actually took.
 */
let owners = 0;

/**
 * Claim the backdrop for a mounted series page; the returned release drops it. Call it from an
 * effect so the release is the cleanup — the release IS the reset, so a page can't leave without
 * putting the backdrop back.
 */
export function holdSeriesBackdrop(): () => void {
  owners += 1;
  notePushback(`${SOURCE} hold`, `owners=${owners}`);
  cancelSettleCheck(SOURCE);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners -= 1;
    seriesReaderDim.set(0);
    notePushback(`${SOURCE} release`, `owners=${owners}`);
    if (owners === 0) {
      armSettleCheck(
        SOURCE,
        sharedPushback(seriesReaderDim),
        () => `owners=${owners}`,
        () => owners === 0,
      );
    }
  };
}

/** Peak dim at full cover. The library's own `ZOOM_BACKDROP_MAX_OPACITY` is 0.45, but that is a
 *  backdrop BETWEEN two opaque screens; here it lands on the tab bar and the grid, which stay
 *  partly visible through the transparent modal for the first quarter of the travel — so it is
 *  kept subtle enough not to read as the lights going out. */
const BACKDROP_DIM_MAX = 0.14;
/** `ZOOM_BACKGROUND_SCALE` — how far the screen underneath shrinks at full cover. */
const BACKDROP_SCALE_MIN = 0.9375;

/** The backdrop's scale-down. Safe to mount anywhere — it rests at 1 whenever no series page is
 *  open, and the shared value is reset on that page's unmount. */
export function useSeriesReaderBackdropStyle() {
  return useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - BACKDROP_SCALE_MIN) * seriesReaderDim.value }],
  }));
}

/**
 * Undo the scale above for anything MEASURING a view under an open series page. `measureInWindow`
 * reports the drawn box, so a card measured then comes back ~6% small and pulled toward the screen
 * centre. The rect wanted is the one it occupies at rest — where it will be by the time the collapse
 * arrives. A no-op whenever no series page is open, including every press-in capture.
 */
export function unscaleFromBackdrop<T extends { x: number; y: number; width: number; height: number }>(rect: T): T {
  const scale = 1 - (1 - BACKDROP_SCALE_MIN) * seriesReaderDim.value;
  if (scale >= 1) return rect;
  const { width, height } = Dimensions.get('window');
  const cx = width / 2;
  const cy = height / 2;
  return {
    ...rect,
    x: cx + (rect.x - cx) / scale,
    y: cy + (rect.y - cy) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** The dim, for an absolutely-positioned overlay over the backdrop. Safe to mount anywhere — it
 *  rests fully transparent whenever no series page is open, and is reset on that page's unmount. */
export function useSeriesReaderBackdropDimStyle() {
  return useAnimatedStyle(() => ({ opacity: BACKDROP_DIM_MAX * seriesReaderDim.value }));
}
