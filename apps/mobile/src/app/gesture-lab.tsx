import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { BACK_ACTIVATE_PX, BACK_FAIL_PX, BACK_SWIPE_DEGREES, backSwipePan, backSwipeStayedHorizontal } from '@/lib/back-swipe';

/**
 * Three isolated rigs for the back-swipe, each one variable apart, so a broken swipe can be
 * attributed to something instead of guessed at.
 *
 * The series page runs seven gestures across two nested scroll containers, half a dozen shared-value
 * gates, and a layer stack. When the swipe on it doesn't work, ANY of those could be why — and
 * three consecutive fixes aimed at three different plausible causes all shipped without moving the
 * behaviour, which is what a screen like this is for. Each rig below uses the REAL `backSwipePan()`
 * (not a copy of its numbers), so what's under test is the shipped activation criteria:
 *
 *   A — pan alone, nothing under it.   Broken here ⇒ the criteria or RNGH itself, nothing else.
 *   B — pan + vertical scroll view, composed exactly as the details list composes it. Working in A
 *       but not B ⇒ the scroller wins the contest, and the composition is the bug.
 *   C — B, plus a horizontal rail in the content. Working in B but not C ⇒ the rails hypothesis is
 *       right and a rail is claiming drags well outside its own bounds.
 *
 * Each rig reports counts rather than a pass/fail, because the interesting failures are partial:
 * a recognizer that BEGINS forty times and STARTS twice is a different bug from one that never
 * begins, and both read as "it doesn't work" from the outside.
 */

type Stat = {
  began: number;
  started: number;
  ended: number;
  /** Finalized WITHOUT having activated — failed, or cancelled by something that outranked it. */
  dropped: number;
  /** Activated, followed the finger, and was then rejected at release for wandering off-axis. The
   *  half of the dominance rule that activation is too early to apply — see lib/back-swipe. */
  diagonal: number;
  /** Travel at the moment of activation, and at release. */
  startDx: number;
  endDx: number;
};

type CountField = 'began' | 'started' | 'ended' | 'dropped' | 'diagonal';

const ZERO: Stat = { began: 0, started: 0, ended: 0, dropped: 0, diagonal: 0, startDx: 0, endDx: 0 };

export default function GestureLabScreen() {
  const contentPadding = useSettingsScrollPadding();

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Gesture lab" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        <ThemedText type="small" themeColor="textSecondary">
          Swipe RIGHT inside each box, the way you would to go back. The box slides with the finger
          while the gesture owns it and springs home on release — nothing here navigates. Activation
          needs {BACK_ACTIVATE_PX}px rightward and gives up at {BACK_FAIL_PX}px vertical or leftward,
          which is the coarse gate ten points can support. `diagonal` counts drags that passed it
          and were then rejected at release for straying more than {BACK_SWIPE_DEGREES}° off
          straight across — the real rule, applied once the whole stroke is known.
        </ThemedText>

        <Rig
          name="A · pan alone"
          note="No scroll view, nothing competing. If this one misses swipes, the activation rule itself is wrong."
          kind="bare"
        />
        <Rig
          name="B · pan + scroll view"
          note="Simultaneous(Native, pan) on a vertical scroller — the details list's exact composition. Scroll it first, then swipe: the reported failure was a swipe that dies after any scrolling."
          kind="scroll"
        />
        <Rig
          name="C · pan + scroll view + rail"
          note="Same as B with a horizontal rail in the content. Swipe over the rail AND well below it."
          kind="rail"
        />
      </ScrollView>
    </ThemedView>
  );
}

function Rig({ name, note, kind }: { name: string; note: string; kind: 'bare' | 'scroll' | 'rail' }) {
  const theme = useTheme();
  const [stat, setStat] = useState<Stat>(ZERO);
  const dx = useSharedValue(0);

  // One counter per lifecycle event, plus the travel that came with it. Counting rather than
  // latching a last-state, because the interesting failures are ratios: forty BEGANs and two
  // STARTs is a different bug from no BEGANs at all, and both feel like "it doesn't work".
  const bump = useCallback((field: CountField, travel?: number) => {
    setStat((s) => ({
      ...s,
      [field]: s[field] + 1,
      ...(field === 'started' && travel !== undefined ? { startDx: travel } : null),
      ...(field === 'ended' && travel !== undefined ? { endDx: travel } : null),
    }));
  }, []);

  const pan = useMemo(() => {
    // Per-rig state, exactly as the real surfaces keep it per-copy.
    return backSwipePan()
      .onBegin(() => {
        runOnJS(bump)('began');
      })
      .onStart((e) => {
        runOnJS(bump)('started', Math.round(e.translationX));
      })
      .onUpdate((e) => {
        dx.set(Math.max(0, e.translationX));
      })
      .onEnd((e) => {
        runOnJS(bump)('ended', Math.round(e.translationX));
        // Exactly the test the real surfaces apply at release. A rig that never dismisses anything
        // is the only place to feel where the line sits without losing the page you're on.
        if (!backSwipeStayedHorizontal(e.translationX, e.translationY)) runOnJS(bump)('diagonal');
      })
      .onFinalize((_e, success) => {
        dx.set(withSpring(0, { damping: 30, stiffness: 300 }));
        if (!success) runOnJS(bump)('dropped');
      });
  }, [bump, dx]);

  // The composition under test. `Gesture.Native()` is what makes the pan and the scroll view
  // contest the same touch stream in ONE detector, which is the arrangement the details list uses
  // and the one suspected of eating the swipe.
  const gesture = useMemo(
    () => (kind === 'bare' ? pan : Gesture.Simultaneous(Gesture.Native(), pan)),
    [kind, pan],
  );

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));

  return (
    <View style={styles.rig}>
      <ThemedText type="smallBold">{name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {note}
      </ThemedText>
      <ThemedText type="small" style={[styles.mono, { color: theme.textSecondary }]} selectable>
        {`began ${stat.began}  started ${stat.started}  ended ${stat.ended}  dropped ${stat.dropped}`}
        {'\n'}
        {`diagonal ${stat.diagonal}  dx@start ${stat.startDx}  dx@end ${stat.endDx}`}
      </ThemedText>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.box, { borderColor: theme.hairline, backgroundColor: theme.backgroundElement }, slide]}>
          {kind === 'bare' ? (
            <View style={styles.boxFill}>
              <ThemedText type="small" themeColor="textSecondary">
                Swipe right anywhere in this box.
              </ThemedText>
            </View>
          ) : (
            <ScrollView style={styles.boxFill} contentContainerStyle={styles.scrollBody}>
              {kind === 'rail' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                  {RAIL.map((n) => (
                    <View key={n} style={[styles.railCard, { borderColor: theme.hairline }]}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {n}
                      </ThemedText>
                    </View>
                  ))}
                </ScrollView>
              )}
              {ROWS.map((n) => (
                <View key={n} style={[styles.row, { borderColor: theme.hairline }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Row {n}
                  </ThemedText>
                </View>
              ))}
            </ScrollView>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const RAIL = [1, 2, 3, 4, 5, 6, 7, 8];

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  rig: {
    gap: Spacing.two,
  },
  box: {
    height: 220,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  boxFill: {
    flex: 1,
    padding: Spacing.three,
  },
  scrollBody: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rail: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  railCard: {
    width: 72,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mono: {
    fontFamily: Fonts?.mono,
    fontSize: 11,
    lineHeight: 15,
  },
});
