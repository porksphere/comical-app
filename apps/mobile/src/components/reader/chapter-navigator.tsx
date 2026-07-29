import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SkipBackIcon, SkipForwardIcon } from '@/components/icons/reader-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { hapticSelection } from '@/lib/haptics';

/**
 * The reader's bottom bar (NATIVE only — web keeps the tap-to-jump progress pill):
 * a page slider flanked by chapter-skip buttons, modelled on Mihon's
 * `ChapterNavigator` (`presentation/reader/components/ChapterNavigator.kt`).
 *
 * Behaviour taken from there:
 *   - The outer row stays LTR whatever the reading direction, so the ⏮ button is
 *     always on the left and ⏭ always on the right. What flips under RTL is which
 *     CHAPTER each one goes to (left = next chapter when reading right-to-left)
 *     and the slider's own fill/thumb direction — Mihon does exactly this, one
 *     `LocalLayoutDirection` for the row and another for the slider pill.
 *   - The buttons are DISABLED (dimmed), never hidden, when there's no chapter
 *     that way, so the slider never shifts around as you move through a series.
 *   - The slider is stepped: one stop per page, seeking live as you drag with a
 *     selection tick at each page — not just on release.
 *   - Below two pages there's nothing to slide, so the pill is replaced by a
 *     spacer and only the chapter buttons remain.
 *
 * Seeking is reported as a plain page index; the reader animates the move (the
 * pages slide past as if swiped, rather than cutting straight to the target).
 */

const THUMB = 16;
const R = THUMB / 2;
const TRACK_H = 4;
const ROW_H = 32; // touch height of the slider — the bar/thumb are centred in it

type Props = {
  /** 0-based page within the chapter, and how many that chapter has. */
  page: number;
  total: number;
  /** Reading right-to-left — flips the slider and what the skip buttons do. */
  rtl: boolean;
  visible: boolean;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  /** Fires for every page the drag passes over, not just the one it's released
   *  on — the reader moves along with the thumb. */
  onSeek: (page: number) => void;
  /** True while the thumb is held. The reader suspends its chrome auto-hide for
   *  the duration, so a slow scrub can't have the bar fade out from under it. */
  onScrubbingChange?: (scrubbing: boolean) => void;
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
  onSeek,
  onScrubbingChange,
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
  const lastIndex = useSharedValue(-1);

  // Follow the reader while the user isn't the one driving. A short timing (not a
  // hard set) keeps the thumb from stuttering as a fast flick reports pages.
  useEffect(() => {
    if (scrubbing.value) return;
    frac.set(withTiming(total > 1 ? Math.min(1, Math.max(0, page / steps)) : 0, { duration: 120 }));
  }, [page, total, steps, frac, scrubbing]);

  const emitSeek = useCallback(
    (index: number) => {
      onSeek(index);
      // One tick per page crossed, like Mihon's TextHandleMove feedback.
      hapticSelection();
    },
    [onSeek],
  );
  const emitScrub = useCallback((s: boolean) => onScrubbingChange?.(s), [onScrubbingChange]);

  const pan = useMemo(() => {
    const apply = (x: number) => {
      'worklet';
      const l = len.value;
      if (l <= 0) return;
      const along = Math.min(1, Math.max(0, (x - R) / l));
      const index = Math.round((rtl ? 1 - along : along) * steps);
      frac.set(index / steps); // snap the thumb to page stops
      if (index === lastIndex.value) return;
      lastIndex.set(index);
      runOnJS(emitSeek)(index);
    };
    return (
      Gesture.Pan()
        // Activate on touch-down rather than after a drag threshold, so tapping
        // anywhere on the track jumps there (Material slider behaviour).
        .minDistance(0)
        .onBegin(() => {
          scrubbing.set(true);
          runOnJS(emitScrub)(true);
        })
        .onStart((e) => apply(e.x))
        .onUpdate((e) => apply(e.x))
        // onFinalize, not onEnd: a cancelled gesture must release the chrome
        // timer too, or the bar hangs around forever.
        .onFinalize(() => {
          scrubbing.set(false);
          lastIndex.set(-1);
          runOnJS(emitScrub)(false);
        })
    );
  }, [rtl, steps, len, frac, lastIndex, scrubbing, emitSeek, emitScrub]);

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
            <NumSlot value={page + 1} widest={total} />
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  spacer: {
    flex: 1,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 24,
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
  track: {
    flex: 1,
    height: ROW_H,
  },
  bar: {
    position: 'absolute',
    left: R,
    right: R,
    top: (ROW_H - TRACK_H) / 2,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  fill: {
    position: 'absolute',
    top: (ROW_H - TRACK_H) / 2,
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
    top: (ROW_H - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
  },
});
