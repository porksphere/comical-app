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

// ── Fast scrolling: DEFER the push rather than draw two frames of it ──
// Weight on the previous sample when smoothing the per-event scroll distance. A raw delta is noisy
// frame to frame, and the decision below reads it.
const SPEED_SMOOTHING = 0.6;
// Past this much scroll PER EVENT — as a fraction of a band — the push is deferred: the band holds
// at rest and the heading is simply replaced on the frame the next one reaches the pin line. A
// band's worth of push at this speed is over in about eight frames, which already reads as a flash
// of a half-drawn band rather than as motion, and it only gets worse from there. Deliberately low
// for that reason: the sliding push is what a SLOW scroll gets, not the default.
const SNAP_SPEED = 0.12;

/**
 * WHICH heading belongs at the pin line, and how far the band has been pushed out — both derived
 * from the scroll alone, on the UI thread, with no reference to React state beyond `shown`.
 *
 * `k` is the section the scroll says is pinned, clamped to `shown ± 1`. The clamp is the whole
 * design: the component pre-renders those three headings, so whichever one the scroll lands on is
 * ALREADY on screen and arrives by translation — no JS round trip on the visual path. A fling that
 * crosses several sections at once outruns the pre-render; the band hides for those frames rather
 * than showing a heading it knows is stale.
 *
 * `p` is 0 at rest, down to −`bandHeight` fully pushed out by the following heading — unless the
 * push is DEFERRED (`snapped`), in which case it stays 0 and the whole swap is `k` advancing on a
 * single frame. See `SNAP_SPEED`, and the latch that decides it.
 *
 * `atRest` is the band sitting at 0 with no crossing under way. It is where the latch is allowed to
 * change, and the only place the two behaviours are guaranteed to agree.
 */
function pinAt(
  sections: StickySection[],
  shown: number,
  line: number,
  bandHeight: number,
  /** Whether the push is currently deferred — see `SNAP_SPEED`. */
  snapped: boolean,
) {
  'worklet';
  if (sections.length === 0) return { k: shown, p: 0, outrun: false, atRest: true };
  let idx = 0;
  for (let i = 0; i < sections.length && sections[i]!.top <= line; i++) idx = i;
  const k = Math.max(0, Math.max(shown - 1, Math.min(shown + 1, idx)));
  const next = sections[k + 1];

  // Distance from the pin line to the heading coming up behind: ≥ a band is at rest, ≤ 0 fully out.
  const gap = next ? next.top - line : Infinity;
  // The plain sticky push while slow, and NOTHING while the push is deferred — the band holds at
  // rest, and `k` advancing on the frame the gap closes performs the whole swap. There is no
  // intermediate value in that mode to catch a frame of.
  const p = next && !snapped ? -bandHeight * Math.max(0, Math.min(1, 1 - gap / bandHeight)) : 0;
  // `outrun` means the pinned section is one this stack hasn't rendered — a fling crossing several
  // at once. The band HIDES for those frames rather than holding a neighbour at the pin line: a
  // heading that is merely absent for two frames reads as the list scrolling, where a confidently
  // drawn WRONG heading reads as a bug.
  return { k, p, outrun: k !== idx, atRest: gap >= bandHeight };
}

/** Whether ANY heading is pinned: the first section has reached the pin line. Both the band and the
 *  inline heading it stands in for read this — see `useInlineHeadingStyle`. */
function isPinned(firstTop: number | undefined, line: number) {
  'worklet';
  return firstTop !== undefined && firstTop <= line;
}

/** What an inline heading needs in order to work out, itself, whether the sticky is covering it. */
export type InlineHeadingPin = {
  /** `sections[0].top` — the offset the band appears at. */
  firstTop?: number;
  /** The band's `stickyTop` and `bandPadding`, which together give the pin line. */
  stickyTop?: number;
  bandPadding?: number;
  scrollOffset?: SharedValue<number>;
  barOffset?: SharedValue<number>;
};

/**
 * The inline heading's own visibility — the other half of `StickySectionHeader`.
 *
 * The list is told WHICH heading the pinned copy is standing in for through `onActiveChange`, which
 * is React state and therefore a frame or two behind the scroll. That lag is harmless in one
 * direction only. Scrolling DOWN the row hides late, while it is already under the top bar — either
 * way invisible. Scrolling back UP the band's opacity drops on the UI-thread frame the line is
 * crossed while the row is still hidden, and for those frames NEITHER heading is drawn. That is the
 * flash at the top of a feed.
 *
 * Only at the top. At every other boundary the band's own stack is already drawing the incoming
 * heading exactly where the hidden row sits — the pinned section renders at `p`, so its successor
 * renders at `p + bandHeight`, which is that row's position. Above the first section there is
 * nothing to hand over to, so there the opacity IS the whole transition.
 *
 * So the row ANDs the JS flag with the same UI-thread predicate the band uses, and comes back on the
 * very frame the band leaves. Deliberately re-derived from `scrollOffset` rather than read from the
 * shared value the band's reaction writes: Reanimated runs mappers in REGISTRATION order and does
 * not know that reaction's output, and list rows mount before the overlay below them — so reading it
 * would put the row a frame behind the band, which is the same gap one frame wide. Two mappers over
 * the same scroll offset cannot disagree at all.
 *
 * Hit-testing stays on the JS flag. A frame or two of the wrong answer can't be seen there: a hidden
 * heading is under the bar or under the pinned copy, both of which are drawn over it.
 */
export function useInlineHeadingStyle(hidden: boolean, pin?: InlineHeadingPin) {
  const { firstTop, stickyTop, bandPadding = 0, scrollOffset, barOffset } = pin ?? {};
  return useAnimatedStyle(() => {
    // Short-circuited before `scrollOffset` is read, so a heading that is not standing down has no
    // scroll dependency at all — the common case, and the one every row is in while scrolling.
    if (!hidden || firstTop === undefined || stickyTop === undefined || !scrollOffset) return { opacity: 1 };
    const line = scrollOffset.value + stickyTop + bandPadding + (barOffset?.value ?? 0);
    return { opacity: isPinned(firstTop, line) ? 0 : 1 };
  }, [hidden, firstTop, stickyTop, bandPadding, scrollOffset, barOffset]);
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
 * sliding up the chrome. Both come off `pinAt`, so neither can disagree with the band.
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
 * ── Why the ride never waits for JS ──
 * The label is React state, so a naive sticky puts a `runOnJS` round trip on the visual path of
 * every crossing — and during a fling that queues behind LegendList's row recycling, which is what
 * made this feel a beat slower than the sliding bars reading the very same `scrollOffset`.
 *
 * An earlier cut guarded the ride on JS agreeing (hold pushed-out until the label catches up),
 * which was correct and stalled. Instead the component renders THREE headings — `shown` and its
 * two neighbours — stacked a band apart with `shown` in the middle, and the UI thread simply
 * translates whichever one the scroll wants to the pin line. The neighbours sit outside the clip,
 * so they cost nothing visually until one arrives. `shown` re-bases afterwards, and because the
 * translate loses exactly the band it gains, the rendered position is identical either side of
 * that commit — a late update is invisible rather than a jump.
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

  // The OUTWARD signal only — the screen's top bar drops its own rule off this. The band's own
  // visibility is not routed through it but re-derived from the scroll in `bandStyle`, for the
  // reason `useInlineHeadingStyle` gives: a reaction's output reaches other mappers a frame later
  // depending on registration order, and everything that has to agree here agrees exactly when it
  // reads `scrollOffset` itself.
  useAnimatedReaction(
    () => isPinned(sections[0]?.top, scrollOffset.value + pinLine + (barOffset?.value ?? 0)),
    (visible, was) => {
      if (visible === was) return;
      // The top bar's rule goes out on the SAME worklet frame the band's comes in — see the doc.
      pinnedValue?.set(visible ? 1 : 0);
    },
    [sections, pinLine, scrollOffset, barOffset, pinnedValue],
  );
  // Hand the bar its rule back on the way out. A screen's shared value outlives this component (the
  // Library's is shared by two surfaces, and either can go away pinned — group-by → None drops the
  // sticky entirely), so leaving it at 1 would leave that screen's bar ruleless with nothing left to
  // clear it.
  useEffect(() => () => pinnedValue?.set(0), [pinnedValue]);

  // The section the stack is BASED on — the middle slot. `active` −1 (nothing pinned yet) still
  // bases on the first one, so the content is already in place and the visibility flip is the whole
  // appearance: no mount, no lag, no jump.
  //
  // The list hides this row and not whichever slot is momentarily at the pin line, which is safe
  // for the reason the whole design works: an arriving slot is pixel-aligned with the inline row it
  // is standing in for (same `scrollOffset`, same geometry), so the frame or two where both are
  // drawn is two identical headings on top of each other. Late is invisible; only EARLY would show
  // a gap, and `onActiveChange` can't fire early.
  const shown = active >= 0 ? active : 0;

  // Scroll speed on the UI thread, smoothed. Derived from the offset rather than taken from a
  // scroll handler's `velocity`: the sliding-bar wiring doesn't publish one, and px/s is a unit this
  // would only have to convert back.
  const speed = useSharedValue(0);
  // ── The fast-scroll decision, taken ONCE per crossing ──
  // Whether the push is deferred (see `SNAP_SPEED`). It may only change while the band is AT REST,
  // and that restriction is the whole thing — it is what makes a threshold safe here after two cuts
  // that weren't:
  //
  //  - A threshold READ EVERY FRAME, with or without hysteresis, can flip in the middle of a push,
  //    and then `p` jumps from wherever it had got to straight to an end. Hysteresis makes that
  //    crossing rarer without making it any smaller, which is why lowering the threshold only moved
  //    the chatter to a different speed. Decided at rest and held for the crossing, the latch cannot
  //    flip mid-push — and at rest the two behaviours agree exactly (`p` = 0), so the one moment it
  //    can change is the one moment changing it is free.
  //  - RAMPING continuously on speed instead — a gain, or a shrinking span — has no threshold at
  //    all, but it makes `p` a function of speed *everywhere in the push*, so the speed sample's own
  //    noise turns into position noise and the band jitters in place while it wobbles. That trades
  //    one bad speed for every speed, which is why it felt worse rather than better.
  //
  // DEFERRING rather than snapping to the nearer end matters for the same reason. A scroll that
  // decelerates to rest mid-crossing strands the latch (it can only change at rest), so whatever it
  // holds has to still look right there. Held at 0 the band is simply at rest with the incoming
  // heading behind it — indistinguishable from a crossing that hasn't started, and the next scroll
  // in either direction resolves it. Snapped to an end it would be a heading missing from under the
  // bar until something moved.
  const snapped = useSharedValue(false);
  useAnimatedReaction(
    () => scrollOffset.value,
    (v, prev) => {
      if (prev === null) return;
      const s = speed.value * SPEED_SMOOTHING + Math.abs(v - prev) * (1 - SPEED_SMOOTHING);
      speed.set(s);
      const line = v + pinLine + (barOffset?.value ?? 0);
      if (!pinAt(sections, shown, line, bandHeight, snapped.value).atRest) return;
      snapped.set(s >= bandHeight * SNAP_SPEED);
    },
    [sections, pinLine, scrollOffset, barOffset, shown, bandHeight],
  );

  // Visibility + the ride on the bar's slide, so the heading stays glued to the bar's bottom edge.
  const bandStyle = useAnimatedStyle(() => {
    const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
    return {
      opacity: pinAt(sections, shown, line, bandHeight, snapped.value).outrun || !isPinned(sections[0]?.top, line) ? 0 : 1,
      transform: [{ translateY: barOffset?.value ?? 0 }],
    };
  }, [sections, pinLine, scrollOffset, barOffset, shown, bandHeight]);

  // THE ride, and the only thing on the visual path. Pure UI thread: `pinAt` picks which of the
  // three pre-rendered headings belongs at the pin line and how far the stack has slid, so a
  // crossing costs a translate — no `runOnJS`, no React commit, no waiting behind LegendList's
  // row recycling. That queue is what made this feel slower than the sliding bars, which read the
  // same `scrollOffset` and never touch JS.
  //
  // The stack is three bands tall with `shown` in the MIDDLE (its top starts one band above the
  // clip), so `k` lands at the pin line by translating `p − (k − shown)·bandHeight`. When `shown`
  // later catches up to `k`, that term goes to zero and `p` re-bases with it: the rendered position
  // is identical either side of the commit, which is what makes a late JS update invisible rather
  // than a jump.
  const stackStyle = useAnimatedStyle(() => {
    const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
    const { k, p } = pinAt(sections, shown, line, bandHeight, snapped.value);
    return { transform: [{ translateY: p - (k - shown) * bandHeight }] };
  }, [sections, pinLine, scrollOffset, barOffset, shown, bandHeight]);

  // The pinned heading's rule, hard-switched: on only while a heading is AT REST at the pin line.
  // It lives on the clip rather than in the stack — at rest the band fills the clip, so the two
  // positions are the same, and one rule beats three riding ones. Drawn AFTER the stack so it isn't
  // painted under the band's opaque fill (that was the iOS bug that made a border-based rule show
  // up only while pushed out).
  const ruleStyle = useAnimatedStyle(() => {
    const line = scrollOffset.value + pinLine + (barOffset?.value ?? 0);
    return { opacity: pinAt(sections, shown, line, bandHeight, snapped.value).p < 0 ? 0 : 1 };
  }, [sections, pinLine, scrollOffset, barOffset, shown, bandHeight]);

  // The SUPERSEDING heading's rule — the other half of the hand-off. The heading pushing the pinned
  // one out is the list's own inline row, one band below the clip's bottom edge and rising, so its
  // rule can't live in the clip: it's a second hairline, unclipped, tracking that row. It comes on
  // at the exact push the pinned one goes off at, rides up with the row, and lands precisely where
  // the pinned rule reappears at the swap — so across a hand-off there is always a rule under a
  // heading, never a gap and never two under one heading.
  //
  // A DEFERRED push has no hand-off to make: `p` never leaves 0, so this stays off and the pinned
  // rule stays on straight through the swap — which is right, because the swap is one frame and a
  // rule that blinked across it would be the only thing announcing it.
  //
  // Its offset is `2·bandHeight + p` below `stickyTop` because two consecutive bands are exactly one
  // bandHeight apart. The `barOffset` term cancels the one inside `line`, which is what makes this
  // track the SCROLL (a list row doesn't ride the sliding bar) while the pinned band does.
  const nextRuleStyle = useAnimatedStyle(() => {
    const bar = barOffset?.value ?? 0;
    const { p, outrun } = pinAt(sections, shown, scrollOffset.value + pinLine + bar, bandHeight, snapped.value);
    return {
      opacity: p < 0 && !outrun && isPinned(sections[0]?.top, scrollOffset.value + pinLine + bar) ? 1 : 0,
      transform: [{ translateY: bandHeight * 2 + p + bar }],
    };
  }, [sections, pinLine, scrollOffset, barOffset, shown, bandHeight]);

  if (!sections[shown]) return null;
  // The three headings the ride can land on. `shown` sits in the middle so a crossing in EITHER
  // direction has its heading already rendered; the two neighbours are outside the clip and
  // therefore invisible until one of them arrives. Absent at the ends of the list, which is fine —
  // there is no crossing to make there.
  const slots = [sections[shown - 1], sections[shown], sections[shown + 1]];

  return (
    <>
      {/* The CLIP at the pin line: the ride translates the stack, and the clip is what cuts it off
          at the bar's edge instead of letting a heading slide over the bar — and what keeps the two
          neighbouring slots hidden until they arrive. `box-none` so pressables inside the heading
          (Browse's See-all) take their taps while everything else falls through to the list — and
          'none' while nothing is pinned, so an invisible heading can never intercept a tap meant
          for the content under it. */}
      <Animated.View
        pointerEvents={active >= 0 ? 'box-none' : 'none'}
        style={[styles.clip, { top: stickyTop, height: bandHeight }, bandStyle]}>
        <Animated.View
          pointerEvents="box-none"
          // Starts one band ABOVE the clip so the middle slot is the one at rest at the pin line.
          style={[styles.stack, { top: -bandHeight, height: bandHeight * 3 }, stackStyle]}>
          {slots.map((slot, i) => (
            <View
              // Keyed by SLOT, not by section: the stack is three fixed positions whose contents
              // re-base as `shown` advances. Keying by section id would remount all three on every
              // crossing, which is the JS work this design exists to keep off the path.
              key={i}
              // Only the middle slot can be interacted with. A neighbour at the pin line is there
              // for the frame or two before `shown` re-bases; its taps aren't worth the ambiguity
              // of two live copies of the same heading.
              pointerEvents={i === 1 ? 'box-none' : 'none'}
              style={[styles.slot, { height: bandHeight, backgroundColor: theme.background }]}>
              {slot ? (
                <View
                  pointerEvents="box-none"
                  style={{ height: contentHeight, marginTop: bandPadding, paddingHorizontal: sidePad }}>
                  {renderHeader(slot)}
                </View>
              ) : null}
            </View>
          ))}
        </Animated.View>
        {/* Drawn after the stack, so it is never painted under a band's opaque fill. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.rule, { backgroundColor: theme.barHairline }, ruleStyle]}
        />
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
  stack: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  slot: {
    // The stack lays its three slots out in flow order, each exactly one band tall.
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
