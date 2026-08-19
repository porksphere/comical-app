import { useState, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/** One pinnable section: its label (plus whatever the caller's `renderHeader` reads off it) and the
 *  CONTENT offset its header row starts at (contentOffset 0 = the top of the list's padding). */
export type StickySection = { label: string; count?: number; top: number };

/**
 * THE sticky section header — the pinned overlay both grouped surfaces (library/collected grids)
 * and the Browse feed render over their lists. An overlay rather than a list feature because
 * list-level sticky rows pin to the scroll viewport's top edge, which on these screens is UNDER
 * the translucent top bar; this pins at the bar's bottom edge instead — and, where the bar itself
 * slides (`barOffset`, Browse), rides it.
 *
 * Mechanics: section offsets are precomputed by the caller (fixed row heights make them exact), so
 * the current section is pure arithmetic on the UI-thread scroll offset. A reaction reports
 * boundary CROSSINGS to JS (which swaps the label); the push-out ride — the next section's inline
 * header shoving the pinned one up — is an animated style on the same values, so it tracks the
 * finger exactly. The label is JS state and can lag the UI thread by a frame during a fling, so
 * the push only animates when both threads agree on the section — a label the scroll has passed
 * holds fully pushed out, one the scroll backed up behind holds at rest, until the text catches
 * up (the fix for the label visibly spasming through a fast fling).
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
  /** Screen-relative y where the header pins — the top bar's bottom edge AT REST. */
  stickyTop: number;
  /** The pinned band's height — must match the inline header row's visible height, since the
   *  push-out slides exactly one band out as the next slides in. */
  height: number;
  /** Matches the list's horizontal content padding so the pinned copy aligns with the inline rows. */
  sidePad: number;
  /** A scope change (sort/group/search/bridge switch) is a scroll-to-top moment — the pinned
   *  section resets with it rather than surviving into the new scope. */
  resetKey: string;
  /** The list's UI-thread scroll offset (the same one the tab bar slides off). */
  scrollOffset: SharedValue<number>;
  /** The top bar's own translateY (0 visible → −barHeight hidden), where the bar slides with the
   *  scroll (Browse). The pin line and the pinned band both ride it. */
  barOffset?: SharedValue<number>;
  /** The pinned band's content — render the SAME component the inline header row uses, so the
   *  hand-off at the pin line is pixel-identical. Pressables inside stay LIVE (the overlay passes
   *  touches through everywhere else): a pinned heading that shows a control must honor it. */
  renderHeader: (section: S) => ReactElement;
}) {
  const theme = useTheme();

  // WHICH section is pinned — JS state, changed only at boundaries. -1 = none (at rest the first
  // inline header is still below the bar, and duplicating it there would read as two lists).
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

  // The pin position rides the bar's slide, so the band stays glued to the bar's bottom edge.
  const followBarStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: barOffset?.value ?? 0 }] }),
    [barOffset],
  );
  // The push-out ride, with the two-thread agree-guard (see the component doc).
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

  const section = active >= 0 ? sections[active] : undefined;
  if (!section) return null;

  return (
    // The CLIP at the pin line: the push-out translates the content up, and without the clip it
    // would slide visibly up behind the (translucent) top bar instead of disappearing under its
    // edge. The hairline sits on the clip (the band's bottom edge, same rule the bar surfaces
    // draw), so it holds still through the push-out instead of riding away with the label.
    // `box-none` both levels down: pressables inside renderHeader (Browse's See-all chevron) take
    // their taps; everywhere else the touch falls through to the list.
    <Animated.View
      pointerEvents="box-none"
      style={[styles.clip, { top: stickyTop, height, borderBottomColor: theme.hairline }, followBarStyle]}>
      <Animated.View
        pointerEvents="box-none"
        style={[{ height, backgroundColor: theme.background, paddingHorizontal: sidePad }, styles.center, pushStyle]}>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  center: {
    justifyContent: 'center',
  },
});
