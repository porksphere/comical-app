/**
 * A top bar that reveals 1:1 with upward scroll (X/Twitter-style) and commits to shown-or-hidden
 * when the gesture ends, driven by the list's UI-thread scroll offset. Shared by the Browse grid's
 * bridge/page bar and the Search screen's filter bar so their motion can't drift — and reusable by
 * any other scrolling screen that wants a collapsing header.
 *
 * Nothing half-done survives letting go: both directions track the finger 1:1, and then the bar
 * finishes the job on its own — all the way back in if the gesture earned `COMMIT_DISTANCE` of
 * upward scroll, all the way out otherwise (so dismissing it takes a flick, not a full swipe). The
 * rule is `settleStep`; the "gesture ended" signal is `scroll-release`; the settle animation is
 * `settle` below.
 *
 * Wiring: spread `sharedValues` onto the (Animated)LegendList's `sharedValues` prop so it feeds the
 * live scroll offset, and pass `onScroll` to the list so `maxScrollY` stays in sync (it distinguishes
 * a real upward scroll from the bottom's elastic bounce-back). Apply `barStyle` to the bar's
 * Animated.View. Pass `resetKey` (a string that changes when the logical scope changes) + the
 * `listRef` to snap the bar back to visible and the list to the top on a scope change.
 *
 * `scrollY`/`maxScrollY`/`offset` are exposed for screens that drive additional scroll-linked effects
 * off the same values (e.g. Browse's tab-bar auto-hide, a border/shadow that fades with scroll,
 * pull-to-refresh).
 *
 * `barHeight` is the SLIDE DISTANCE, and picking it is how a bar chooses between two hide styles:
 * a screen-top bar passes its content height WITHOUT the safe-area inset, so it stops with the
 * frosted strip still filling the status-bar band (X/Twitter's dock — pair with `contentStyle` so
 * the controls fade out instead of parking over the clock; on a device with no top inset the same
 * distance is simply a full hide). A secondary bar that disappears behind other chrome (Search's
 * clipped filter bar) passes its full height.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewStyle } from 'react-native';
import {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  notifyScrollActivity,
  subscribeScrollPhase,
  type ScrollPhase,
} from '@/lib/scroll-release';
import { COMMIT_DISTANCE, settleStep } from '@/lib/slide-step';
import { setTopBarHidden } from '@/lib/top-bar-visibility';

/** How long the bar takes to slide to its committed state once the gesture ends. */
const SETTLE_MS = 200;

/** Minimal structural type for the list refs we reset — LegendList and FlatList both satisfy it. */
type Scrollable = { scrollToOffset: (opts: { offset: number; animated?: boolean }) => void };

export type SlidingBar = {
  /** Live scroll offset (UI thread). Also reusable for other scroll-driven effects. */
  scrollY: SharedValue<number>;
  /** contentHeight − viewportHeight, kept in sync by `onScroll` (for the bottom-bounce guard). */
  maxScrollY: SharedValue<number>;
  /** The bar's translateY: 0 fully visible, −barHeight fully hidden. */
  offset: SharedValue<number>;
  /** Animated transform for the bar (translateY = offset). Explicitly instantiated at `ViewStyle`:
   *  left bare, `useAnimatedStyle`'s default `DefaultStyle` isn't assignable to the `style` of a
   *  view (Animated.View / BarSurface), so every consumer would get a type error. */
  barStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  /** Fades the bar's INNER content with the slide (1 → 0) and drops its pointer events once mostly
   *  hidden. For a bar that docks under the status bar rather than leaving the screen (Browse): the
   *  frosted surface stays, but the controls must not sit legible — or tappable — over the clock and
   *  battery. Apply to an Animated.View wrapping the bar's content row, not the surface itself.
   *  Instantiated at `ViewStyle` for the same reason as `barStyle` above. */
  contentStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  /** Spread onto the AnimatedLegendList's `sharedValues` prop. */
  sharedValues: { scrollOffset: SharedValue<number> };
  /** Wire to the list's plain `onScroll` — keeps `maxScrollY` in sync. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

export function useSlidingBar(
  barHeight: number,
  opts?: { resetKey?: string; listRef?: RefObject<Scrollable | null> },
): SlidingBar {
  const scrollY = useSharedValue(0);
  const maxScrollY = useSharedValue(0);
  const offset = useSharedValue(0);
  // Whether `scrollY` has reported a real position since the last mount/reset. See the reaction.
  const primed = useSharedValue(false);
  // Upward scroll earned in the current gesture; `COMMIT_DISTANCE` of it locks the bar back in when
  // the user lets go. See `settleStep` for the rule and `settle` below for the animation.
  const revealUp = useSharedValue(COMMIT_DISTANCE);
  // A settle animation currently owns `offset`; scroll reports stand back until it lands (or a new
  // gesture cancels it).
  const settling = useSharedValue(false);

  useAnimatedReaction(
    () => scrollY.value,
    (y, prevY) => {
      // Reanimated runs a mapper ONCE when it registers, before any scrolling — `prevY` is null only
      // for that fire. It carries no movement, so it must neither slide the bar nor count as the
      // baseline below.
      if (prevY === null) return;
      // The first real offset after mount/reset is a POSITION, not a gesture: a list that comes up
      // already scrolled (restored offset, or a warm query cache rendering the whole feed at once)
      // reports it in one step, and diffing it against a `scrollY` still sitting at 0 reads as one
      // enormous downward flick that parks the bar off-screen before the user has touched anything.
      // `slideStep`'s MAX_GESTURE_STEP only rejects that above 240px — a list settling ~150px down
      // slid this ~82px bar fully away and left it there, which is how Browse cold-started with no
      // chrome (`tab.browse` absent from the hierarchy — e2e/mobile/{search,swipe-dismiss}).
      // Swallowing the first report re-baselines at whatever the list is ACTUALLY showing, so the
      // distance can't be accumulated at all, at any magnitude.
      if (!primed.value) {
        primed.set(true);
        return;
      }
      // A settle is playing out (the user let go and the bar is animating to its committed state).
      // Scroll reports don't fight it; `begin` cancels it the moment a finger goes down, and on web
      // — where there's no drag event to cancel on — it's over in SETTLE_MS.
      if (settling.value) return;
      // The scroll→slide rule (top pin, bottom-bounce guard, clamped accumulation, and the
      // commit-on-release layer over it) is the shared `settleStep` — the tab bar's hook runs the
      // same function, so the two bars' motion can't drift. It works in hidden-px (positive); this
      // bar's offset is a translateY, hence the sign.
      const next = settleStep(-offset.value, revealUp.value, y, prevY, maxScrollY.value, barHeight);
      revealUp.set(next.up);
      offset.set(-next.hidden);
    },
    [barHeight],
  );

  // Committing: the bar slides the rest of the way out on its own once the gesture is over. Kept as
  // a JS-thread callback (rather than a worklet reacting to a shared value) because the phase
  // broadcast it subscribes to is a plain JS module — shared-value writes hop to the UI thread on
  // their own, and a settle happens once per gesture, not per frame.
  const focused = useRef(true);
  const settle = useCallback(
    (phase: ScrollPhase) => {
      // The broadcast is global (one scroller at a time), but a blurred screen's bar keeps its
      // subscription — it must not animate off the back of another screen's scrolling.
      if (!focused.current) return;
      if (phase === 'begin') {
        // A new gesture takes the bar over wherever the settle had got to.
        cancelAnimation(offset);
        settling.set(false);
        return;
      }
      // A settle already in flight owns the bar — a `rest` arriving behind the `release` that
      // started it must not restart the same animation.
      if (settling.value) return;
      const settleTo = (hidden: number) => {
        if (-offset.value === hidden) return;
        settling.set(true);
        offset.set(
          withTiming(-hidden, { duration: SETTLE_MS }, (finished) => {
            'worklet';
            if (finished) settling.set(false);
          }),
        );
      };
      const earned = revealUp.value >= COMMIT_DISTANCE;
      // An earned reveal, and any dismissal, finish the moment the finger lifts — the bar shouldn't
      // still be moving after a fling has started.
      if (earned || revealUp.value === 0) {
        revealUp.set(earned ? COMMIT_DISTANCE : 0);
        settleTo(earned ? 0 : barHeight);
        return;
      }
      // In between: the gesture asked for the bar but hasn't earned it yet. Wait for `rest` rather
      // than deciding here, so an upward fling's momentum gets to finish earning it. Once it's over,
      // the credit is spent — the next gesture earns the reveal from scratch rather than adding to a
      // half-finished one.
      if (phase === 'rest') {
        revealUp.set(0);
        settleTo(barHeight);
      }
    },
    [barHeight, offset, revealUp, settling],
  );
  useEffect(() => subscribeScrollPhase(settle), [settle]);

  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  // Content fade, linear with slide progress. Pointer events cut past halfway: the faded (invisible)
  // controls end up translated into the status-bar band, where they'd otherwise swallow taps meant
  // for the system (e.g. iOS's tap-status-bar-to-scroll-to-top).
  const contentStyle = useAnimatedStyle(() => {
    const progress = barHeight > 0 ? Math.min(1, Math.max(0, -offset.value / barHeight)) : 0;
    return { opacity: 1 - progress, pointerEvents: progress > 0.5 ? 'none' : 'auto' } as const;
  });

  // Mirror the slide to the JS thread for code that can't read a worklet's value at the moment it
  // needs it — the root long-press overlay, which clips its flying cover to the chrome actually on
  // screen and so must know how far this bar has scrolled away (see `top-bar-visibility`). Quantized
  // to whole pixels, so it's one cheap hop per pixel of movement and nothing at all once the bar is
  // parked at either end. Nothing re-renders off it.
  const hiddenPx = useRef(0);
  const publishHidden = useCallback((px: number) => {
    hiddenPx.current = px;
    setTopBarHidden(px);
  }, []);
  useAnimatedReaction(
    () => Math.round(-offset.value),
    (px, prev) => {
      if (px !== prev) runOnJS(publishHidden)(px);
    },
    [publishHidden],
  );
  // Only the FOCUSED screen's bar is the one on screen. Republish this bar's slide when it takes
  // focus, and clear it on blur — a screen with a static top bar (the tab title bars) never reports,
  // so without the reset Browse's slid-away bar would still be clipping covers over on Library.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setTopBarHidden(hiddenPx.current);
      return () => {
        focused.current = false;
        setTopBarHidden(0);
      };
    }, []),
  );

  const resetKey = opts?.resetKey;
  const listRef = opts?.listRef;
  useEffect(() => {
    // A scope change snaps the bar back to visible + the list to the top. The list instance persists
    // across scope changes (keepPreviousData, no remount), so it won't return to the top on its own.
    //
    // Deliberately NOT `scrollY.set(0)`: that fabricated a position the list wasn't necessarily at
    // yet. It fired the reaction above with a value no scroll produced, which burned the re-baseline
    // and left the list's real offset to arrive as a delta from a fake 0 — the exact jump the
    // baseline exists to absorb. `scrollY` now only ever holds something the list actually reported,
    // so the two can't disagree; un-priming is what makes the next real report re-baseline instead,
    // whether the list honours `scrollToOffset` (it reports 0 itself) or ignores it (it keeps
    // reporting where it truly is).
    primed.set(false);
    cancelAnimation(offset);
    settling.set(false);
    revealUp.set(COMMIT_DISTANCE);
    offset.set(0);
    maxScrollY.set(0);
    listRef?.current?.scrollToOffset({ offset: 0, animated: false });
    // Shared values + listRef are stable refs; only a resetKey change should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Feeds the release detector's idle fallback, which is the ONLY "the gesture ended" signal on
      // web (a wheel/trackpad emits no drag events at all).
      notifyScrollActivity();
      const { contentSize, layoutMeasurement } = e.nativeEvent;
      if (contentSize && layoutMeasurement) {
        maxScrollY.set(Math.max(0, contentSize.height - layoutMeasurement.height));
      }
    },
    [maxScrollY],
  );

  const sharedValues = useMemo(() => ({ scrollOffset: scrollY }), [scrollY]);

  return { scrollY, maxScrollY, offset, barStyle, contentStyle, sharedValues, onScroll };
}
