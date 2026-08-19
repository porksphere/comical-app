import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** One pinnable section: the row key of its header (so the list can hide the heading the pill is
 *  standing in for), its label, an optional count, and the CONTENT offset its header row starts at
 *  (contentOffset 0 = the top of the list's padding). */
export type StickySection = { key: string; label: string; count?: number; top: number };

/** The band the pills live in — purely the distance the push-out slides, comfortably clear of a
 *  pill's own height. The pill sits at the band's TOP (not centred in it), so `stickyTop` is the
 *  pill's top edge exactly: the gap written at the call site is the gap on screen, with no hidden
 *  centring slack between the two. */
const PILL_BAND_HEIGHT = 36;
/** Quick, deliberately: the pill is replacing a heading that is right there, so a slow fade reads
 *  as a lag rather than a transition. */
const PILL_FADE_MS = 140;

/**
 * A floating PILL — the pinned heading's presentation. Pure black with white content, so it reads
 * over whatever is scrolling underneath without needing a band, a fill or a rule behind it.
 * Deliberately unthemed (the same call the reader chrome makes): this is chrome floating over
 * content, not a surface in the page.
 */
export function StickyPill({ children }: { children: ReactNode }) {
  return <View style={styles.pill}>{children}</View>;
}

/** The pill's label, in the one type both surfaces use — pills read as one family across Browse,
 *  the library and a collection, whatever the heading they came from is set in. */
export function StickyPillText({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="smallBold" numberOfLines={1} style={styles.pillText}>
      {children}
    </ThemedText>
  );
}

/**
 * THE sticky section heading — the pinned PILLS both grouped surfaces (library/collected grids)
 * and the Browse feed float over their lists. An overlay rather than a list feature because
 * list-level sticky rows pin to the scroll viewport's top edge, which on these screens is UNDER
 * the translucent top bar; this pins at the bar's bottom edge instead — and, where the bar itself
 * slides (`barOffset`, Browse), rides it.
 *
 * It is a PILL, not a copy of the heading in place. A full-width band — with a fill, or without
 * one — was tried first and read as a bar appearing over the list; a pill floating at the bar's
 * edge reads as chrome, which is what it is. It follows that the pinned thing and the inline
 * heading are now DIFFERENT presentations, so the surface hides the heading the pill stands in for
 * (`onActiveChange` → the caller drops that row's content): at the pin line the two are exactly
 * superimposed, and two copies of one title cross-fading over each other was the whole reason a
 * fill was there in the first place.
 *
 * ── Why it never pops ──
 * It stays MOUNTED while the list has sections, and its visibility is an opacity driven by a
 * UI-thread reaction on the same arithmetic. Mounting on the JS state's boundary report made the
 * pill appear a frame late, i.e. after the heading it replaces had already gone under the bar.
 * Mounted, with its label held at the first section while nothing is pinned, the appearance is a
 * fade that starts on the exact frame the line is crossed.
 *
 * The label itself is JS state and can lag the UI thread by a frame during a fling, so the
 * push-out ride — the next section's heading shoving the pinned pill up — only animates while both
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
  sidePad,
  resetKey,
  scrollOffset,
  barOffset,
  onActiveChange,
  renderPills,
}: {
  /** Callers may extend `StickySection` with whatever `renderPills` needs (Browse threads each
   *  heading's See-all target through, so the pinned chevron stays live). */
  sections: S[];
  /** Screen-relative y where the pill pins — the top bar's bottom edge AT REST. */
  stickyTop: number;
  /** Horizontal inset for the pills — the same x the list's own content sits at. */
  sidePad: number;
  /** A scope change (sort/group/search/bridge switch) is a scroll-to-top moment — the pinned
   *  section resets with it rather than surviving into the new scope. */
  resetKey: string;
  /** The list's UI-thread scroll offset (the same one the tab bar slides off). */
  scrollOffset: SharedValue<number>;
  /** The top bar's own translateY (0 visible → −barHeight hidden), where the bar slides with the
   *  scroll (Browse). The pin line and the pinned pill both ride it. */
  barOffset?: SharedValue<number>;
  /** The row key of the heading the pill currently stands in for (null = none). The caller hides
   *  that row's content, so the pill never duplicates the heading it replaced. */
  onActiveChange?: (key: string | null) => void;
  /** The pill row's content — typically a title pill, and a count pill pushed to the right. */
  renderPills: (section: S) => ReactElement;
}) {
  // WHICH section is pinned — JS state, changed only at boundaries. -1 = none (the list is above
  // the first heading), which the opacity below renders as invisible rather than as an unmount.
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

  // The fade, driven from the same arithmetic so it STARTS on the frame the line is crossed rather
  // than on the JS report that follows it. A label swap mid-scroll doesn't re-fade — this tracks
  // "is anything pinned", which stays true across a boundary.
  const shown = useSharedValue(0);
  useAnimatedReaction(
    () => {
      if (sections.length === 0) return false;
      const line = scrollOffset.value + stickyTop + (barOffset?.value ?? 0);
      return sections[0]!.top <= line;
    },
    (visible, was) => {
      if (visible !== was) shown.value = withTiming(visible ? 1 : 0, { duration: PILL_FADE_MS });
    },
    [sections, stickyTop, scrollOffset, barOffset],
  );

  // Visibility + the ride on the bar's slide, so the pill stays glued to the bar's bottom edge.
  const bandStyle = useAnimatedStyle(
    () => ({ opacity: shown.value, transform: [{ translateY: barOffset?.value ?? 0 }] }),
    [barOffset],
  );

  // The push-out ride, with the two-thread agree-guard (see the doc).
  const pushStyle = useAnimatedStyle(() => {
    if (sections.length === 0) return { transform: [{ translateY: 0 }] };
    const line = scrollOffset.value + stickyTop + (barOffset?.value ?? 0);
    let idx = -1;
    for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
    if (idx !== active) {
      return { transform: [{ translateY: idx > active ? -PILL_BAND_HEIGHT : 0 }] };
    }
    const next = sections[idx + 1];
    const push = next ? Math.min(0, next.top - line - PILL_BAND_HEIGHT) : 0;
    return { transform: [{ translateY: Math.max(push, -PILL_BAND_HEIGHT) }] };
  }, [sections, stickyTop, scrollOffset, barOffset, active]);

  // The pill to draw. Held at the first section while nothing is pinned (`active` −1) rather than
  // rendered empty: the band is transparent then, and having the content already in place is what
  // lets the fade be the whole appearance — no mount, no lag, no jump.
  const section = sections[active >= 0 ? active : 0];
  if (!section) return null;

  return (
    // The CLIP at the pin line: the push-out translates the pill up, and the clip is what cuts it
    // off at the bar's edge instead of letting it slide over the bar. `box-none` both levels so
    // pressables inside a pill (Browse's See-all) take their taps while everything else falls
    // through to the list — and 'none' while nothing is pinned, so an invisible pill can never
    // intercept a tap meant for the content under it.
    <Animated.View
      pointerEvents={active >= 0 ? 'box-none' : 'none'}
      style={[styles.clip, { top: stickyTop, height: PILL_BAND_HEIGHT }, bandStyle]}>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.pillRow, { height: PILL_BAND_HEIGHT, paddingHorizontal: sidePad }, pushStyle]}>
        {renderPills(section)}
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
  pillRow: {
    flexDirection: 'row',
    // TOP, not centre — see PILL_BAND_HEIGHT.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    // Pure black, unthemed — chrome floating over content (see StickyPill).
    backgroundColor: '#000',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one - 2,
    borderRadius: 999,
    // A long title ellipsizes inside its pill rather than pushing the count pill off the row.
    flexShrink: 1,
  },
  pillText: {
    color: '#fff',
    flexShrink: 1,
  },
});
