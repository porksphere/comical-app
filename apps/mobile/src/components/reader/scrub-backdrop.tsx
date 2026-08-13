import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { PAGED_BACKDROP, PLACEHOLDER_STATUS_HEIGHT } from '@/components/reader/reader-page';
import { Skeleton } from '@/components/skeleton';
import { Spacing } from '@/constants/theme';

// The pages a scrub is passing over, where the list has not mounted them.
//
// A virtualized list draws NOTHING where it has no cell, and a scrub is the one gesture that can
// outrun mounting by a wide margin — the scroll is driven on the UI thread and the cells are built
// on the JS one. What showed through was the reader's own base tone: a flat dark rectangle, with
// none of the page-number feedback a real cell's placeholder gives, which reads as the reader
// having gone black rather than as pages going past.
//
// So this is a STRIP, not a label. It stands exactly where the missing cells would, one slot per
// page, each painting what a mounted-but-unloaded page paints — the same tint, the same shimmer,
// the same "Page N" — and it travels with the scroll at the same rate they would. A cell that does
// exist covers its slot completely, so the strip is only ever seen through the gaps between them,
// which is the whole idea: a scrub looks the same whether the list kept up or not.
//
// ── Why it lines up ─────────────────────────────────────────────────────────────────────────────
// The pager scrolls to `origin + index × width`, so the viewport's left edge sits at the left edge
// of the page it is over, and page `i` is on screen at `(i − position) × width`. Split the position
// into whole and fractional parts and the only two slots that can be visible are `floor(position)`
// and the one after it — drawn at 0 and `width` inside a strip translated by `−frac × width`. That
// is the same arithmetic the list is doing, which is why a slot and the cell that replaces it are
// never a pixel apart.
//
// All of it in PHYSICAL indices, which is what makes direction a non-issue: the pager reverses its
// data for RTL and scrolls to the flipped index, so once the flip is applied the strip runs the
// same way in both directions and nothing below needs to know which one it is in.
//
// ── Why it costs no renders ─────────────────────────────────────────────────────────────────────
// Everything here reads the scrub's own shared value on the UI thread, the page numbers included,
// through an animated `text` prop. Driving it from the throttled `onScrubPage` hop instead would
// have put a re-render of the whole reader on the same thread that owes the list its cells — the
// exact contention that opens the gaps this is filling.
//
// NOT a permanent fill, which is what makes it safe inside the pager: that subtree translates and
// scales during a swipe-away, so anything always-opaque in it would ride along with the receding
// page (a fill here used to, which is why the tint was moved out to the screen's static surface).
// This is transparent unless a scrub is in progress, and the reader disables the dismiss gesture
// while the scrubber is held, so the two can never be on screen together.

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** How many page slots the strip carries. Two can be visible at once — the page the viewport is
 *  straddling and the one after it — and that is all it ever draws. */
const SLOTS = 2;

/** Logical scrub target → the physical position the pager actually scrolls to. The pager's own
 *  reaction does the same flip; this has to agree with it or the strip runs backwards in RTL. */
function physicalAt(target: number, count: number, rtl: boolean): number {
  'worklet';
  const clamped = Math.max(0, Math.min(count - 1, target));
  return rtl ? count - 1 - clamped : clamped;
}

function Slot({
  target,
  pageNumbers,
  rtl,
  slot,
  width,
  height,
}: {
  target: SharedValue<number>;
  pageNumbers: number[];
  rtl: boolean;
  slot: number;
  width: number;
  height: number;
}) {
  const animatedProps = useAnimatedProps(() => {
    if (target.value < 0 || pageNumbers.length === 0) return { text: '', defaultValue: '' };
    const index = Math.floor(physicalAt(target.value, pageNumbers.length, rtl)) + slot;
    if (index < 0 || index >= pageNumbers.length) return { text: '', defaultValue: '' };
    const label = `Page ${pageNumbers[index]}`;
    return { text: label, defaultValue: label };
  });

  return (
    <View style={[styles.slot, { left: slot * width, width, height }]}>
      <Skeleton style={StyleSheet.absoluteFill} />
      <AnimatedTextInput
        // Not interactive in any sense — a Text that a worklet can write to. `editable` off and no
        // pointer events keep it out of the touch and accessibility trees entirely.
        editable={false}
        pointerEvents="none"
        accessible={false}
        underlineColorAndroid="transparent"
        defaultValue=""
        style={styles.page}
        animatedProps={animatedProps}
      />
      {/* The status row a real placeholder always reserves under its page line (the download
          percentage, which a scrub never has). Held open here too, or the number would sit a few
          points lower in a slot than in the cell that replaces it — which is exactly the tell that
          they are two different things. */}
      <View style={styles.status} />
    </View>
  );
}

export function ScrubBackdrop({
  target,
  pageNumbers,
  rtl,
  width,
  height,
}: {
  /** The scrub's live position as a LOGICAL index into the reader's pages; negative when idle. The
   *  same shared value the pager's scroll reaction reads, so the two cannot disagree. */
  target: SharedValue<number>;
  /** Display numbers by PHYSICAL index — a stitched window restarts at 1 per chapter, so the index
   *  is not the number. A plain array so the worklet can read it without a hop. */
  pageNumbers: number[];
  rtl: boolean;
  width: number;
  height: number;
}) {
  const stripStyle = useAnimatedStyle(() => {
    if (target.value < 0 || pageNumbers.length === 0) return { opacity: 0, transform: [{ translateX: 0 }] };
    const position = physicalAt(target.value, pageNumbers.length, rtl);
    // How far INTO the leading page the viewport has travelled. The strip slides back by that much,
    // which puts slot 0 exactly over that page and slot 1 over the next.
    return { opacity: 1, transform: [{ translateX: -(position - Math.floor(position)) * width }] };
  });

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, stripStyle]}>
      {Array.from({ length: SLOTS }, (_, slot) => (
        <Slot key={slot} target={target} pageNumbers={pageNumbers} rtl={rtl} slot={slot} width={width} height={height} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The tint belongs to the SLOTS, not to the strip that carries them. The strip is one viewport
  // wide and slides by up to a page, so a background on it would leave the trailing sliver of the
  // screen unpainted — precisely the black edge this exists to remove. Page-sized slots tile
  // instead, and two of them always cover the viewport however far the strip has slid.
  //
  // PAGED_BACKDROP is the composite an unloaded page shows over the reader's base tone, so a slot
  // and a mounted-but-unloaded page are indistinguishable.
  slot: {
    position: 'absolute',
    top: 0,
    backgroundColor: PAGED_BACKDROP,
    alignItems: 'center',
    justifyContent: 'center',
    // ReaderPage's placeholder stacks its two lines with this gap; matched so the page line lands
    // at the same height in both.
    gap: Spacing.one,
  },
  status: {
    height: PLACEHOLDER_STATUS_HEIGHT,
  },
  // ReaderPage draws this line as a <ThemedText> at its default type, coloured `placeholderPage`.
  // Matched field for field — a slot a hair off in size or weight is exactly the tell that there
  // are two different placeholders on screen, which is the thing being fixed. If ThemedText's
  // `default` type ever changes, this has to move with it.
  page: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    textAlign: 'center',
    // A TextInput brings insets and an Android font pad that a Text does not; both off, so the
    // line sits exactly where the Text's would.
    padding: 0,
    includeFontPadding: false,
  },
});
