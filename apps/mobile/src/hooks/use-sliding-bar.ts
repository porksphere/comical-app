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
 * `settle: 'nearest'` swaps that rule for "whichever end the bar is nearer", and `lockstepScroll`
 * makes the settle carry the LIST with it. Both are OPT-IN, and only the Search filter bar takes
 * them — see `settleTarget` for why a rule change here can't be global: this bar and the tab bar
 * hide together off one gesture and must answer a release the same way, while the filter bar moves
 * alone. Default is the earned rule with the content sitting still, exactly as before.
 *
 * Wiring: spread `sharedValues` onto the (Animated)LegendList's `sharedValues` prop so it feeds the
 * live scroll offset, and pass `onScroll` to the list so `maxScrollY` stays in sync (it distinguishes
 * a real upward scroll from the bottom's elastic bounce-back). Apply `barStyle` to the bar's
 * Animated.View. Pass `resetKey` (a string that changes when the logical scope changes) + the
 * `listRef` to snap the bar back to visible and the list to the top on a scope change. A bar using
 * `lockstepScroll` also hands `scrollRef` to the list's `refScrollView`.
 *
 * `scrollY`/`maxScrollY`/`offset` are exposed for screens that drive additional scroll-linked effects
 * off the same values (e.g. Browse's tab-bar auto-hide, a border/shadow that fades with scroll,
 * pull-to-refresh).
 *
 * `barHeight` is the SLIDE DISTANCE, and picking it is how a bar chooses between two hide styles:
 * a screen-top bar passes its content height WITHOUT the safe-area inset, so it stops with the
 * bar surface still filling the status-bar band (X/Twitter's dock — pair with `contentStyle` so
 * the controls fade out instead of parking over the clock; on a device with no top inset the same
 * distance is simply a full hide). A secondary bar that disappears behind other chrome (Search's
 * clipped filter bar) passes its full height.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewStyle } from 'react-native';
import type Animated from 'react-native-reanimated';
import {
  cancelAnimation,
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';

import {
  beginSelfDrivenScroll,
  endSelfDrivenScroll,
  notifyScrollActivity,
  subscribeScrollPhase,
  type ScrollPhase,
} from '@/lib/scroll-release';
import {
  COMMIT_DISTANCE,
  dismissesNow,
  dismissTarget,
  MAX_SCROLL_UNMEASURED,
  SETTLE_MS,
  settleEase,
  settleScrollDelta,
  settleStep,
  settleTarget,
  TOP_GUARD,
} from '@/lib/slide-step';
import { setTopBarHidden } from '@/lib/top-bar-visibility';

/** Minimal structural type for the list refs we reset — LegendList and FlatList both satisfy it. */
type Scrollable = { scrollToOffset: (opts: { offset: number; animated?: boolean }) => void };

export type SlidingBar = {
  /** Live scroll offset (UI thread). Also reusable for other scroll-driven effects. */
  scrollY: SharedValue<number>;
  /** contentHeight − viewportHeight, kept in sync by `onScroll` (for the bottom-bounce guard).
   *  `MAX_SCROLL_UNMEASURED` until the list first reports; 0 is a real value there, meaning the
   *  content fits the viewport and every offset is a stretch. */
  maxScrollY: SharedValue<number>;
  /** The bar's translateY: 0 fully visible, −barHeight fully hidden. */
  offset: SharedValue<number>;
  /** Animated transform for the bar (translateY = offset). Explicitly instantiated at `ViewStyle`:
   *  left bare, `useAnimatedStyle`'s default `DefaultStyle` isn't assignable to the `style` of a
   *  view (Animated.View / BarSurface), so every consumer would get a type error. */
  barStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  /** Fades the bar's INNER content with the slide (1 → 0) and drops its pointer events once mostly
   *  hidden. For a bar that docks under the status bar rather than leaving the screen (Browse): the
   *  bar surface stays, but the controls must not sit legible — or tappable — over the clock and
   *  battery. Apply to an Animated.View wrapping the bar's content row, not the surface itself.
   *  Instantiated at `ViewStyle` for the same reason as `barStyle` above. */
  contentStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  /** Spread onto the AnimatedLegendList's `sharedValues` prop. */
  sharedValues: { scrollOffset: SharedValue<number> };
  /** Hand to the list's `refScrollView` — the underlying ScrollView, so the settle can scroll it on
   *  the UI thread in lockstep with the bar. Only meaningful under `lockstepScroll`; a bar without
   *  it never touches this. */
  scrollRef: AnimatedRef<Animated.ScrollView>;
  /** Wire to the list's plain `onScroll` — keeps `maxScrollY` in sync. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

export function useSlidingBar(
  barHeight: number,
  opts?: {
    resetKey?: string;
    listRef?: RefObject<Scrollable | null>;
    /** Which rule decides where the bar lands when the gesture is over. `'earned'` (the default,
     *  and what every bar but Search's filters uses) settles on the gesture; `'nearest'` settles on
     *  the position. See `settleTarget`. */
    settle?: 'earned' | 'nearest';
    /** Scroll the list along with the settle, by exactly the travel the bar still owes
     *  (`settleScrollDelta`). Needs `scrollRef` mounted on the list. Opt-in: for a bar the content
     *  merely scrolls past, moving the content on release is a surprise rather than a hand-off. */
    lockstepScroll?: boolean;
  },
): SlidingBar {
  const settleRule = opts?.settle ?? 'earned';
  const lockstepScroll = opts?.lockstepScroll ?? false;
  const scrollY = useSharedValue(0);
  const maxScrollY = useSharedValue(MAX_SCROLL_UNMEASURED);
  const offset = useSharedValue(0);
  // Whether `scrollY` has reported a real position since the last mount/reset. See the reaction.
  const primed = useSharedValue(false);
  // Upward scroll earned in the current gesture; `COMMIT_DISTANCE` of it locks the bar back in when
  // the user lets go. See `settleStep` for the rule and `settle` below for the animation. Kept
  // running under BOTH rules — it costs one addition a frame, and a bar that switched rules mid-life
  // (none does today) would otherwise start with stale credit.
  const revealUp = useSharedValue(COMMIT_DISTANCE);
  // A settle animation currently owns `offset`; scroll reports stand back until it lands (or a new
  // gesture cancels it).
  const settling = useSharedValue(false);
  /** The underlying ScrollView, for the settle's lockstep scroll. Its own ref rather than the
   *  `listRef` the reset uses: `scrollToOffset` is a JS call with its own easing, and this has to
   *  move on the UI thread, one write per frame of the bar's own curve. */
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  /** Where the bar and the content both stood when the settle started, so each frame can ask how far
   *  the bar has come and move the content to match. `per` is px of scroll per px of bar: 1 normally,
   *  and less only where the content ran out before the bar did (see the settle). Null when no
   *  settle is driving the scroller — which is also how the reaction below knows to stay out. */
  const settleFrom = useSharedValue<{ hidden: number; y: number; per: number } | null>(null);

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
      // bar's offset is a translateY, hence the sign. `TOP_GUARD` is passed explicitly: it used to
      // be omitted here (⇒ 0) while the tab bar's hook used 8, so the two bars pinned back open at
      // different offsets.
      const next = settleStep(
        -offset.value,
        revealUp.value,
        y,
        prevY,
        maxScrollY.value,
        barHeight,
        TOP_GUARD,
      );
      revealUp.set(next.up);
      offset.set(-next.hidden);
    },
    [barHeight],
  );

  // The settle's other half, under `lockstepScroll`: every frame the bar moves under its own
  // animation, the content moves with it. Reads `offset` rather than a separate progress value so
  // the two can't drift by a frame — there is one animation, and this is its second output. Inert
  // for every other bar, which never sets the baseline this reads.
  //
  // The scroll it produces comes back through `onScroll` and so through `notifyScrollActivity`,
  // where on web it would infer a new gesture and cancel the very settle that caused it; that is
  // what `beginSelfDrivenScroll` is holding shut. `scrollY` moves too, but the reaction above is
  // already standing back for the duration (`settling`), so nothing double-counts it.
  useAnimatedReaction(
    () => (settleFrom.value === null ? null : -offset.value),
    (hidden) => {
      const from = settleFrom.value;
      if (hidden === null || from === null) return;
      scrollTo(scrollRef, 0, from.y + (hidden - from.hidden) * from.per, false);
    },
  );

  // Committing: the bar slides the rest of the way out on its own once the gesture is over. Kept as
  // a JS-thread callback (rather than a worklet reacting to a shared value) because the phase
  // broadcast it subscribes to is a plain JS module — shared-value writes hop to the UI thread on
  // their own, and a settle happens once per gesture, not per frame.
  const focused = useRef(true);
  /** Ends the window that keeps the settle's own scroll frames from reading as a gesture. On the JS
   *  thread because that is where `scroll-release`'s bookkeeping lives; once per settle, not per
   *  frame. Also clears the baseline, which is what stops the reaction above driving the scroller. */
  const releaseScroll = useCallback(() => {
    if (settleFrom.value === null) return;
    settleFrom.set(null);
    endSelfDrivenScroll();
  }, [settleFrom]);

  const settle = useCallback(
    (phase: ScrollPhase) => {
      // The broadcast is global (one scroller at a time), but a blurred screen's bar keeps its
      // subscription — it must not animate off the back of another screen's scrolling.
      if (!focused.current) return;
      if (phase === 'begin') {
        // A new gesture takes the bar over wherever the settle had got to — including the scroller,
        // which the finger now owns.
        cancelAnimation(offset);
        settling.set(false);
        releaseScroll();
        return;
      }
      // A settle already in flight owns the bar — a `rest` arriving behind the `release` that
      // started it must not restart the same animation.
      if (settling.value) return;
      const hidden = -offset.value;
      // Where a hide settles TO: all the way out, or — if the list hasn't scrolled far enough for
      // the bar to leave entirely — all the way back in rather than parking half-way. See
      // `dismissTarget`.
      const hideTo = dismissTarget(scrollY.value, barHeight);
      let target: number;
      if (settleRule === 'nearest') {
        // Position, not credit — and only at REST, because `release` is the start of a fling and
        // the position there is not the one the user landed on. Through the fling the bar keeps
        // tracking 1:1, so nothing is frozen while this waits. See `settleTarget`.
        if (phase !== 'rest') return;
        target = settleTarget(hidden, scrollY.value, barHeight);
      } else {
        const earned = revealUp.value >= COMMIT_DISTANCE;
        // An earned reveal, and a dismissal that commits to HIDDEN, finish the moment the finger
        // lifts — the bar shouldn't still be moving after a fling has started. A dismissal that
        // would bounce the bar back waits for `rest` instead, so a flick from the top isn't answered
        // on the offset the fling STARTED at. See `dismissesNow`.
        if (earned || revealUp.value === 0) {
          if (!earned && !dismissesNow(hideTo, phase === 'rest')) return;
          revealUp.set(earned ? COMMIT_DISTANCE : 0);
          target = earned ? 0 : hideTo;
        } else {
          // In between: the gesture asked for the bar but hasn't earned it yet. Wait for `rest`
          // rather than deciding here, so an upward fling's momentum gets to finish earning it. Once
          // it's over the credit is spent — the next gesture earns the reveal from scratch rather
          // than adding to a half-finished one.
          if (phase !== 'rest') return;
          revealUp.set(0);
          target = hideTo;
        }
      }
      if (hidden === target) return;
      settling.set(true);
      // The content comes too, by exactly what the remaining travel is worth. Capped at the content
      // end, because a settle can't invent scroll that isn't there — and capped by SCALING the whole
      // move rather than by clamping each frame, or the first frame would jump the list back to
      // wherever the shortened move had to start. Nothing caps the other direction: `hideCeiling`
      // won't let a bar be hidden further than the content has scrolled, so a reveal's `y - hidden`
      // is already >= 0. Past the end the bar still finishes; only its lockstep with the rows gives.
      const raw = lockstepScroll ? settleScrollDelta(hidden, target) : 0;
      const room = maxScrollY.value === MAX_SCROLL_UNMEASURED ? Infinity : Math.max(0, maxScrollY.value - scrollY.value);
      const delta = raw > 0 ? Math.min(raw, room) : raw;
      if (delta !== 0) {
        beginSelfDrivenScroll();
        settleFrom.set({ hidden, y: scrollY.value, per: delta / raw });
      }
      offset.set(
        // `easing` is not optional in practice: omitting it takes Reanimated's default
        // `Easing.inOut(Easing.quad)`, whose near-motionless first frames read as the bar
        // hesitating after you let go. See `settleEase`.
        withTiming(-target, { duration: SETTLE_MS, easing: settleEase }, (finished) => {
          'worklet';
          if (finished) settling.set(false);
          runOnJS(releaseScroll)();
        }),
      );
    },
    [barHeight, lockstepScroll, maxScrollY, offset, releaseScroll, revealUp, scrollY, settleFrom, settleRule, settling],
  );
  useEffect(() => subscribeScrollPhase(settle), [settle]);
  // A screen that leaves mid-settle must not strand the window shut — nothing would reopen it, and
  // every later scroll frame would then be ignored as self-driven.
  useEffect(() => releaseScroll, [releaseScroll]);

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
    releaseScroll();
    revealUp.set(COMMIT_DISTANCE);
    offset.set(0);
    // Back to "not measured yet", not to 0 — a measured 0 now means "the content fits, everything
    // is a stretch", which would freeze the bar until the new scope's first scroll report landed.
    maxScrollY.set(MAX_SCROLL_UNMEASURED);
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
        // Floored at 0 (content shorter than the viewport can't scroll at all) — which, unlike the
        // unmeasured sentinel this starts at, arms the bounce guard for every offset. See
        // `MAX_SCROLL_UNMEASURED`.
        maxScrollY.set(Math.max(0, contentSize.height - layoutMeasurement.height));
      }
    },
    [maxScrollY],
  );

  const sharedValues = useMemo(() => ({ scrollOffset: scrollY }), [scrollY]);

  return { scrollY, maxScrollY, offset, barStyle, contentStyle, sharedValues, scrollRef, onScroll };
}
