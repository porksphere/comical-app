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
 * Where the band sits for a given scroll line: 0 at rest, down to −`bandHeight` fully pushed out by
 * the next heading. The ride and the rule both read THIS rather than each recomputing it, so the
 * rule can't disagree with where the band actually is.
 *
 * `shown` is the section being drawn, and a disagreement with the scroll's own `idx` means the JS
 * label is lagging the UI thread mid-fling: a heading the scroll has passed holds fully pushed out,
 * one it has backed up behind holds at rest, until the text catches up. Without that guard the
 * label visibly spasms through a fast fling.
 */
function pushOffset(sections: StickySection[], shown: number, line: number, bandHeight: number) {
  'worklet';
  if (sections.length === 0) return 0;
  let idx = -1;
  for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
  if (idx !== shown) return idx > shown ? -bandHeight : 0;
  const next = sections[idx + 1];
  if (!next) return 0;
  return Math.max(Math.min(0, next.top - line - bandHeight), -bandHeight);
}

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
 * The RULE belongs to the heading it underlines, and there are TWO of them — one per heading in a
 * hand-off, traded on a single frame, exactly like the bar's. The pinned heading's rides inside the
 * band and switches OFF the instant that heading starts moving; the superseding heading's switches
 * ON at the same instant, tracks that heading up (it is a list row, so it lives outside the clip),
 * and lands precisely where the pinned one reappears at the swap. So a heading is never underlined
 * while it is leaving, one is never left bare while it arrives, and no hairline is ever seen
 * sliding up the chrome. Both come off `pushOffset`, so neither can disagree with the band.
 *
 * They are hairline VIEWS, not borders on the band or the clip. A border on the band's own box is
 * painted under the band's opaque fill on iOS, so it only showed through the gap a push-out opened
 * — a rule visible exactly when it should be hidden.
 *
 * `pinnedValue` publishes "something is pinned" as a shared value so the top bar can drop its OWN
 * rule on the very frame this one appears — the two sit a band apart and would otherwise stack into
 * a banded edge. It is a shared value rather than the JS callback for exactly that reason: routed
 * through React state the bar's rule left a frame or two after this one arrived, which is two rules
 * for two frames, every time.
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
 * The label is JS state and can lag the UI thread by a frame during a fling, so the push-out ride
 * runs through a two-thread agree-guard — see `pushOffset`. It guards against the DRAWN section,
 * not against `active`: those differ on the very first pin (`active` is still −1 where the drawn
 * one is already 0), and treating that as a disagreement made the band, rule included, arrive a JS
 * frame after the heading it was replacing had gone under the bar.
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
  pinnedValue,
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
  /** Written on the UI thread: 1 while a heading is pinned, 0 otherwise. The screen drops its top
   *  bar's rule off this, on the same frame — see the doc. */
  pinnedValue?: SharedValue<number>;
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
      if (visible === was) return;
      pinned.set(visible ? 1 : 0);
      // The top bar's rule goes out on the SAME worklet frame this one comes in — see the doc.
      pinnedValue?.set(visible ? 1 : 0);
    },
    [sections, pinLine, scrollOffset, barOffset, pinnedValue],
  );
  // Hand the bar its rule back on the way out. A screen's shared value outlives this component (the
  // Library's is shared by two surfaces, and either can go away pinned — group-by → None drops the
  // sticky entirely), so leaving it at 1 would leave that screen's bar ruleless with nothing left to
  // clear it.
  useEffect(() => () => pinnedValue?.set(0), [pinnedValue]);

  // Visibility + the ride on the bar's slide, so the heading stays glued to the bar's bottom edge.
  const bandStyle = useAnimatedStyle(
    () => ({ opacity: pinned.value, transform: [{ translateY: barOffset?.value ?? 0 }] }),
    [barOffset],
  );

  // The section actually being DRAWN. `active` −1 (nothing pinned yet) still draws the first one —
  // the band is invisible then, and having the content already in place is what lets the visibility
  // flip be the whole appearance: no mount, no lag, no jump. Everything below compares against this
  // rather than against `active`, which is the difference between the first pin landing at rest and
  // it landing pushed-out: at the moment `pinned` flips, `idx` is 0 while `active` is still −1, and
  // the agree-guard read that disagreement as "the heading has left" — so the whole band, rule
  // included, arrived a JS frame late.
  const shown = active >= 0 ? active : 0;

  // The push-out ride, with the two-thread agree-guard (see the doc). The rule reads this too, so
  // it can never disagree with where the band actually is.
  const pushStyle = useAnimatedStyle(() => {
    const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
    return { transform: [{ translateY: pushOffset(sections, shown, line, bandHeight) }] };
  }, [sections, pinLine, scrollOffset, barOffset, shown, bandHeight]);

  // The rule, ON the band and hard-switched: it belongs to the heading it underlines, so it rides
  // up with it — but it is off the instant that heading starts moving, and on again the instant one
  // is at rest. So a hand-off reads as the outgoing rule going out and the incoming one coming in,
  // never as a hairline sliding up the chrome. Its own view, not a border on the band, because the
  // band's opaque fill is drawn over its own border box on iOS — a border there is only visible
  // through the gap a push-out opens, which is exactly backwards.
  const ruleStyle = useAnimatedStyle(() => {
    const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
    return { opacity: pushOffset(sections, shown, line, bandHeight) < 0 ? 0 : 1 };
  }, [sections, pinLine, scrollOffset, barOffset, shown, bandHeight]);

  // The SUPERSEDING heading's rule — the other half of the hand-off. The heading pushing this one
  // out is the list's own inline row, one band below the clip's bottom edge and rising, so its rule
  // can't live in the clip: it's a second hairline, unclipped, tracking that row. It comes on at the
  // exact push the pinned one goes off at (both off `pushOffset`), rides up with the row, and lands
  // precisely where the pinned rule reappears at the swap — so across a hand-off there is always a
  // rule under a heading, never a gap and never two under one heading.
  //
  // Its offset is `2·bandHeight + push` below `stickyTop` because two consecutive bands are exactly
  // one bandHeight apart. The `barOffset` term cancels the one inside `line`, which is what makes
  // this track the SCROLL (a list row doesn't ride the sliding bar) while the pinned band does.
  const nextRuleStyle = useAnimatedStyle(() => {
    const bar = barOffset?.value ?? 0;
    const push = pushOffset(sections, shown, scrollOffset.value + pinLine + bar, bandHeight);
    return {
      opacity: push < 0 ? pinned.value : 0,
      transform: [{ translateY: bandHeight * 2 + push + bar }],
    };
  }, [sections, pinLine, scrollOffset, barOffset, shown, bandHeight]);

  const section = sections[shown];
  if (!section) return null;

  return (
    <>
      {/* The CLIP at the pin line: the push-out translates the heading up, and the clip is what
          cuts it off at the bar's edge instead of letting it slide over the bar. `box-none` so
          pressables inside the heading (Browse's See-all) take their taps while everything else
          falls through to the list — and 'none' while nothing is pinned, so an invisible heading
          can never intercept a tap meant for the content under it. */}
      <Animated.View
        pointerEvents={active >= 0 ? 'box-none' : 'none'}
        style={[styles.clip, { top: stickyTop, height: bandHeight }, bandStyle]}>
        {/* The BAND — the page's own background (so the heading stays legible over whatever scrolls
            beneath it), the heading, and the rule under it — is the pushed element, so all three
            move together. */}
        <Animated.View
          pointerEvents="box-none"
          style={[{ height: bandHeight, backgroundColor: theme.background }, pushStyle]}>
          <View
            pointerEvents="box-none"
            style={{ height: contentHeight, marginTop: bandPadding, paddingHorizontal: sidePad }}>
            {renderHeader(section)}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[styles.rule, { backgroundColor: theme.barHairline }, ruleStyle]}
          />
        </Animated.View>
      </Animated.View>
      {/* The superseding heading's rule — outside the clip, because the heading it belongs to is
          the list's own row, below the clip and rising. See `nextRuleStyle`. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.nextRule, { top: stickyTop, backgroundColor: theme.barHairline }, nextRuleStyle]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  rule: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  // The superseding heading's rule is positioned from the TOP (it tracks a scrolling row) and is
  // NOT inside the clip, so it can be drawn below the clip's bottom edge — see `nextRuleStyle`.
  nextRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
});
