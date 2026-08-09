/**
 * The bottom bar's slide position, as a Reanimated shared value: 0 fully shown → 1 fully hidden.
 *
 * Split out of `tab-bar-visibility` (which keeps the pin and the measured hide offset) for two
 * reasons: that module is plain JS and unit-tested under bun, which can't import Reanimated at all;
 * and the split is the honest one anyway — the pin is a fact about the screen, this is a per-frame
 * animation value.
 *
 * It used to be a plain number with a listener set, which `app-tabs` mirrored into `useState`. That
 * meant a React render, reconcile and native commit for EVERY reported scroll frame, which was
 * expensive enough that the reporter had to quantize to whole pixels and drop unchanged frames just
 * to keep the cost down — so the bar literally updated on fewer frames than the content moved, which
 * is what read as a lower refresh rate than the top bar (that one has always been a shared value
 * feeding `useAnimatedStyle`). A shared value costs no render at all: a write from the JS thread
 * hops straight to the UI thread and the bar's transform follows there, so it can be published raw,
 * every frame, at full float precision.
 */
import { cancelAnimation, makeMutable, withTiming, type WithTimingConfig } from 'react-native-reanimated';

import { isTabBarPinned, subscribeTabBarPinned } from './tab-bar-visibility';

/** Read directly inside `useAnimatedStyle` — this is the value the bar's translateY comes from. */
export const tabBarProgress = makeMutable(0);

function clamp(next: number): number {
  return Math.min(1, Math.max(0, next));
}

/** Report a scroll-driven position. A pinned screen holds the bar at 0 whatever anyone reports —
 *  the same guarantee as before, kept in the one place every writer goes through. */
export function setTabBarProgress(next: number): void {
  tabBarProgress.value = isTabBarPinned() ? 0 : clamp(next);
}

/** The commit animation, on the UI thread. Replaces a hand-rolled `requestAnimationFrame` tween that
 *  ran on the JS thread — same duration and curve as the top bar's `withTiming`, now literally the
 *  same animator, so the two bars can't settle at visibly different rates. */
export function animateTabBarProgress(to: number, config: WithTimingConfig): void {
  tabBarProgress.value = withTiming(clamp(to), config);
}

export function cancelTabBarProgress(): void {
  cancelAnimation(tabBarProgress);
}

/** JS-thread read, for code that samples the bar's position once rather than animating off it (the
 *  long-press overlay clipping its flying cover to the chrome actually on screen). */
export function getTabBarProgress(): number {
  return tabBarProgress.value;
}

// Taking the pin snaps the bar back and holds it: `pinTabBar` can't do this itself without importing
// this module (and this one already imports it), so the dependency runs one way and the pin
// announces instead. Cancels first — a settle in flight would otherwise animate straight back out
// from under the pin.
subscribeTabBarPinned((pinned) => {
  if (!pinned) return;
  cancelAnimation(tabBarProgress);
  tabBarProgress.value = 0;
});
