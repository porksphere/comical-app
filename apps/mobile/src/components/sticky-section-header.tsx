import { useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/** One pinnable section: the row key of its header (so the list can hide the heading the pinned
 *  copy is standing in for), its label, an optional count, and the CONTENT offset its header ROW
 *  starts at (contentOffset 0 = the top of the list's padding). */
export type StickySection = { key: string; label: string; count?: number; top: number };

/**
 * THE sticky section heading — the pinned heading both grouped surfaces (library/collected grids)
 * and the Browse feed hold at the top of their lists. An overlay rather than a list feature
 * because list-level sticky rows pin to the scroll viewport's top edge, which on these screens is
 * UNDER the translucent top bar; this pins at the bar's bottom edge instead — and, where the bar
 * itself slides (`barOffset`, Browse), rides it.
 *
 * ── The pinned thing IS the heading ──
 * `renderHeader` renders the same row the list renders inline, and the caller reports which row
 * that is (`onActiveChange`) so the list can hide it while this stands in. Same component, same
 * type, same size, same x, same y — nothing is re-styled, re-sized or re-aligned, so nothing can
 * drift out of alignment with the thing it replaces.
 *
 * That is not a preference, it is the convention: iOS pins the header itself and fades a MATERIAL
 * in behind it (Photos does exactly this; `.listStyle(.plain)` did it for free through iOS 18), and
 * the floating-pill treatment belongs to surfaces whose separator is a pill inline as well
 * (WhatsApp's date bubble). This tried the in-between — a heading morphing into a differently
 * styled chip — and every mismatch it produced (type size, then baseline, then gutter) had to be
 * hand-corrected, because no convention was keeping them the same. Rendering one component in two
 * places keeps them the same by construction.
 *
 * So the SURFACE is the only thing this component contributes, and only while pinned: the page's
 * own background plus a bottom hairline, so the heading stays legible over whatever scrolls beneath
 * it and reads as chrome sitting on the list. NOTHING here fades — surface and heading appear
 * together, on the frame the line is crossed. A fade breaks the illusion: the whole trick is that
 * an identical, co-located heading is being swapped for this one, and anything that ramps announces
 * that a second object arrived.
 *
 * ── The band's own padding, and where the pin line goes ──
 * The band is `bandPadding` above and below the heading. That padding is the BAND's rather than the
 * caller's row because an inline heading's vertical rhythm can be deliberately lopsided (Browse's
 * is — a hairline of space above, a full gap below, so sections sit tight while each heading keeps
 * room over its own cards), which is invisible until you draw a surface around it and then reads as
 * a header sagging in its box.
 *
 * The padding therefore moves the PIN LINE down (`stickyTop + bandPadding`) rather than moving the
 * band up. Both keep the heading landing where the inline one was, but only this one is visible:
 * a band that starts above `stickyTop` starts underneath the top bar, which is opaque and drawn
 * over it — so its top padding is simply eaten, and the heading reads flush to the bar with a full
 * gap beneath it. The band starts AT the bar's edge and the heading sits a padding below it.
 *
 * ── Why it never pops ──
 * It stays MOUNTED while the list has sections, and its visibility is driven by a UI-thread
 * reaction on the same arithmetic. Mounting on the JS state's boundary report made the heading
 * appear a frame late, i.e. after the inline one had already gone under the bar.
 *
 * The label is JS state and can lag the UI thread by a frame during a fling, so the push-out ride —
 * the next section's heading shoving the pinned one up — only animates while both threads agree on
 * the section: a label the scroll has passed holds fully pushed out, one the scroll backed up
 * behind holds at rest, until the text catches up (the fix for the label visibly spasming through
 * a fast fling).
 *
 * The reaction deliberately ignores its INITIAL report (prev === null): the scroll shared value
 * only updates on scroll events, so right after a remount it can still hold the previous scope's
 * offset — acting on it would pin a section on a list that is actually at its top. The caller
 * resets `active` through `resetKey`; the first real scroll event re-derives the truth.
 */
export function StickySectionHeader<S extends StickySection>({
  sections,
  stickyTop,
  contentHeight,
  bandPadding = 0,
  sidePad,
  resetKey,
  scrollOffset,
  barOffset,
  onActiveChange,
  renderHeader,
}: {
  /** Callers may extend `StickySection` with whatever `renderHeader` needs (Browse threads each
   *  heading's See-all target through, so the pinned chevron stays live). */
  sections: S[];
  /** Screen-relative y where the heading pins — the top bar's bottom edge AT REST. */
  stickyTop: number;
  /** The rendered heading's own height. With `bandPadding` it gives the band's height, which is
   *  what the push-out slides. */
  contentHeight: number;
  /** Symmetric space the BAND puts above and below the heading — see the doc. Default 0, for a
   *  heading whose own row already centres it (the grouped grids). */
  bandPadding?: number;
  /** The list's own horizontal content inset, so the pinned row sits at the same x as the inline
   *  one. Pass only what the list CONTAINER carries: content that self-pads a gutter (Browse's
   *  `SectionHead`) must not be padded twice. */
  sidePad: number;
  /** A scope change (sort/group/search/bridge switch) is a scroll-to-top moment — the pinned
   *  section resets with it rather than surviving into the new scope. */
  resetKey: string;
  /** The list's UI-thread scroll offset (the same one the tab bar slides off). */
  scrollOffset: SharedValue<number>;
  /** The top bar's own translateY (0 visible → −barHeight hidden), where the bar slides with the
   *  scroll (Browse). The pin line and the pinned heading both ride it. */
  barOffset?: SharedValue<number>;
  /** The row key of the heading being stood in for (null = none). The caller hides that row's
   *  content, so the pinned copy never doubles the heading it replaced. */
  onActiveChange?: (key: string | null) => void;
  /** The heading row — render the SAME element the list renders inline. */
  renderHeader: (section: S) => ReactElement;
}) {
  const theme = useTheme();
  const bandHeight = contentHeight + bandPadding * 2;
  // Where a heading has to reach to pin: the band's own top padding below the bar's edge, which is
  // exactly where the pinned copy draws its heading. See the doc.
  const pinLine = stickyTop + bandPadding;

  // WHICH section is pinned — JS state, changed only at boundaries. -1 = none (the list is above
  // the first heading), which the visibility below renders as invisible rather than as an unmount.
  const [active, setActive] = useState(-1);
  const [seenReset, setSeenReset] = useState(resetKey);
  if (seenReset !== resetKey) {
    setSeenReset(resetKey);
    setActive(-1);
  }
  const activeKey = active >= 0 ? (sections[active]?.key ?? null) : null;
  useEffect(() => {
    onActiveChange?.(activeKey);
  }, [onActiveChange, activeKey]);

  useAnimatedReaction(
    () => {
      if (sections.length === 0) return -1;
      const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
      let idx = -1;
      for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
      return idx;
    },
    (idx, prev) => {
      // Skip the initial report — see the component doc (a remount's stale scroll offset).
      if (prev === null) return;
      if (idx !== prev) runOnJS(setActive)(idx);
    },
    [sections, pinLine, scrollOffset, barOffset],
  );

  // Visibility, from the same arithmetic so it lands on the frame the line is crossed rather than
  // on the JS report that follows it. INSTANT for the heading: it is replacing an identical,
  // co-located heading, so a fade would only make the swap visible.
  const pinned = useSharedValue(0);
  useAnimatedReaction(
    () => {
      if (sections.length === 0) return false;
      const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
      return sections[0]!.top <= line;
    },
    (visible, was) => {
      if (visible !== was) pinned.value = visible ? 1 : 0;
    },
    [sections, stickyTop, scrollOffset, barOffset],
  );
  // Visibility + the ride on the bar's slide, so the heading stays glued to the bar's bottom edge.
  const bandStyle = useAnimatedStyle(
    () => ({ opacity: pinned.value, transform: [{ translateY: barOffset?.value ?? 0 }] }),
    [barOffset],
  );
  // The push-out ride, with the two-thread agree-guard (see the doc).
  const pushStyle = useAnimatedStyle(() => {
    if (sections.length === 0) return { transform: [{ translateY: 0 }] };
    const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
    let idx = -1;
    for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
    if (idx !== active) {
      return { transform: [{ translateY: idx > active ? -bandHeight : 0 }] };
    }
    const next = sections[idx + 1];
    const push = next ? Math.min(0, next.top - line - bandHeight) : 0;
    return { transform: [{ translateY: Math.max(push, -bandHeight) }] };
  }, [sections, pinLine, scrollOffset, barOffset, active, bandHeight]);

  // The heading to draw. Held at the first section while nothing is pinned (`active` −1) rather
  // than rendered empty: the band is invisible then, and having the content already in place is
  // what lets the visibility flip be the whole appearance — no mount, no lag, no jump.
  const section = sections[active >= 0 ? active : 0];
  if (!section) return null;

  return (
    // The CLIP at the pin line: the push-out translates the heading up, and the clip is what cuts
    // it off at the bar's edge instead of letting it slide over the bar. `box-none` so pressables
    // inside the heading (Browse's See-all) take their taps while everything else falls through to
    // the list — and 'none' while nothing is pinned, so an invisible heading can never intercept a
    // tap meant for the content under it.
    <Animated.View
      pointerEvents={active >= 0 ? 'box-none' : 'none'}
      style={[styles.clip, { top: stickyTop, height: bandHeight }, bandStyle]}>
      {/* The surface — the page's own background plus the hairline that marks it off from the
          content sliding under it — is the pushed element itself, so the rule leaves with the
          heading it belongs to instead of hanging under the one arriving. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.surface,
          { height: bandHeight, backgroundColor: theme.background, borderBottomColor: theme.barHairline },
          pushStyle,
        ]}>
        <View
          pointerEvents="box-none"
          style={{ height: contentHeight, marginTop: bandPadding, paddingHorizontal: sidePad }}>
          {renderHeader(section)}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  surface: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
