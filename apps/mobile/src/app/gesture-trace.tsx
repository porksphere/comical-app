import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { readFrameSummary } from '@/lib/frame-trace';
import {
  clearGestureTrace,
  gestureTrace$,
  markGestureTrace,
  useGestureTrace,
  useGestureTraceEnabled,
} from '@/lib/gesture-trace';

/**
 * The gesture trace readout — what the recognizers on the series page and the search layer actually
 * did, in order, with the state they saw at each step.
 *
 * This exists because the back-swipe has been reported broken across several builds whose fixes
 * each targeted a different plausible cause, and nothing on the device could say which cause was
 * real. `lib/gesture-trace` lists the five distinct failures that all present as "the swipe doesn't
 * work"; the job of this screen is to make them look different from each other.
 *
 * Reading a trace, roughly:
 *   • no `touch.down` at all        → the recognizer never saw the touches. Something above it did.
 *   • `touch.down`, no `BEGAN`      → RNGH isn't starting it — disabled, or not attached here.
 *   • `BEGAN`, no `START`           → the offsets were never satisfied, or a failOffset tripped
 *                                     first. The `touch.move dx=/dy=` lines say which; compare
 *                                     them against BACK_ACTIVATE_PX / BACK_FAIL_PX in
 *                                     lib/back-swipe.
 *   • `BEGAN` → `FINALIZE ok=n`, with `details.scroll offset` lines in between
 *                                   → the native scroller won the contest and cancelled it.
 *   • `START active=n`              → it ran, but the detailsActive gate no-oped every callback.
 *   • two `END` lines, one per tag  → both copies committed off one release. The second spring
 *                                     cancels the first, whose callback still fires — which is
 *                                     exactly what "the animation finishes instantly" looks like.
 *   • `collapse.done finished=n`    → the collapse spring was cancelled rather than completing.
 *   • `frame LONG dt=`              → the UI thread stalled for that many ms (lib/frame-trace).
 *                                     WHERE these fall against the gesture lines is the whole
 *                                     question: during the drag, at the release, or through the
 *                                     collapse — and whether any JS line sits beside them.
 *
 * It has since grown a second tenant, on the same timeline and for the same reason — a reader page
 * that never appears is as mute as a swipe that never fires, and the stages it can die in are just
 * as indistinguishable from the outside. Reading THOSE:
 *   • `warm enqueue n= inflight=`   → a warm-ahead just queued `n` fresh pages, with `inflight`
 *                                     resolves already outstanding. A big `n` here is the reader
 *                                     asking for far more than it is about to show.
 *   • `page resolving p= inflight=` → page `p` asked for its URL. If `inflight` is large, it is
 *                                     queued behind that many others — and because resolves are
 *                                     deduped by URL, it cannot overtake them.
 *   • `page resolved p= ms=`        → the matching answer, and how long it took. A `page resolving`
 *                                     with no `resolved` after it is a page still waiting.
 *   • `page loaded p=`              → bytes arrived and decoded. This is the only line that means
 *                                     the page is actually on screen.
 *   • `page stall p=`               → nothing moved for STALL_MS (reader-page.tsx). The reader has
 *                                     given up waiting and handed it to the retry backoff; the
 *                                     `inflight` on this line says what it was waiting behind.
 */
export default function GestureTraceScreen() {
  const contentPadding = useSettingsScrollPadding();
  const theme = useTheme();
  const enabled = useGestureTraceEnabled();
  const lines = useGestureTrace();
  // Read during render rather than subscribed to: these counters move every frame while recording,
  // and a readout that re-rendered with them would be measuring itself.
  const frames = readFrameSummary();

  const shareLog = () => {
    if (lines.length === 0) return;
    Share.share({ message: lines.join('\n') });
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Gesture trace" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        <ThemedText type="small" themeColor="textSecondary">
          Records what the swipe recognizers on the series page and the search layer did — whether
          they saw the touches, whether they began, whether they activated, and what state they saw
          when they ended. While it is off, those recognizers are configured exactly as they ship,
          so a recording can&apos;t be blamed for what it measures. It also records the reader&apos;s
          page pipeline on the same timeline — what each page asked for, how many requests it was
          queued behind, and whether an answer ever came. Nothing is sent anywhere; use Share to
          send it yourself.
        </ThemedText>

        <SettingsSection>
          <SettingsRow
            testID="gesture-trace.record"
            label="Record"
            description="Turn on, do the swipe that misbehaves, come back here, Share."
            right={
              <ThemedSwitch
                value={enabled}
                onValueChange={(v) => {
                  // Starting a recording clears the old one — a trace is only readable if it covers
                  // one attempt, and the common mistake is sharing three sessions stacked together.
                  if (v) clearGestureTrace();
                  gestureTrace$.enabled.set(v);
                }}
              />
            }
          />
        </SettingsSection>

        <View style={styles.actions}>
          <Pressable
            testID="gesture-trace.mark"
            onPress={() => markGestureTrace('mark')}
            disabled={!enabled}
            style={[styles.actionBtn, { borderColor: theme.hairline }]}>
            <ThemedText type="smallBold" style={!enabled && { color: theme.textSecondary }}>
              Mark
            </ThemedText>
          </Pressable>
          <Pressable
            testID="gesture-trace.share"
            onPress={shareLog}
            disabled={lines.length === 0}
            style={[styles.actionBtn, { borderColor: theme.hairline }]}>
            <ThemedText type="smallBold" style={lines.length === 0 && { color: theme.textSecondary }}>
              Share
            </ThemedText>
          </Pressable>
          <Pressable
            testID="gesture-trace.clear"
            onPress={clearGestureTrace}
            disabled={lines.length === 0}
            style={[styles.actionBtn, { borderColor: theme.hairline }]}>
            <ThemedText
              type="smallBold"
              style={lines.length === 0 ? { color: theme.textSecondary } : { color: theme.danger }}>
              Clear
            </ThemedText>
          </Pressable>
        </View>

        {frames.frames > 0 && (
          <ThemedText type="small" style={[styles.mono, { color: theme.textSecondary }]} selectable>
            {`frames ${frames.frames}  dropped ${frames.long}  mean ${frames.meanMs.toFixed(1)}ms  worst ${frames.worstMs.toFixed(0)}ms`}
          </ThemedText>
        )}

        {lines.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {enabled ? 'Recording. Go do the swipe.' : 'Nothing recorded.'}
          </ThemedText>
        ) : (
          <ThemedView type="backgroundElement" style={[styles.log, { borderColor: theme.hairline }]}>
            {/* Horizontal scroll, not wrapping: a wrapped trace line loses the column alignment
                that makes a wall of numbers scannable in the first place. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <ThemedText type="small" style={styles.mono} selectable>
                {lines.join('\n')}
              </ThemedText>
            </ScrollView>
          </ThemedView>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  actionBtn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  log: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // A trace is columns of numbers — a proportional font makes it unreadable at a glance.
  mono: {
    fontFamily: Fonts?.mono,
    fontSize: 11,
    lineHeight: 15,
  },
});
