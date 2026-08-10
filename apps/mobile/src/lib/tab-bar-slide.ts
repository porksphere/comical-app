/**
 * Everything the bottom bar's slide is made of, as Reanimated shared values so the whole thing —
 * tracking, commit animation, and the transform itself — lives on the UI thread. `useAnimatedStyle`
 * in app-tabs reads `tabBarProgress`; `useHideTabBarOnScroll` writes it from an animated reaction.
 * Nothing here re-renders anything.
 *
 * Split out of `tab-bar-visibility` (which keeps only the pin) because that module is plain JS and
 * unit-tested under bun, which cannot import Reanimated at all.
 *
 * The history is worth keeping, because it is what the shape is for: `progress` used to be a plain
 * number with a listener set, which app-tabs mirrored into `useState`. That meant a React render,
 * reconcile and native commit for EVERY reported scroll frame — expensive enough that the reporter
 * quantized to whole pixels and dropped unchanged frames just to keep the cost down, so the bar
 * updated on fewer frames than the content moved. That is what read as a lower refresh rate than the
 * top bar, which has always been a shared value feeding an animated style.
 */
import { cancelAnimation, makeMutable, withTiming, type WithTimingConfig } from 'react-native-reanimated';

import { isTabBarPinned, subscribeTabBarPinned } from './tab-bar-visibility';

/** 0 fully shown → 1 fully hidden. Read directly inside `useAnimatedStyle` and written from the
 *  scroll reaction — both on the UI thread. */
export const tabBarProgress = makeMutable(0);

/**
 * Pixels the bar translates to fully clear the viewport — its MEASURED height plus a hair of slack,
 * reported by app-tabs' onLayout. Progress is unitless; everything that turns it back into pixels
 * (the bar's own translateY, the scroll reaction's 1:1 span, the long-press overlay's chrome band)
 * multiplies by this, so translateY == accumulated scroll px and the bar moves 1:1 with the finger.
 *
 * A shared value rather than a plain number because the reaction that needs it is a worklet. It used
 * to be a padded constant (120) while the bar is only ~48 + bottom-inset tall: fully hidden, the bar
 * was parked ~38px past the screen edge, and a scroll-up spent ~30px walking that invisible
 * overshoot back before the bar visibly moved. 120 survives only as the pre-first-layout fallback.
 */
export const tabBarHideOffset = makeMutable(120);

/** The pin (see `tab-bar-visibility`), mirrored for the worklets that have to honour it. */
export const tabBarPinned = makeMutable(false);

function clamp(next: number): number {
  'worklet';
  return Math.min(1, Math.max(0, next));
}

/** Report a position from the JS thread (the focus reset, and the settle's bookkeeping). The scroll
 *  reaction writes `tabBarProgress` directly instead — it's already on the UI thread. */
export function setTabBarProgress(next: number): void {
  tabBarProgress.value = isTabBarPinned() ? 0 : clamp(next);
}

/** The commit animation, on the UI thread. Replaces a hand-rolled `requestAnimationFrame` tween that
 *  ran on the JS thread — same duration and curve as the top bar's `withTiming`, now literally the
 *  same animator, so the two bars can't settle at visibly different rates. */
export function animateTabBarProgress(to: number, config: WithTimingConfig, onDone: () => void): void {
  tabBarProgress.value = withTiming(clamp(to), config, (finished) => {
    'worklet';
    if (finished) onDone();
  });
}

export function cancelTabBarProgress(): void {
  cancelAnimation(tabBarProgress);
}

/** JS-thread reads, for code that samples the bar once rather than animating off it (the long-press
 *  overlay clipping its flying cover to the chrome actually on screen). */
export function getTabBarProgress(): number {
  return tabBarProgress.value;
}

export function getTabBarHideOffset(): number {
  return tabBarHideOffset.value;
}

export function setTabBarHideOffset(px: number): void {
  if (px > 0) tabBarHideOffset.value = px;
}

// Taking the pin snaps the bar back and holds it: `pinTabBar` can't do this itself without importing
// this module (and this one already imports it), so the dependency runs one way and the pin
// announces instead. Cancels first — a settle in flight would otherwise animate straight back out
// from under the pin.
subscribeTabBarPinned((pinned) => {
  tabBarPinned.value = pinned;
  if (!pinned) return;
  cancelAnimation(tabBarProgress);
  tabBarProgress.value = 0;
});
