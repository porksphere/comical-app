import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SkipBackIcon, SkipForwardIcon } from '@/components/icons/reader-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { trace } from '@/lib/gesture-trace';
import { useScrubHaptics } from '@/lib/scrub-haptics';

/**
 * The reader's bottom bar (NATIVE only — web keeps the tap-to-jump progress pill):
 * a page scrubber flanked by chapter-skip buttons, modelled on Mihon's
 * `ChapterNavigator` (`presentation/reader/components/ChapterNavigator.kt`) for
 * its layout and on Suwatte for how the drag itself feels — with the page count
 * moved out of the pill into a chip beneath it (see COUNTER_H), which is the one
 * piece of the chrome that stays faintly on screen when the rest has hidden.
 *
 * Behaviour taken from Mihon:
 *   - The outer row stays LTR whatever the reading direction, so the ⏮ button is
 *     always on the left and ⏭ always on the right. What flips under RTL is which
 *     CHAPTER each one goes to (left = next chapter when reading right-to-left)
 *     and the slider's own fill/thumb direction — Mihon does exactly this, one
 *     `LocalLayoutDirection` for the row and another for the slider pill.
 *   - The buttons are DISABLED (dimmed), never hidden, when there's no chapter
 *     that way, so the slider never shifts around as you move through a series.
 *     A CHAPTERLESS ("direct") series is the one exception — there's no chapter
 *     to skip to in either direction ever, so a permanently-dead pair of buttons
 *     is just stolen width; `chaptered={false}` drops them and the scrubber
 *     takes the whole row.
 *   - Below two pages there's nothing to slide, so the pill is replaced by a
 *     spacer and only the chapter buttons remain (and with no buttons either,
 *     the bar has nothing left to show and doesn't render at all).
 *
 * The drag is CONTINUOUS, not stepped. The thumb sits exactly under the finger
 * and reports a FRACTIONAL page position, which becomes a raw scroll offset — so
 * dragging pulls the pages through the chapter's whole scroll space 1:1, the way
 * Suwatte's slider does, instead of animating a page turn per stop (which lagged
 * behind the finger and felt stepped). Only the RELEASE settles, via `onSeek`,
 * onto the nearest page.
 *
 * That position goes out through `scrubTarget`, a shared value the pager reacts
 * to on the UI thread, so the whole drag runs without touching JS — which is what
 * makes it keep up while the list is still rendering the pages swept past. Only
 * the webtoon reader, which has nothing to interpolate between, falls back to the
 * `onScrub` callback.
 *
 * Haptics fire per page boundary crossed, entirely on the UI THREAD (see
 * lib/scrub-haptics), which owns their rate limiting and so is told about EVERY
 * crossing — it has to see the ones it drops to know how fast they are coming.
 * The swipeable rows' `createTickHaptic` queue is the wrong limiter here: it
 * spaces bunched taps out over time, which turns a fast scrub into a buzz still
 * playing out seconds after the finger stopped.
 *
 * The DISPLAY tick is a separate, slower thing (see TICK_MS) and still hops to
 * JS, because what it feeds — the pill's number and the warm-ahead — is JS-side
 * and wants far fewer updates than a fingertip does.
 */

const THUMB = 14;
const R = THUMB / 2;
const TRACK_H = 4;
/** Minimum gap between scrub ticks — the DISPLAY ones. Anything crossed inside the window is
 *  dropped, so what you read is always the page you're on right now. The haptics are not on this
 *  clock: they hear every crossing (see `haptics.crossing`). */
const TICK_MS = 45;

/** `Date.now()` on the UI thread, hoisted out of the component: the gesture body
 *  is built inside a `useMemo`, and the React Compiler lint can't tell a worklet
 *  that runs later on another thread from render code, so an inline clock read
 *  there reads as an impure call during render. */
function nowMs() {
  'worklet';
  return Date.now();
}
/** Height of the pill AND of the chapter-skip buttons — the bar and the arrows
 *  either side of it are one continuous row of the same weight. */
const BAR_H = 40;
/** The page counter under the bar — "12 / 26" in a small chip that sits just above the home
 *  indicator (its bottom edge on the safe-area inset) and, unlike the bar, never fully leaves:
 *  with the chrome hidden it stays at `COUNTER_FAINT` so a glance still says where you are. It is
 *  never interactive, so it has no business being under a finger — and a chip INSIDE the inset
 *  would sit under the indicator itself, which on iPhone draws over whatever is beneath it. */
const COUNTER_H = 20;
const COUNTER_BOTTOM = Spacing.one;
const COUNTER_FAINT = 0.35;
const BAR_BOTTOM = COUNTER_BOTTOM + COUNTER_H + Spacing.one;
/** Where the bottom chrome ENDS, above the safe-area inset — the bar's top edge. Anything stacked
 *  over the bar (the Details hint) measures from here. */
export const BOTTOM_CHROME_HEIGHT = BAR_BOTTOM + BAR_H;

type Props = {
  /** 0-based page within the chapter, and how many that chapter has. Only what's
   *  displayed when the user ISN'T dragging — a scrub shows its own position
   *  instead, which it knows before the reader does. */
  page: number;
  total: number;
  /** Reading right-to-left — flips the slider and what the skip buttons do. */
  rtl: boolean;
  visible: boolean;
  /** False for a chapterless ("direct") series: the skip buttons are omitted
   *  entirely rather than rendered dead, and the scrubber flexes into the space
   *  they'd have taken. Defaults true — every chaptered reader keeps them. */
  chaptered?: boolean;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  /** Live position while dragging, in pages and FRACTIONAL (2.4 = 40% of the way
   *  from page 3 to page 4). The reader scrolls straight to it, unanimated.
   *  Only used when there's no `scrubTarget` to write to (the webtoon reader). */
  onScrub: (position: number) => void;
  /** Preferred over `onScrub` when given: the same fractional position, written
   *  straight into a shared value the pager reacts to on the UI thread, so the
   *  drag never hops to JS and the pages keep up with the finger even while the
   *  list is busy rendering. Written as an index into the READER's whole stitched
   *  page array, hence `offset`; negative means "not scrubbing". */
  scrubTarget?: SharedValue<number>;
  /** Where this chapter starts in that array (0 unless chapters are stitched). */
  offset?: number;
  /**
   * How many pages the TRACK spans, when that isn't `total`.
   *
   * `page`/`total` describe what the pill says, and mid-crossing that is deliberately the
   * NEIGHBOURING chapter — the page travelling across the screen counted against its own chapter's
   * length. The track cannot borrow that number. `offset` and `onSeek` both speak the chapter being
   * READ, so a track sized by a neighbour is a track whose far end is somewhere the reader is not:
   * dragging there walked past the end of the current chapter into the next one's flat range, and
   * the release settled in a segment nobody asked for and relabelled to it. That is the "scrubbing
   * sometimes jumps to another chapter", and it needs no strange input — just grabbing the thumb
   * before a crossing had finished settling.
   *
   * So the track, the offset and the commit all take their length from here, and only the pill is
   * allowed to read against whatever is passing. Defaults to `total` for the unstitched case, where
   * they are the same number by construction.
   */
  scrubTotal?: number;
  /** The page the drag came to rest on — the only point anything is committed. */
  onSeek: (page: number) => void;
  /** True while the thumb is held. The reader suspends its chrome auto-hide for
   *  the duration, so a slow scrub can't have the bar fade out from under it. */
  onScrubbingChange?: (scrubbing: boolean) => void;
  /** Each page the drag settles onto, at the same rate as the haptics (so at most
   *  one per TICK_MS, riding the hop that's already crossing to JS). The reader
   *  warms images around it — a scrub is otherwise the one way to arrive at a
   *  page nothing has prefetched, since the warm-ahead follows the READ position
   *  and that deliberately stops updating while a finger is down. */
  onScrubPage?: (page: number) => void;
};

export function ChapterNavigator({
  page,
  total,
  rtl,
  visible,
  chaptered = true,
  hasPrevChapter,
  hasNextChapter,
  onPrevChapter,
  onNextChapter,
  onScrub,
  scrubTarget,
  offset = 0,
  scrubTotal,
  onSeek,
  onScrubbingChange,
  onScrubPage,
}: Props) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
  }));
  const counterStyle = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : COUNTER_FAINT, { duration: 200 }),
  }));

  // The TRACK's domain — see `scrubTotal`. Never `total`, unless they are the same chapter.
  const steps = Math.max(1, (scrubTotal ?? total) - 1);
  // Thumb position as a fraction of the track measured from the READING start
  // (0 = page 1), so RTL only has to flip it at the two points that touch pixels.
  const frac = useSharedValue(0);
  // Usable travel: the track inset by the thumb's radius at each end.
  const len = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const lastPage = useSharedValue(-1);
  const lastSent = useSharedValue(-1);
  const lastTickAt = useSharedValue(0);
  // THE DRAG'S COORDINATE FRAME, latched at touch-down and held for the whole drag.
  //
  // `offset` and `steps` are props, and props move: the stitched window grows as neighbouring
  // chapters arrive, which shifts where the current chapter starts, and a relabel changes which
  // chapter is current at all. A recording of the bug shows both moving under a held finger —
  // offset 38 → 23, steps 18 → 14 — so the release committed in a frame the drag had never been
  // calibrated in, and landed in a different chapter. Latching costs nothing (the frame cannot
  // legitimately change while a finger is down: whatever the window does, the drag was aimed at the
  // chapter it started in) and makes the whole class impossible.
  const frameOffset = useSharedValue(0);
  const frameSteps = useSharedValue(1);
  // What the pill shows WHILE dragging. The `page` prop can't do this job: it's
  // driven by the pager's viewability callbacks, which only report cells that
  // actually rendered — during a fast scrub over a short render window that's a
  // fraction of the pages swept past, arriving late. The scrub knows the answer
  // already, so it says it directly and hands the number back on release.
  const [scrubPage, setScrubPage] = useState<number | null>(null);

  // Follow the reader while the user isn't the one driving. A short timing (not a
  // hard set) keeps the thumb from stuttering as a fast flick reports pages.
  useEffect(() => {
    if (scrubbing.value) return;
    frac.set(withTiming(total > 1 ? Math.min(1, Math.max(0, page / steps)) : 0, { duration: 120 }));
  }, [page, total, steps, frac, scrubbing]);

  // `pan` is rebuilt whenever a callback or the direction changes, INCLUDING mid-
  // drag. That's safe (checked against the RNGH source, not assumed): a rebuilt
  // gesture of the same type isn't reattached — GestureDetector's `needsToReattach`
  // only fires when the number/type of gestures changes — it just updates the
  // handlers in place, so the in-flight scrub carries on with the fresh callbacks.
  const emitScrub = useCallback((position: number) => onScrub(position), [onScrub]);
  const emitSeek = useCallback((index: number) => {
    // Clearing the display in the same commit as the settle: the seek is what
    // makes `page` correct, so the pill never falls back to a stale number.
    setScrubPage(null);
    onSeek(index);
  }, [onSeek]);
  const emitHold = useCallback((held: boolean) => onScrubbingChange?.(held), [onScrubbingChange]);
  // The DISPLAY tick — the pill's number and the warm-ahead, one hop per TICK_MS. The buzz used to
  // ride along with it; it doesn't any more, because a fingertip wants an answer far more often
  // than a label does, and on a thread that isn't busy building pages.
  const emitTick = useCallback(
    (index: number) => {
      setScrubPage(index);
      onScrubPage?.(index);
    },
    [onScrubPage],
  );

  // The detent feel, driven from the gesture worklet — no hop, and every crossing heard.
  const haptics = useScrubHaptics();
  /** The page the HAPTICS last saw, kept apart from `lastPage` (the display's) because the two run
   *  at different rates: the display drops crossings inside TICK_MS, and a crossing dropped there
   *  is still one the finger made. */
  const lastHapticPage = useSharedValue(-1);

  const pan = useMemo(() => {
    const apply = (x: number) => {
      'worklet';
      const l = len.value;
      if (l <= 0) return;
      const along = Math.min(1, Math.max(0, (x - R) / l));
      const f = rtl ? 1 - along : along;
      frac.set(f); // no snapping — the thumb goes exactly where the finger is
      // The LATCHED frame, never the props — see `frameOffset`. The props may have moved since the
      // finger landed, and following them mid-drag is what sent the release to another chapter.
      const position = f * frameSteps.value;
      if (scrubTarget) {
        scrubTarget.set(frameOffset.value + position);
      } else if (Math.abs(position - lastSent.value) >= 0.01) {
        // No shared-value path (webtoon): fall back to a JS hop, but only for
        // moves big enough to be worth one.
        lastSent.set(position);
        runOnJS(emitScrub)(position);
      }
      const now = nowMs();
      const index = Math.round(position);
      // The haptic hears the crossing FIRST and unconditionally — before the display's rate limit,
      // which drops crossings the finger genuinely made.
      if (index !== lastHapticPage.value) {
        lastHapticPage.set(index);
        haptics.crossing(now);
      }

      if (index === lastPage.value) return;
      // Inside the window: drop this crossing, and DON'T record it — the next
      // touch event (a frame or so later) tries again and reports wherever the
      // finger is by then, so the number and the buzz always describe the
      // present rather than a queued-up past.
      if (now - lastTickAt.value < TICK_MS) return;
      lastPage.set(index);
      lastTickAt.set(now);
      runOnJS(emitTick)(index);
    };
    return (
      Gesture.Pan()
        // Activate on touch-down rather than after a drag threshold, so tapping
        // anywhere on the track jumps there (Material slider behaviour).
        .minDistance(0)
        .onBegin(() => {
          scrubbing.set(true);
          // Latch first: everything below this line, and every frame of the drag, reads the frame
          // rather than the props.
          frameOffset.set(offset);
          frameSteps.set(steps);
          lastPage.set(Math.round(frac.value * steps));
          // The first crossing of a new drag always clicks, and always as a deliberate one.
          lastHapticPage.set(Math.round(frac.value * steps));
          haptics.begin();
          lastTickAt.set(0); // the first crossing of a new drag always ticks
          // The track's whole calibration in one line. `steps` and `offset` must describe the SAME
          // chapter (see `scrubTotal`); when they don't, the far end of this track is in the next
          // chapter and the release lands there. Deliberately NOT logging the pill's `total` here
          // too, tempting as the comparison is: it would join this gesture's dependencies and
          // rebuild the recognizer on a relabel, and a diagnostic that changes when its subject
          // rebuilds is measuring itself. `seek commit`'s `of=` carries the same comparison, from
          // JS, for free.
          trace('scrub', 'grab', { steps, offset });
          runOnJS(emitHold)(true);
        })
        .onStart((e) => apply(e.x))
        .onUpdate((e) => apply(e.x))
        // onFinalize, not onEnd: a cancelled gesture must release the chrome
        // timer too, or the bar hangs around forever.
        .onFinalize(() => {
          const index = Math.round(frac.value * frameSteps.value);
          // What the release COMMITS, in the coordinates it commits in — the LATCHED ones. `held`
          // repeats the frame the drag was calibrated in, so a recording says outright whether it
          // stayed put: `steps` here against `steps` on the matching grab.
          trace('scrub', 'release', { index, flat: frameOffset.value + index, steps: frameSteps.value });
          frac.set(index / frameSteps.value); // settle onto the stop
          scrubTarget?.set(-1); // hand the scroll back to the reader
          scrubbing.set(false);
          lastPage.set(-1);
          lastSent.set(-1);
          runOnJS(emitSeek)(index);
          runOnJS(emitHold)(false);
        })
    );
  }, [
    rtl,
    steps,
    offset,
    scrubTarget,
    len,
    frac,
    lastPage,
    lastSent,
    lastTickAt,
    scrubbing,
    frameOffset,
    frameSteps,
    haptics,
    lastHapticPage,
    emitScrub,
    emitSeek,
    emitHold,
    emitTick,
  ]);

  const onTrackLayout = useCallback(
    (e: LayoutChangeEvent) => {
      len.set(Math.max(0, e.nativeEvent.layout.width - THUMB));
    },
    [len],
  );

  const fillStyle = useAnimatedStyle(() => ({ width: frac.value * len.value }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (rtl ? 1 - frac.value : frac.value) * len.value }],
  }));

  // Icons stay put; the chapter each one leads to is what direction changes.
  const prev = {
    testID: 'reader.navigator.prev-chapter',
    label: 'Previous chapter',
    onPress: onPrevChapter,
    enabled: hasPrevChapter,
  };
  const next = {
    testID: 'reader.navigator.next-chapter',
    label: 'Next chapter',
    onPress: onNextChapter,
    enabled: hasNextChapter,
  };
  const left = rtl ? next : prev;
  const right = rtl ? prev : next;

  // A one-page direct series has neither a slider nor buttons to put in the bar.
  // (Every hook above has already run — this branch is stable for the lifetime
  // of a given series, but keeping the return here means it can't reorder them.)
  if (!chaptered && total <= 1) return null;

  return (
    <>
      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[styles.wrap, { bottom: insets.bottom + BAR_BOTTOM }, style]}>
        <View style={styles.row}>
          {chaptered && <SkipButton {...left} Icon={SkipBackIcon} />}
          {total > 1 ? (
            <View style={styles.pill}>
              <GestureDetector gesture={pan}>
                <View testID="reader.navigator.slider" style={styles.track} onLayout={onTrackLayout}>
                  <View style={styles.bar} />
                  <Animated.View style={[styles.fill, rtl ? styles.fillEnd : styles.fillStart, fillStyle]} />
                  <Animated.View style={[styles.thumb, thumbStyle]} />
                </View>
              </GestureDetector>
            </View>
          ) : (
            <View style={styles.spacer} />
          )}
          {chaptered && <SkipButton {...right} Icon={SkipForwardIcon} />}
        </View>
      </Animated.View>
      {/* The counter, under the bar and on its own fade — see COUNTER_H. Reads the scrub's own
          position while a finger is down (`scrubPage`), for the same reason the pill used to. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.counterWrap, { bottom: insets.bottom + COUNTER_BOTTOM }, counterStyle]}>
        <View style={styles.counter}>
          {/* The one node holding the current page as its own text — e2e reads a page number off
              the bar by this id, so the total stays a separate node. */}
          <ThemedText testID="reader.navigator.page" style={styles.counterText}>
            {(scrubPage ?? page) + 1}
          </ThemedText>
          <ThemedText style={[styles.counterText, styles.counterTotal]}>/ {total}</ThemedText>
        </View>
      </Animated.View>
    </>
  );
}

function SkipButton({
  testID,
  label,
  onPress,
  enabled,
  Icon,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  enabled: boolean;
  Icon: typeof SkipBackIcon;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!enabled}
      hitSlop={8}
      style={styles.skip}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={label}>
      <Icon color={enabled ? '#fff' : 'rgba(255,255,255,0.3)'} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  skip: {
    width: BAR_H,
    height: BAR_H,
    borderRadius: BAR_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  spacer: {
    flex: 1,
  },
  pill: {
    flex: 1,
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: BAR_H / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  counter: {
    height: COUNTER_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    borderRadius: COUNTER_H / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  counterTotal: {
    color: 'rgba(255,255,255,0.6)',
  },
  // Full-height so the whole pill is grabbable, not just the 4px line in it.
  track: {
    flex: 1,
    height: BAR_H,
  },
  bar: {
    position: 'absolute',
    left: R,
    right: R,
    top: (BAR_H - TRACK_H) / 2,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  fill: {
    position: 'absolute',
    top: (BAR_H - TRACK_H) / 2,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: '#fff',
  },
  fillStart: {
    left: R,
  },
  fillEnd: {
    right: R,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    top: (BAR_H - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
  },
});
