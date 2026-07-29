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
import { hapticSelection } from '@/lib/haptics';

/**
 * The reader's bottom bar (NATIVE only — web keeps the tap-to-jump progress pill):
 * a page scrubber flanked by chapter-skip buttons, modelled on Mihon's
 * `ChapterNavigator` (`presentation/reader/components/ChapterNavigator.kt`) for
 * its layout and on Suwatte for how the drag itself feels.
 *
 * Behaviour taken from Mihon:
 *   - The outer row stays LTR whatever the reading direction, so the ⏮ button is
 *     always on the left and ⏭ always on the right. What flips under RTL is which
 *     CHAPTER each one goes to (left = next chapter when reading right-to-left)
 *     and the slider's own fill/thumb direction — Mihon does exactly this, one
 *     `LocalLayoutDirection` for the row and another for the slider pill.
 *   - The buttons are DISABLED (dimmed), never hidden, when there's no chapter
 *     that way, so the slider never shifts around as you move through a series.
 *   - Below two pages there's nothing to slide, so the pill is replaced by a
 *     spacer and only the chapter buttons remain.
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
 * Haptics tick once per page boundary crossed, rate-limited ON THE UI THREAD and
 * by DROPPING, not delaying. The swipeable rows' `createTickHaptic` queue spaces
 * bunched taps out over time, which is right for a short row swipe but wrong
 * here: a fast scrub crosses dozens of boundaries, and a queue that holds each
 * one back turns into a buzz still playing out seconds after the finger stopped.
 * A dropped tick is invisible; a late one reads as lag.
 */

const THUMB = 14;
const R = THUMB / 2;
const TRACK_H = 4;
/** Minimum gap between scrub ticks. Anything crossed inside the window is
 *  dropped, so what you feel is always the page you're on right now. */
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

type Props = {
  /** 0-based page within the chapter, and how many that chapter has. Only what's
   *  displayed when the user ISN'T dragging — a scrub shows its own position
   *  instead, which it knows before the reader does. */
  page: number;
  total: number;
  /** Reading right-to-left — flips the slider and what the skip buttons do. */
  rtl: boolean;
  visible: boolean;
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
  hasPrevChapter,
  hasNextChapter,
  onPrevChapter,
  onNextChapter,
  onScrub,
  scrubTarget,
  offset = 0,
  onSeek,
  onScrubbingChange,
  onScrubPage,
}: Props) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
  }));

  const steps = Math.max(1, total - 1);
  // Thumb position as a fraction of the track measured from the READING start
  // (0 = page 1), so RTL only has to flip it at the two points that touch pixels.
  const frac = useSharedValue(0);
  // Usable travel: the track inset by the thumb's radius at each end.
  const len = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const lastPage = useSharedValue(-1);
  const lastSent = useSharedValue(-1);
  const lastTickAt = useSharedValue(0);
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
  // One hop per tick carries BOTH the buzz and the number, so they can't drift
  // apart and the JS thread is asked for at most one wake-up per TICK_MS.
  const emitTick = useCallback(
    (index: number) => {
      hapticSelection();
      setScrubPage(index);
      onScrubPage?.(index);
    },
    [onScrubPage],
  );

  const pan = useMemo(() => {
    const apply = (x: number) => {
      'worklet';
      const l = len.value;
      if (l <= 0) return;
      const along = Math.min(1, Math.max(0, (x - R) / l));
      const f = rtl ? 1 - along : along;
      frac.set(f); // no snapping — the thumb goes exactly where the finger is
      const position = f * steps;
      if (scrubTarget) {
        scrubTarget.set(offset + position);
      } else if (Math.abs(position - lastSent.value) >= 0.01) {
        // No shared-value path (webtoon): fall back to a JS hop, but only for
        // moves big enough to be worth one.
        lastSent.set(position);
        runOnJS(emitScrub)(position);
      }
      const index = Math.round(position);
      if (index === lastPage.value) return;
      const now = nowMs();
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
          lastPage.set(Math.round(frac.value * steps));
          lastTickAt.set(0); // the first crossing of a new drag always ticks
          runOnJS(emitHold)(true);
        })
        .onStart((e) => apply(e.x))
        .onUpdate((e) => apply(e.x))
        // onFinalize, not onEnd: a cancelled gesture must release the chrome
        // timer too, or the bar hangs around forever.
        .onFinalize(() => {
          const index = Math.round(frac.value * steps);
          frac.set(index / steps); // settle onto the stop
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

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: insets.bottom + Spacing.two }, style]}>
      <View style={styles.row}>
        <SkipButton {...left} Icon={SkipBackIcon} />
        {total > 1 ? (
          <View style={[styles.pill, rtl && styles.pillRtl]}>
            <NumSlot value={(scrubPage ?? page) + 1} widest={total} />
            <GestureDetector gesture={pan}>
              <View testID="reader.navigator.slider" style={styles.track} onLayout={onTrackLayout}>
                <View style={styles.bar} />
                <Animated.View style={[styles.fill, rtl ? styles.fillEnd : styles.fillStart, fillStyle]} />
                <Animated.View style={[styles.thumb, thumbStyle]} />
              </View>
            </GestureDetector>
            <ThemedText style={styles.num}>{total}</ThemedText>
          </View>
        ) : (
          <View style={styles.spacer} />
        )}
        <SkipButton {...right} Icon={SkipForwardIcon} />
      </View>
    </Animated.View>
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

/** The current page, in a slot as wide as the total — otherwise the slider would
 *  shift sideways every time the page number gains a digit (Mihon's trick, with
 *  the widest value rendered invisibly underneath to size the slot). */
function NumSlot({ value, widest }: { value: number; widest: number }) {
  return (
    <View>
      <ThemedText style={[styles.num, styles.numGhost]}>{widest}</ThemedText>
      <ThemedText style={[styles.num, styles.numOver]}>{value}</ThemedText>
    </View>
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: BAR_H / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  // Reading right-to-left, the current page belongs on the right and the total on
  // the left — the whole pill mirrors, not just the slider inside it.
  pillRtl: {
    flexDirection: 'row-reverse',
  },
  num: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  numGhost: {
    opacity: 0,
  },
  numOver: {
    position: 'absolute',
    left: 0,
    right: 0,
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
