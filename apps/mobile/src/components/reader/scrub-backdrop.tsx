import { StyleSheet, TextInput } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { PAGED_BACKDROP } from '@/components/reader/reader-page';
import { Skeleton } from '@/components/skeleton';
import { Spacing } from '@/constants/theme';

// What a scrub sees where the list has nothing.
//
// A virtualized list draws NOTHING where it hasn't mounted a cell, and a scrub is the one gesture
// that can outrun mounting by a wide margin — the scroll is driven on the UI thread and the cells
// are built on the JS one, so a fast drag crosses pages faster than they can be made. What showed
// through was the reader's own base tone: a flat dark rectangle, with none of the page-number
// feedback the placeholder inside a real cell provides, which reads as the reader having gone
// black rather than as pages going past.
//
// So this sits BEHIND the list and paints exactly what a mounted-but-unloaded page paints — the
// same tint, the same shimmer, the same "Page N" line — for whichever page the scrub is over. A
// cell that does exist covers it completely, so it is only ever seen in the gaps, which is the
// only place it is wanted.
//
// It costs no JS renders, deliberately. Everything here reads the scrub's own shared value on the
// UI thread: the page number goes through an animated `text` prop (the one way to write text from a
// worklet), so a drag across two hundred pages is two hundred UI-thread updates and not one React
// commit. Driving it from the throttled `onScrubPage` hop instead would have put a re-render of the
// whole reader on the same thread that owes the list its cells — the exact contention that opens
// the gaps this is filling.
//
// NOT a permanent fill, which is the distinction that makes it safe to live inside the pager: the
// reason a full-screen backdrop was taken OUT of this subtree is that the subtree translates and
// scales during a swipe-away, so anything opaque in it rides along with the receding page. This is
// transparent unless a scrub is in progress, and a scrub and the dismiss gesture are mutually
// exclusive (the reader disables the dismiss while the scrubber is held).

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export function ScrubBackdrop({
  target,
  pageNumbers,
  width,
  height,
}: {
  /** The scrub's live position as an index into the pager's data — negative when not scrubbing.
   *  The same shared value the pager's scroll reaction reads, so the two cannot disagree. */
  target: SharedValue<number>;
  /** Each page's DISPLAY number, by the same index — the pager's items carry a per-chapter number
   *  that isn't the index (a stitched window restarts at 1 per chapter). A plain array so the
   *  worklet can index it without a hop. */
  pageNumbers: number[];
  width: number;
  height: number;
}) {
  const style = useAnimatedStyle(() => ({ opacity: target.value < 0 ? 0 : 1 }));

  // `defaultValue` alongside `text` is the documented shape for writing a TextInput from a worklet
  // — `text` alone leaves the very first frame blank.
  const animatedProps = useAnimatedProps(() => {
    const at = target.value;
    if (at < 0 || pageNumbers.length === 0) return { text: '', defaultValue: '' };
    const index = Math.min(pageNumbers.length - 1, Math.max(0, Math.round(at)));
    const label = `Page ${pageNumbers[index]}`;
    return { text: label, defaultValue: label };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.fill, { width, height }, style]}>
      <Skeleton style={StyleSheet.absoluteFill} />
      <AnimatedTextInput
        // Not interactive in any sense — this is a Text that a worklet can write to. `editable` off
        // and no pointer events keep it out of the touch and accessibility trees entirely.
        editable={false}
        pointerEvents="none"
        accessible={false}
        underlineColorAndroid="transparent"
        defaultValue=""
        style={styles.page}
        animatedProps={animatedProps}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // PAGED_BACKDROP under PAGE_SURFACE is the composite an unloaded page shows over the reader's
  // base tone — the point being that a gap and a mounted-but-unloaded page are indistinguishable.
  fill: {
    backgroundColor: PAGED_BACKDROP,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  page: {
    // Matches ReaderPage's `placeholderPage`, with the padding a TextInput brings by default taken
    // back off so the line sits where a Text would.
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    padding: 0,
  },
});
