import { useState, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

/** One pinnable section: its label (plus whatever the caller's `renderHeader` reads off it) and the
 *  CONTENT offset its header row starts at (contentOffset 0 = the top of the list's padding). */
export type StickySection = { label: string; count?: number; top: number };

/**
 * THE sticky section header — the pinned heading both grouped surfaces (library/collected grids)
 * and the Browse feed render over their lists. An overlay rather than a list feature because
 * list-level sticky rows pin to the scroll viewport's top edge, which on these screens is UNDER
 * the translucent top bar; this pins at the bar's bottom edge instead — and, where the bar itself
 * slides (`barOffset`, Browse), rides it.
 *
 * It draws NOTHING of its own: no fill, no rule — just the caller's heading content, so a pinned
 * heading reads as the same heading holding its place rather than a bar appearing over the list.
 * (It had both for a moment; a solid band announcing itself was worse than the overlap it fixed.)
 *
 * ── Why it never pops ──
 * Two rules, both learned from the first device pass:
 *
 * · The band's height must be the inline heading's CONTENT height exactly (`height`), and the
 *   content must fill it rather than being centred in it. Forcing a taller band and centring put
 *   the pinned copy 2px below the inline one on compact — a visible vertical jump at the hand-off.
 * · It stays MOUNTED while the list has sections, and its visibility is an animated opacity
 *   computed on the UI thread from the same arithmetic. Mounting on the JS state's boundary report
 *   made the heading appear a frame late, i.e. after the inline one had already gone under the
 *   bar. Mounted-and-transparent, it becomes visible on the exact frame the line is crossed.
 *
 * The label itself is JS state and can lag the UI thread by a frame during a fling, so the
 * push-out ride — the next section's heading shoving the pinned one up — only animates while both
 * threads agree on the section: a label the scroll has passed holds fully pushed out, one the
 * scroll backed up behind holds at rest, until the text catches up (the fix for the label visibly
 * spasming through a fast fling).
 *
 * The reaction deliberately ignores its INITIAL report (prev === null): the scroll shared value
 * only updates on scroll events, so right after a remount it can still hold the previous scope's
 * offset — acting on it would pin a section on a list that is actually at its top. The caller
 * resets `active` through `resetKey`; the first real scroll event re-derives the truth.
 */
export function StickySectionHeader<S extends StickySection>({
  sections,
  stickyTop,
  height,
  sidePad,
  resetKey,
  scrollOffset,
  barOffset,
  renderHeader,
}: {
  /** Callers may extend `StickySection` with whatever `renderHeader` needs (Browse threads each
   *  heading's See-all target through, so the pinned chevron stays live). */
  sections: S[];
  /** Screen-relative y where the heading pins — the top bar's bottom edge AT REST. */
  stickyTop: number;
  /** The pinned heading's height — must equal the INLINE heading's content height (see above),
   *  since the push-out slides exactly one of them out as the next slides in. */
  height: number;
  /** Matches the list's horizontal content padding so the pinned copy aligns with the inline rows.
   *  Pass only what the list container carries — content that self-pads a gutter must not be
   *  padded twice (that shoved the pinned copy a full gutter right of the inline one). */
  sidePad: number;
  /** A scope change (sort/group/search/bridge switch) is a scroll-to-top moment — the pinned
   *  section resets with it rather than surviving into the new scope. */
  resetKey: string;
  /** The list's UI-thread scroll offset (the same one the tab bar slides off). */
  scrollOffset: SharedValue<number>;
  /** The top bar's own translateY (0 visible → −barHeight hidden), where the bar slides with the
   *  scroll (Browse). The pin line and the pinned heading both ride it. */
  barOffset?: SharedValue<number>;
  /** The pinned heading's content — render the SAME component the inline header row uses, so the
   *  hand-off at the pin line is pixel-identical. Pressables inside stay LIVE (the overlay passes
   *  touches through everywhere else): a pinned heading that shows a control must honor it. */
  renderHeader: (section: S) => ReactElement;
}) {
  // WHICH section is pinned — JS state, changed only at boundaries. -1 = none (the list is above
  // the first heading), which the opacity below renders as invisible rather than as an unmount.
  const [active, setActive] = useState(-1);
  const [seenReset, setSeenReset] = useState(resetKey);
  if (seenReset !== resetKey) {
    setSeenReset(resetKey);
    setActive(-1);
  }
  useAnimatedReaction(
    () => {
      if (sections.length === 0) return -1;
      const line = scrollOffset.value + stickyTop + (barOffset?.value ?? 0);
      let idx = -1;
      for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
      return idx;
    },
    (idx, prev) => {
      // Skip the initial report — see the component doc (a remount's stale scroll offset).
      if (prev === null) return;
      if (idx !== prev) runOnJS(setActive)(idx);
    },
    [sections, stickyTop, scrollOffset, barOffset],
  );

  // Visible exactly while a heading is actually past the line — computed here, not from `active`,
  // so appearing and disappearing land on the frame the line is crossed (see the doc). The pin
  // position rides the bar's slide, so the heading stays glued to the bar's bottom edge.
  const bandStyle = useAnimatedStyle(() => {
    let idx = -1;
    if (sections.length > 0) {
      const line = scrollOffset.value + stickyTop + (barOffset?.value ?? 0);
      for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
    }
    return { opacity: idx >= 0 ? 1 : 0, transform: [{ translateY: barOffset?.value ?? 0 }] };
  }, [sections, stickyTop, scrollOffset, barOffset]);

  // The push-out ride, with the two-thread agree-guard (see the doc).
  const pushStyle = useAnimatedStyle(() => {
    if (sections.length === 0) return { transform: [{ translateY: 0 }] };
    const line = scrollOffset.value + stickyTop + (barOffset?.value ?? 0);
    let idx = -1;
    for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
    if (idx !== active) {
      return { transform: [{ translateY: idx > active ? -height : 0 }] };
    }
    const next = sections[idx + 1];
    const push = next ? Math.min(0, next.top - line - height) : 0;
    return { transform: [{ translateY: Math.max(push, -height) }] };
  }, [sections, stickyTop, scrollOffset, barOffset, active, height]);

  // The label to draw. Held at the first section while nothing is pinned (`active` −1) rather than
  // rendered empty: the band is transparent then, and having the content already in place is what
  // lets the opacity flip be the whole appearance — no mount, no lag, no jump.
  const section = sections[active >= 0 ? active : 0];
  if (!section) return null;

  return (
    // The CLIP at the pin line: the push-out translates the heading up, and the clip is what cuts
    // it off at the bar's edge instead of letting it slide up over the bar. `box-none` both levels
    // so pressables inside the heading (Browse's See-all chevron) take their taps while everything
    // else falls through to the list — and 'none' while nothing is pinned, so an invisible heading
    // can never intercept a tap meant for the content under it.
    <Animated.View
      pointerEvents={active >= 0 ? 'box-none' : 'none'}
      style={[styles.clip, { top: stickyTop, height }, bandStyle]}>
      <Animated.View pointerEvents="box-none" style={[{ height, paddingHorizontal: sidePad }, pushStyle]}>
        {renderHeader(section)}
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
});
