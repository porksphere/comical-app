import type { ZoomOrigin, ZoomRect } from '@/lib/series-zoom';

// How far a release must be PROJECTED (see lib/gesture-release — every commit decision on this
// screen and in the search layer now asks the same question) before it counts as committed.
//
// Two values, because there are two kinds of decision here and they deserve different bars:
//
//   REVEAL — which of the two sides of this ONE screen you end up on. Both outcomes are cheap and
//     instantly reversible, so the bar stays low: a quarter of the travel. Combined with a real
//     momentum term that means a release still moving toward the other side takes you there, which
//     is what a two-state toggle should do and what the old flick cutoff kept refusing to do — a
//     quick flick under 900px/s used to be ignored entirely.
//
//   DISMISS — throwing the screen away. Half the travel, matching a pushed card, and NOT a matter
//     of taste: once velocity counts for its real worth instead of being a cliff, a quarter is a
//     hair-trigger that a barely-moving release would clear. A reveal can afford to be wrong; a
//     dismissal cannot. With lib/gesture-release's 0.3s horizon this makes the dismissal rule
//     `translation + velocity * 0.3 > width / 2` — which is, term for term, what react-native-screens
//     runs for a native iOS stack pop (RNSScreenStack.mm, handleSwipe).
/** How far the expanded reader's own dismiss drag travels before it takes the gesture. Larger than
 *  the back-swipe's, and allowed to be: this one isn't racing a scroll view for the claim on its
 *  axis, so it can ask for a deliberate drag rather than a decisive one. */
export const COLLAPSE_ACTIVATE_PX = 20;

export const REVEAL_COMMIT_FRACTION = 0.25;

export const DISMISS_COMMIT_FRACTION = 0.5;

// The split reader's swipe UP (see `liftY`). Less than a dismissal asks, so it doesn't feel heavier
// than the system's swipe down beside it.
export const LIFT_COMMIT_FRACTION = 0.25;

export const LIFT_CORNER_RADIUS = 40;

// The reveal pull: how far past the details list's top the rubber-band must be pulled, at
// release, to expand the reader. Roughly usePullToRefresh's trigger feel.
export const PULL_COMMIT_PX = 80;

// How far from the LEFT edge a touch may start and still count as the back-swipe (the native
// stack pop gesture, recreated — a transparent modal doesn't get the real one).
export const SPRING_BACK = { duration: 300, dampingRatio: 1 } as const;

// The SEARCH layer's slide is UIKit's card push/pop, reproduced — see lib/ios-card-pop.ts for the
// numbers and, more importantly, the two mistakes they exist to stop being made again.
// ── The ZOOM entrance (see lib/series-zoom) ──────────────────────────────────────────────────
// A port of react-native-screen-transitions' `navigation.zoom({ target: 'bound' })` — the
// transition React Navigation's "building custom screen transitions" post demonstrates. See
// zoomMaskStyle / zoomPageStyle for the mechanism; these are its tuning constants, kept at the
// library's own values so the motion matches rather than merely resembles.
//
// Springs, from the library's `Specs.Zoom`. Very stiff and very heavily damped — the travel is
// carried by the mask and the scale, not by bounce.
// `Specs.DefaultSpec` — heavily overdamped (damping ratio ~4.6), so the open unfolds rather than
// springs. This is the spec the post configures for the opening direction.
export const ZOOM_IN_SPRING = {
  stiffness: 1000,
  damping: 500,
  mass: 3,
  overshootClamping: false,
  // Reanimated's default is 2 — two UNITS PER SECOND, sized for springs on pixel values where
  // velocities run in the hundreds. These drive a 0..1 progress whose entire travel is one unit,
  // so the default lets the tail get cut off early. The library carries 0.02 on both specs,
  // behind a @ts-expect-error for the Reanimated v3 types, which is how it fell out of the port.
  restSpeedThreshold: 0.02,
} as const;

// `Specs.FlingSpec` — and this is the one that was wrong. The post configures the CLOSE direction
// with FlingSpec, a deliberately loose spring; I had ported `Specs.Zoom.close` instead, which is
// a different, much stiffer pair (1100/98/3, damping ratio 0.85, ω 19). Its envelope decays with
// a ~60ms time constant, so a drag released at 70% of the way open finished the remaining travel
// in about a tenth of a second — which is exactly "completes instantly". FlingSpec's ω is 13 on a
// third of the mass, giving a ~85ms constant and roughly triple the visible travel time, with a
// touch of overshoot (the mask clamps at 0, so an undershoot past the card can't show).
export const ZOOM_OUT_SPRING = {
  damping: 23.5,
  stiffness: 170,
  mass: 1,
  overshootClamping: false,
  restSpeedThreshold: 0.02,
} as const;

/**
 * The READER's dismiss gets a looser one: ω 11.0 rad/s against 13.0, ζ held at 0.91, which is a
 * typical collapse of ~620ms against ~500ms.
 *
 * Why only this gesture. The series back-swipe is a BACK — it retraces a path the user already
 * knows, so it wants to feel prompt, and slowing it reads as the screen being reluctant to leave.
 * The reader's dismiss is throwing a page away, and that wants to carry.
 *
 * SOFTER MEANS LESS STIFFNESS, NOT LESS DAMPING, and the difference is not academic here. The
 * caller clamps the overshoot and the page leaves at `zoom` 0, so an under-damped spring FINISHES
 * EARLY — it reaches zero on its way through rather than easing into it. Dropping ζ from 0.90 to
 * 0.85 made the collapse 4% quicker, i.e. the opposite of the intent. Lowering stiffness with the
 * ratio held is what actually lengthens it, and it changes the ending too: at 0.91 the spring
 * rests onto the card instead of being cut off crossing it.
 */
export const ZOOM_OUT_SPRING_READER = {
  damping: 20,
  stiffness: 120,
  mass: 1,
  overshootClamping: false,
  restSpeedThreshold: 0.02,
} as const;

// The cross-fade. The ARRIVING PAGE fades in (`ZOOM_FOCUSED_ELEMENT_*`) while a COPY OF THE TAPPED
// THUMBNAIL, flying the same path, fades out (`ZOOM_UNFOCUSED_ELEMENT_*` — there it is the real
// source element on the screen underneath, transformed to track; from inside a modal we can't touch
// that view, so we fly a copy). Close holds the outgoing page longer and brings the thumbnail back
// earlier, so the picture is already there before the page dissolves off it.
//
// The copy's OPEN is far later than the library's [0.08, 0.32]. `zoom` is a spring, so it clears a
// third of its travel in the first few frames: the copy handed off before the page's own cover had
// decoded, which is the flash. It now holds past the halfway mark, by which point the real cover
// underneath it is the same already-cached image.
//
// The PAGE's open is NOT delayed with it. The copy only covers the destination's cover box, while
// the mask grows to the whole screen — hold the page's opacity back and the rest of that window is
// transparent onto whatever the modal was opened over.
export const ZOOM_CONTENT_FADE_OPEN = [0, 0.28];

export const ZOOM_CONTENT_FADE_CLOSE = [0.13, 0.7];

/**
 * The page's fade for `cover-offscreen`, where it is the OTHER half of a real cross-fade rather
 * than the thing being uncovered.
 *
 * On `cover` the copy is opaque from 0.7 — before the page starts leaving — so the page's curve is
 * unconstrained: whatever it does, the cover underneath is already carrying the frame. Here nothing
 * is underneath, so the page has to hold the frame until the cover has arrived. Opaque through the
 * first half and gone by 0.08 lets the copy take a long, visible fade (see
 * ZOOM_THUMB_FADE_CLOSE_OFFCOVER) without opening the hole that timing would otherwise cost.
 */
export const ZOOM_CONTENT_FADE_CLOSE_OFFCOVER = [0.08, 0.45];

/**
 * The page's fade for `no-source`, where nothing takes over from it. `cover` hands the frame to the
 * flying copy at 0.7 and `cover-offscreen` cross-fades with it, so both can be gone well before the
 * collapse ends. Here the copy is not drawn at all — it exists to be a shared element with the card,
 * and the card is what has gone — so the page is the only thing carrying the motion and has to stay
 * until the end of it. Opaque until the last third, then out.
 */
export const ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE = [0, 0.35];

export const ZOOM_THUMB_FADE_OPEN = [0.5, 0.85];

export const ZOOM_THUMB_FADE_CLOSE = [0.7, 1];

// The same fade for a copy that is NOT landing on the real cover — the `cover-offscreen`
// destination, where the details have scrolled past their own cover. On `cover` this cross-fade is
// undetectable: the copy is drawn over an identical picture, so it can be as quick as it likes. Here
// it appears over whatever chapter rows are on screen, and at [0.7, 1] — full strength a quarter of
// the way through a fling — that read as the cover popping in rather than arriving.
//
// It has to CROSS the content's fade, not follow it. The copy draws over the page and neither the
// mask nor the page carries a background, so what is not covered by one of them is a hole straight
// through to the grid — composite coverage is `copy + (1 - copy) * content`, and both ends of that
// have to be paid for by somebody.
//
// At [0.13, 0.32] nobody was. The content is down to 0.33 by q = 0.32 and the copy had not started,
// so the middle of every off-screen dismissal was a window two thirds transparent, which is what it
// looked like: a gap, not a cross-fade. `cover` never had this because ITS copy is opaque from 0.7,
// before the content begins to leave — it just cannot be copied here, where an opaque
// window-filling cover that early would replace the page rather than dissolve into it.
//
// The band also has to be WIDE, and that is not the same requirement. `q` does not move at a
// constant rate: the drag cannot take it below about 0.47 at all (the follow asymptotes first), so
// this whole cross-fade plays out inside the release spring — which is at its fastest exactly where
// `q` is high. A band of [0.5, 0.72] is 0.22 of the collapse and 50ms of it, three frames, which
// reads as the cover simply appearing. [0.15, 0.75] is 172ms of a ~355ms collapse.
//
// Spanning that much range would normally cost coverage, since it means fading in against a page
// that is also fading. It doesn't, because `cover-offscreen` has its own content curve
// (ZOOM_CONTENT_FADE_CLOSE_OFFCOVER) that holds the page opaque through the first half. Worst
// coverage 0.90 at q = 0.30, against 0.33 before.
//
// The upper bound is what keeps a screen-sized cover off the screen, and that is newer than it
// looks: the copy is sized to the WINDOW now (see `zoomThumbStyle`), so it is a full 393pt wide at
// q = 1. Raising 0.75 much further starts showing that.
export const ZOOM_THUMB_FADE_CLOSE_OFFCOVER = [0.15, 0.75];

/**
 * The READER's dismiss has its own pair, and both start BELOW anything a drag can reach.
 *
 * The copy here is the series cover arriving over a page of the chapter — a different picture, so
 * unlike the back-swipe's `cover` this cross-fade is always visible. On [0.7, 1] it was visible
 * while the finger was still down: a held drag bottoms out around q = 0.75 in practice (the follow
 * asymptotes at `1 - ZOOM_DRAG_FOLLOW_REACH` = 0.47, and a full-screen pull gets nowhere near
 * that), so the cover was fully in with the page still pinned under the thumb, and the drag read
 * as dragging the cover around rather than the page. The fade is part of the LANDING, not the
 * drag, so it is kept entirely inside the release spring: 0.45 is under the floor the follow can
 * ever reach, so a drag, however long, holds the page itself.
 *
 * Sized in milliseconds against ZOOM_OUT_SPRING_READER, as `q` is far from linear in time: from a
 * release at 0.75 the spring crosses [0.45, 0.15] in ~130ms of a ~570ms collapse, then spends the
 * remaining ~380ms settling the last quarter onto the card — a band any narrower is a blink, and
 * one reaching lower is a cover that keeps arriving after the window has already stopped moving.
 *
 * The page's own fade moves down with it, for the coverage reason ZOOM_THUMB_FADE_CLOSE_OFFCOVER
 * spells out: it holds opaque until the copy is half in, so the window never opens onto the grid.
 * Worst coverage 0.93 at q = 0.2.
 */
export const ZOOM_THUMB_FADE_CLOSE_READER = [0.15, 0.45];

export const ZOOM_CONTENT_FADE_CLOSE_READER = [0.05, 0.3];

// The reader's static backdrop gets its OWN, earlier close — it is not part of what's being
// carried away, it is the surface being uncovered, so matching the page's curve held it opaque
// through the first third of the collapse and kept the grid hidden long after the page had
// visibly left. Starts going immediately and is gone by the halfway point.
export const ZOOM_BACKDROP_FADE_CLOSE = [0.45, 0.98];

// …and its own OPEN, for the mirrored reason: opening, it is the surface being COVERED, so it
// arrives WITH the window rather than ahead of it. It shared the content's range ([0, 0.28]) for
// a while, and on a reader-first zoom from a grid tile that was the whole "flash": the spring
// passes 0.28 in its first ~100ms, so the full screen behind the still-tile-sized window went
// opaque black four frames after the tap and the remaining half-second of zoom played against
// black — a recording of it shows perfect sequencing and zero dropped frames, and it still read
// as a hard cut. A full-flight ramp dims the grid in step with the window's growth instead,
// reaching black as the window reaches the edges. (Details-first opens never render this
// backdrop, which is why the browse zoom always looked right.)
export const ZOOM_BACKDROP_FADE_OPEN = [0, 1];

// `computeContentTransformGeometry`'s aspect rule: below this difference the source and the
// destination bound are close enough to shape that the scale COVERS (max), above it the scale
// CONTAINS (min) and the mask does the cropping instead.
const ZOOM_ASPECT_EPSILON = 0.1;

// No source card (deep link, web, a card recycled away before we could measure it): there is no
// rect to align to, so the page does a small centred zoom instead. Still not a slide.
export const NO_ORIGIN_SCALE = 0.92;

// How long the entrance will wait for the destination page to report its hero cover's rect before
// giving up and using the computed fallback target. Invisible while it waits — the page is still
// at opacity 0, so all that shows is the untouched grid.
export const ZOOM_BOUND_WAIT_MS = 220;

// How long the source card stays visible waiting for the flying copy to paint — see `blankSource`.
// A cache-warm decode is a frame or two; this only has to catch a cover that never draws at all,
// before a collapse could show the card and its copy at once.
export const ZOOM_THUMB_PAINT_WAIT_MS = 400;

// The DRAG. A dismissal drag doesn't slide the page off — it runs the COLLAPSE under the finger:
// the same mask, transform and cross-fade the chevron plays, just with its progress on the end of
// a thumb, finishing from wherever it was let go.
//
// Along the drag's axis the page sits at the follow's own resisted distance (`zoomDragFollow`) —
// there is no second band on top of it. There was: the library's zoom/drag.ts rubber band, ported
// verbatim, ran AFTER the follow, and two resistances compounded put the page at ~115pt for a
// 400pt swipe and barely further for anything longer — the "it stops" the back-swipe was known
// for. Across the axis the loose band below is kept, since nothing else limits that direction.
// What is NOT ported either is that file's separate shrink (`resolveZoomDragScale`) and release
// curve (`resolveZoomDismissContentScale`): those exist because there the transition progress
// stays pinned at 1 for the whole drag, so the shrink has to be a second, parallel scale that a
// Bézier then hands back to the collapse. Driving the progress directly makes both unnecessary —
// and here actively wrong, since our collapsed content scale is ~0.91, above that file's 0.5 drag
// floor, so the two would fight over which way to scale.
const ZOOM_CROSS_AXIS_DRAG_TRANSLATION_SCALE = 0.35;

const ZOOM_CROSS_AXIS_DRAG_RESISTANCE = 0.05;

/**
 * How far the finger would have to travel, as a fraction of screen width, to drive the collapse all
 * the way home. Deliberately MORE than a screen: the drag must never be able to finish the collapse,
 * because whatever it finishes is animation the release no longer has to play.
 *
 * At 0.9 it could and routinely did. Traces of ordinary swipes end around 300–340px on a ~380px
 * screen, which lands `zoom` at 0.06–0.1 — the page is already sitting on the card when the finger
 * lifts, and the release is left animating the last few percent. Capping the throw (see
 * MIN_COLLAPSE_SECONDS) made that remainder take its ~220ms instead of 60ms, which is how it should
 * behave — but stretching a few percent of travel over 220ms is a crawl, and a crawl reads as a
 * stutter just as readily as a cut does. The release needs distance, not just time.
 *
 * 1.25 is chosen against the commit rule rather than by feel. A drag can only commit past
 * DISMISS_COMMIT_FRACTION (half the width), so the two ends of the committed range are:
 *
 *     just committed (0.5W)  → zoom 0.60 left to play
 *     a long swipe   (320px) → zoom 0.32 left to play
 *
 * so every release, however far it was dragged, still has a third of the collapse to show. The cost
 * is that the page shrinks less under the finger — it tracks the drag rather than arriving with it,
 * the way a photo does when you flick it back into a grid. If that reads as too little follow, this
 * is the number to lower, and it trades directly against the length of the release.
 */
export const ZOOM_DRAG_TRAVEL = 1.25;

// The collapse carries on at the speed the finger was moving — but only up to a point, and this cap
// is not cosmetic.
//
// `zoom` is a 0..1 progress over `span * ZOOM_DRAG_TRAVEL` points, so a release converts to
// progress-per-second by dividing by ~350 on a phone. A hard flick at 3000px/s is therefore ~8.5
// units/sec, which crosses the entire collapse in about a tenth of a second — and ZOOM_OUT_SPRING
// is underdamped (ζ ≈ 0.9), so a velocity that large drives `zoom` straight THROUGH 0 into negative
// within a frame or two. Every style reads `Math.max(0, zoom.value)`, so the animation is visually
// finished before it has played: it reads as the page vanishing, not collapsing.
//
// This was always latent, but the old release rule only committed a flick above 900px/s, so it was
// rare. Once the projected release (lib/gesture-release) started committing any decent throw, it
// became the common case. 3.5 ≈ the rate of a brisk swipe across the full span, so an ordinary
// release still continues at its own speed and only genuine flicks are reined in.
const ZOOM_THROW_MAX = 3.5;

/**
 * The floor under a released collapse: however hard it was thrown, it may not cross what REMAINS in
 * less than this. Which is the part the flat cap above missed.
 *
 * A rate cap alone says nothing about duration, because duration is distance over rate and the
 * distance here is whatever the drag left behind — usually very little, since a swipe across most of
 * the screen has already spent most of the collapse. A device trace made that concrete: released at
 * `zoom=0.2` with `vx=1327`, the handed speed clamps to 3.5 units/sec, and 0.2 ÷ 3.5 is 57ms. The
 * recording says 64ms. Four frames, which is not an animation; the same gesture released gently
 * (`vx=176`) took 272ms and looked right.
 *
 * That is why this only ever happened on a fast release, and why it was fine before the projected
 * release landed — the collapse used to spring from rest and always took its ~300ms. Handing the
 * throw over was right; letting it consume the whole animation was not.
 */
const MIN_COLLAPSE_SECONDS = 0.22;

/**
 * `remaining` is how much of the collapse is left at release (i.e. `zoom`), which is what turns the
 * cap from a rate into a duration.
 */
export function zoomThrowSpeed(pxPerSecond: number, span: number, remaining: number): number {
  'worklet';
  const handed = Math.abs(pxPerSecond) / Math.max(1, span * ZOOM_DRAG_TRAVEL);
  const floorSpeed = Math.max(0, remaining) / MIN_COLLAPSE_SECONDS;
  return Math.min(ZOOM_THROW_MAX, handed, floorSpeed);
}
// Back-swipe activation lives in lib/back-swipe.ts — shared with the SEARCH layer below, because
// the one thing that must never differ between two surfaces both pretending to have a back-swipe
// is what counts as one.

/**
 * How far the DESTINATION BOUND has travelled since it was measured, because the details SCROLLED
 * under it.
 *
 * The bound is the hero cover's rect, latched once on its first layout (see `onHeroCoverRect`) —
 * window coordinates taken while the list is at the top, which is where every entrance starts. A
 * collapse does not have to start there. Scroll the details down and the cover goes up with the
 * content, while the latched rect stays where it was: the page then converged on a box that no
 * longer holds the picture, and the flying copy — laid out on that same box — faded in over
 * whatever chapter rows had scrolled into its place. The transition came out of a fixed spot near
 * the top of the screen instead of out of the cover.
 *
 * So the bound follows the scroll. Read on the UI thread rather than snapshotted into state at
 * collapse time, for the same reason the rest of this transition is: a JS round trip lands a frame
 * or two late, and a destination that moves after the collapse has started is a visible jump.
 * Continuous either way — the offset is already settled before anything is dragged, and while the
 * page sits open the shift shows nowhere (at `zoom` 1 the mask is the screen, the transform is
 * identity and the copy is transparent).
 *
 * The bound is allowed to go PARTLY off screen, and must be: clamping it to the edge would just
 * move the fixed spot up. It is not allowed to go all the way — a bound with nothing left on screen
 * is not a shared element any more, and a collapse that finds one switches to `cover-offscreen`
 * rather than flying onto a box nobody can see. That threshold is where this function stops being
 * the answer, not a case it handles.
 *
 * ONLY the `cover` destination shifts, and only it can: the others are defined relative to the
 * screen, not to a box on the page. Which one is in play already bounds this — a collapse aims at
 * `cover` only while the cover is at least half on screen (see `ZOOM_BOUND_MIN_VISIBLE`), so the
 * shift is a few hundred points at most before it starts. `maxShift` survives as the backstop for
 * the one thing that bound doesn't cover: a fling still decelerating UNDER a collapse, which keeps
 * feeding offsets after the choice was latched. Past about a screen height the copy would spend the
 * visible part of the collapse outside the screen and cross the edge at a speed nothing can read —
 * a picture that never arrives at all.
 *
 * A NEGATIVE offset (the iOS rubber-band, pulling the content down) is tracked as-is: the cover
 * really has moved down, and the bound belongs on it.
 */
export function zoomBoundShift(geom: { kind: ZoomDestKind; maxShift: number } | null, offset: number): number {
  'worklet';
  if (!geom || geom.kind !== 'cover') return 0;
  return Math.min(offset, geom.maxShift);
}

/** How much of the details' hero cover has to be left on screen for it to still be the thing a
 *  collapse lands on. Half — see `ZoomDest`, and `zoomBoundOnScreen` for when it is decided. */
export const ZOOM_BOUND_MIN_VISIBLE = 0.5;

/**
 * Which DESTINATION a collapse is aimed at. The page keeps a geometry alive for both of the ones
 * currently reachable, so the choice can be made on the UI thread at the instant a collapse starts
 * (see `zoomBoundOnScreen`) — deriving the loser lazily would mean deriving it mid-flight.
 *
 *  · `cover` — the details' hero cover, where it actually is. The real shared element: the flying
 *    copy lands on the same picture the page is already showing, which is why its cross-fade there
 *    is invisible. This is the one that follows the details' scroll (`zoomBoundShift`).
 *  · `cover-offscreen` — the cover's SHAPE, centred on the page, once the details have scrolled
 *    past it. Nothing is being shared any more, so the destination stops chasing a box that has
 *    left the screen; keeping the cover's SIZE is what keeps the collapse identical in every other
 *    respect, because the size is the whole of what `s` is derived from. The copy therefore still
 *    shrinks out of a cover-sized picture rather than ballooning to a full-width one.
 *  · `page` — the page as a whole: full width at the source thumbnail's aspect, centred. For the
 *    expanded reader (the details are slid away, so their cover rect corresponds to nothing on
 *    screen, and the copy IS the page's own image) and for an instance with no measured bound.
 *  · `no-source` — the SOURCE CARD has gone while this page was open (the surface says so; see
 *    `zoomSourceHolds`). Every other destination answers "what does the copy fly out of"; this one
 *    answers the question none of them can, which is where it flies TO when the answer is nowhere.
 *    There is no card left, so the collapse converges on the SCREEN's centre at the card's own size
 *    and the page fades out over it — see `zoomGeomNoSource`, which substitutes the HERO rather
 *    than the destination, because the hero is the half that went stale.
 */
type ZoomDest = { kind: 'cover' | 'cover-offscreen'; bound: ZoomRect } | { kind: 'page' } | { kind: 'no-source' };

type ZoomDestKind = ZoomDest['kind'];

/**
 * The zoom's geometry for one choice of destination. `computeContentTransformGeometry` verbatim —
 * scale about the SCREEN centre, then translate so the destination's anchor meets the source's.
 * `scaleMode: 'uniform'` with its aspect rule: near-equal aspects take max(sx, sy) (cover),
 * genuinely different ones take min(sx, sy) (contain) and let the mask do the cropping. Ours differ
 * (a 2:3 cover into a wide band), so it contains — which is exactly why the mask is not optional.
 */
export function computeZoomGeom(hero: ZoomOrigin, dest: ZoomDest, width: number, height: number) {
  // `target: 'bound'` — align the two rects centre to centre — over whichever rect the destination
  // resolves to. `page` has none to align to, so it falls back to `getZoomContentTarget`'s computed
  // target: a virtual destination that keeps ONE edge attached to the source, so a wide source
  // fills the destination's width and follows its top edge while a narrow one fills the height
  // and follows the leading edge. Anchors follow `getZoomContentAnchor` accordingly.
  const sourceAspect = hero.width / hero.height;
  const screenAspect = width / height;
  const fitToWidth = sourceAspect >= screenAspect;
  const fitW = fitToWidth ? width : sourceAspect * height;
  const fitH = fitToWidth ? (hero.height / hero.width) * width : height;
  // Everything but `cover` is CENTRED on the page. `getZoomContentTarget` pins its computed target
  // to an edge instead — top for a wide source, leading for a narrow one — which suits a gallery,
  // where the destination really does start at the top of its screen. Here neither of these has any
  // counterpart in the layout at all: they stand in for the page, so anything but centred reads as
  // the copy sitting off to one side of the thing it is supposed to be standing in for. That
  // applies to `cover-offscreen` exactly as it does to `page` — the cover it is shaped like is not
  // on screen, so there is no position it could honour, only a size.
  const sized = dest.kind === 'page' || dest.kind === 'no-source';
  const endW = sized ? fitW : dest.bound.width;
  const endH = sized ? fitH : dest.bound.height;
  const end: ZoomRect =
    dest.kind === 'cover'
      ? dest.bound
      : { x: (width - endW) / 2, y: (height - endH) / 2, width: endW, height: endH };

  const sx = hero.width / end.width;
  const sy = hero.height / end.height;
  const aspectDifference = Math.abs(sourceAspect - end.width / end.height);
  const s = aspectDifference < ZOOM_ASPECT_EPSILON ? Math.max(sx, sy) : Math.min(sx, sy);

  // getAnchorPoint, for the three anchors this transition can pick.
  // Centre-to-centre either way now — the measured bound always used it, and the computed one
  // is centred by construction above.
  const anchorOf = (b: ZoomRect) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const startAnchor = anchorOf(hero);
  const endAnchor = anchorOf(end);
  const screenCenterX = width / 2;
  const screenCenterY = height / 2;
  // Where to lay the FLYING COPY out. Not `end` — `end` only lands on the card when the two
  // rects share an aspect, because the page carries a single uniform scale and a scalar cannot
  // reshape a rectangle. The copy's job is to be indistinguishable from the card at q = 0 (the
  // last frames of a collapse, where it is the only thing still opaque), so it is sized to
  // become the source rect exactly: `hero.size / s`, centred on `end`. When the aspects agree
  // this IS `end` — s is then hero.width/end.width and the two expressions coincide — so the
  // common case is untouched and the mismatched one stops being a mismatch.
  //
  // The trade lands on the other end: with genuinely different aspects the copy no longer
  // matches the details hero at q = 1. That end is free — the copy is fully transparent by 0.32
  // opening and doesn't start showing until 0.7 closing (see the fade ranges).
  const thumbW = hero.width / s;
  const thumbH = hero.height / s;
  return {
    s,
    end,
    thumb: {
      x: endAnchor.x - thumbW / 2,
      y: endAnchor.y - thumbH / 2,
      width: thumbW,
      height: thumbH,
    },
    tx: startAnchor.x - (screenCenterX + (endAnchor.x - screenCenterX) * s),
    ty: startAnchor.y - (screenCenterY + (endAnchor.y - screenCenterY) * s),
    // Read by `zoomBoundShift` (only `cover` is in the details' scrolling coordinates, so only it
    // has a scroll to follow) and by the copy's close fade, which is invisible on `cover` and a
    // picture appearing from nowhere on `cover-offscreen`. See ZOOM_THUMB_FADE_CLOSE_OFFCOVER.
    kind: dest.kind,
    maxShift: height,
  };
}

type ZoomGeom = ReturnType<typeof computeZoomGeom>;

/**
 * Which of a page's live geometries a frame belongs to. Read by every animated style that has to
 * know, so the three of them can't answer it differently — and so the latch (`zoomBoundOnScreen`)
 * has one reader rather than one per style.
 *
 * `cover` and `cover-offscreen` exist together or not at all, so the `page` fallback covers exactly
 * the cases where neither does: the expanded reader, a deep link, web. `no-source` needs only a
 * hero, so it exists wherever any of them do.
 */
export function pickZoomGeom(
  sourceAlive: boolean,
  onCover: boolean,
  noSource: ZoomGeom | null,
  cover: ZoomGeom | null,
  offCover: ZoomGeom | null,
  page: ZoomGeom | null,
): ZoomGeom | null {
  'worklet';
  // A dead source outranks the cover question entirely: the other three all END on the card, and
  // there is no card. Latched at rest like `onCover`, for the same reason — see `zoomSourceAlive`.
  if (!sourceAlive) return noSource ?? page;
  return (onCover ? cover : offCover) ?? page;
}

/**
 * WHOSE COORDINATES the collapse is in right now: the swipe's, or the source card's.
 *
 * A dismissal drag runs the collapse under the finger, and the collapse's whole job is to converge
 * on the card — so the page used to start sliding toward the card the moment you began dragging.
 * Drag horizontally on a page opened from a card near the bottom and it sank as it went, chasing a
 * destination rather than following the thumb. The position was the SOURCE's throughout; only its
 * size was the gesture's.
 *
 * So the two are separated. While the finger is down the page is centred on the screen and offset
 * purely by the drag — it shrinks where you are holding it. The convergence is the RELEASE's, and it
 * arrives over the rest of the collapse.
 *
 * DERIVED FROM `q`, NOT ANIMATED. This is the important part, and the reason an earlier attempt at
 * "follow the swipe" had to be reverted: that one gave the follow its own spring alongside the
 * collapse's, and two springs racing means the page is wherever the loser left it when the winner
 * finishes — which is when the page leaves and the source card un-blanks. Here the homing is a pure
 * function of the collapse's own progress, so it reaches exactly 1 on the frame `q` reaches 0. The
 * page is on the card when it lands because it cannot be anywhere else.
 *
 * `homeAt` carries the state in one number:
 *   < 0   a finger owns the page (or is springing it back) — position is the swipe's.
 *   = 0   nothing was dragged: the entrance, the chevron, hardware back. The classic collapse.
 *   > 0   the `q` a committed drag was released at; the ramp runs from there to 0.
 */
export function zoomHoming(homeAt: number, q: number): number {
  'worklet';
  if (homeAt < 0) return 0;
  if (homeAt === 0) return 1;
  return Math.min(1, Math.max(0, (homeAt - q) / homeAt));
}

/**
 * The mask's box on its way to the card — read by all three of the zoom's animated styles so they
 * cannot disagree about where the window is. The page compensates for this origin, and the flying
 * copy measures its entry against it.
 *
 * Deliberately knows nothing about the drag or the homing. Everything inside the window is placed
 * RELATIVE to this box, so the pair can be moved anywhere as one (see `zoomDetach`) without any of
 * those relationships changing — which is the property that keeps the cover framed.
 */
export function zoomMaskBox(
  hero: ZoomOrigin,
  shiftX: number,
  shiftY: number,
  q: number,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  'worklet';
  return {
    left: (hero.x + shiftX) * (1 - q),
    top: (hero.y + shiftY) * (1 - q),
    width: hero.width + (width - hero.width) * q,
    height: hero.height + (height - hero.height) * q,
  };
}

/**
 * How far to carry the whole assembly off its converging path, so that a page under a finger sits
 * where the swipe put it rather than where the card is.
 *
 * Applied to the MASK ALONE, and that is the entire trick. The page is the mask's child and
 * compensates for the mask's own origin, so moving the mask moves everything inside it by the same
 * amount: the window, the page, the flying copy and the cover all travel together and nothing about
 * their relative geometry changes. The first attempt at this instead scaled the page's TARGET by
 * `home`, which does move the page — and moves it out from under its own window, so the cover
 * drifted toward an edge as the two shrank at different anchors and got clipped.
 *
 * The offset is whatever puts the window back in the middle of the screen, so at `home` 0 the
 * assembly shrinks about the screen centre wherever the card happens to live. At q = 1 it is zero
 * on its own — a full-screen window is already centred — so a page at rest cannot tell the two
 * coordinate systems apart and nothing jumps when a drag takes it over.
 */
export function zoomDetach(start: number, size: number, home: number, span: number): number {
  'worklet';
  return (span / 2 - start - size / 2) * (1 - home);
}

/**
 * The follow's two knobs, and they are independent on purpose.
 *
 * `REACH` is where it asymptotes, as a fraction of the drag's own travel — how far the page can
 * ever get, and (since the resisted distance is what drives `zoom`) how small the window can ever
 * get. `GRIP` is its rate at the FIRST pixel — how much of your thumb it takes before it has
 * travelled anywhere at all.
 *
 * One parameter could not express what this needs. Tie the rate at 0 to the asymptote (grip = 1,
 * which every earlier shape did) and the whole change from free to stuck has to happen inside the
 * first `reach` points, because that is the only length in the formula. Lowering the asymptote to
 * bring the spring on sooner only compresses it further. Splitting them lets the spring be in
 * effect immediately AND take the whole drag to arrive: at 0.6/1.9 the rate goes 0.60 → 0.35 → 0.18
 * across the first 350pt, where 1.0/1.6 went 1.00 → 0.38 → 0.15 over the same distance and did
 * three quarters of that in the first third of it. Worst stiffening over any 20pt: 0.05, against
 * 0.16.
 *
 * The shrink is not clamped anywhere: `zoom` is `1 - held/travel`, so the SAME resistance that
 * slows the page down slows the window down, and the two cannot disagree about when to stop. That
 * also makes "a drag can never finish the collapse" arithmetic rather than a guard — `held` is
 * asymptotic to `REACH · travel`, so `zoom > 1 - REACH` for any drag, however long. 0.53 is the
 * reach the old explicit floor implied on a grid card, kept to the point so the follow feels
 * exactly as it did; only what limits the shrink has changed.
 */
export const ZOOM_DRAG_FOLLOW_REACH = 0.53;

export const ZOOM_DRAG_FOLLOW_GRIP = 0.6;

/**
 * The series BACK-SWIPE's own pair — longer and livelier than the reader's. The reader measures a
 * dismiss over the screen's height and has a whole page of chapter art under the drag; the
 * back-swipe measures over the width, and a swipe here is a page being put back, which the hand
 * expects to go WITH it. At 0.53/0.6 — and with the second band that used to run on top (see the
 * note above ZOOM_CROSS_AXIS_DRAG_TRANSLATION_SCALE) — a 400pt swipe moved the page 116pt and a
 * 600pt one 133pt: it ran out of road at about a third of the screen and read as stuck. At
 * 0.6/0.8, riding the follow alone, those are 154pt and 183pt, a first pixel that moves
 * 0.8 of the thumb instead of 0.6, and a tail that is still giving at the far edge. The floor is
 * `zoom` 0.4, so a drag still can never finish the collapse, and the furthest an actual swipe
 * carries it (~0.63 at 600pt) keeps the page's own fade on the `cover` path above 0.87.
 */
export const ZOOM_BACK_SWIPE_FOLLOW_REACH = 0.6;

export const ZOOM_BACK_SWIPE_FOLLOW_GRIP = 0.8;

/**
 * The `zoom` by which the window's corners are FULLY rounded on the way out — reached in the first
 * TWELFTH of the collapse, not carried linearly across all of it.
 *
 * Corner radius is the earliest signal that a page has become a card, and it arrives before any
 * other: at the top of a dismissal the window is still nearly full-screen, so size and position
 * have barely moved and the rounding is the only thing saying what is about to happen. Spread
 * linearly over `1 - q` it never got the chance — since the spring took over the shrink a drag only
 * carries `zoom` to about 0.87, which on the old curve is 13% of the corner, i.e. square.
 *
 * The threshold is set against FINGER TRAVEL, not against `q`, because `q` means different
 * distances on the two surfaces this serves: the reader's paged dismiss measures over the height,
 * so the same swipe moves it half as far as the series back-swipe does. At 0.92 the corner is full
 * after 78pt of a back-swipe and 168pt of a paged dismiss; at 0.84 it took 188 and 407, which on
 * the reader is most of a swipe.
 *
 * ONE curve, not one per direction, and that is forced rather than chosen. `settle` (a cancelled
 * swipe) clears `zoomClosing` on the frame the finger lifts, so a curve that keyed off it would
 * jump the radius from ~9.5pt to ~1.5pt in that single frame — the pop would land on exactly the
 * gesture that is supposed to look like nothing happened. Opening just inherits it: the window
 * The two directions have their OWN thresholds, which is what lets the close be this aggressive.
 * Opening, the corner is not a signal of anything — you already touched the card — so squaring off
 * has to stay a tail rather than an event, and a slice as thin as the close's would be one.
 *
 * The split is only safe because `zoomRadiusClosing` is not `zoomClosing`: it flips back when the
 * page has actually reached the top, not on the frame a cancelled swipe releases. Both curves run
 * to 0 at `q` = 1, so the flip lands where they have all but converged — 0.16pt apart at the
 * threshold the reaction uses. Keying this off `zoomClosing`, which `settle` clears immediately,
 * would swap them mid-springback instead: 12pt to 3.8pt in one frame for a swipe released at 0.95,
 * on the one gesture meant to look like nothing happened.
 */
export const ZOOM_RADIUS_ROUNDED_BY_CLOSE = 0.97;

export const ZOOM_RADIUS_ROUNDED_BY_OPEN = 0.84;

/** Where the two curves swap. Late enough that they have converged to 0.16pt of each other, and
 *  reachable because a settled spring writes its target exactly. */
export const ZOOM_RADIUS_CURVE_SWAP_AT = 0.9995;

/** How far the reader's dismiss must travel before it HAS a direction to be judged against. Small
 *  enough that it is latched almost immediately, large enough that the first frames of a drag —
 *  which are noise, and on web arrive with translation 0 — cannot set it. */
export const ZOOM_DISMISS_DIR_MIN = 6;

/** How long the flying copy takes to come back after a reversed drag commits. It is a real fade,
 *  not a reset, because a release mid-reversal has the copy at zero opacity and the page still has
 *  to land on the card with a picture on it. */
export const ZOOM_THUMB_BIAS_RESTORE_MS = 160;

/**
 * The follow: a spring, not a leash. Resistance is there from the first pixel and grows from there,
 * so the page is asymptotic to `reach` with no point where it stops behaving one way and starts
 * behaving another.
 *
 * Three shapes were wrong before this one, each at a different part of the drag:
 *
 *  · Free to the shrink floor, then rubber-banded. C¹ at the knee and still read as binary —
 *    continuity of SPEED is not continuity of FEEL. All the curvature sat in the ~20pt after it.
 *  · One exponential over the whole drag. Gradual, then FLATLINED: `1 - e^-t` is within a percent
 *    of its limit by three time constants, so past ~450pt the page simply stopped, and a page that
 *    stops dead is a wall wherever you put it.
 *  · `A·t/(A + t)` — iOS's scroll-boundary band, which fixed the tail (its rate decays as 1/t², so
 *    there is always something left to give) but still left the drag feeling like it all happened
 *    at once, because a rate starting at exactly 1 has the whole of its range to fall through.
 *
 * Same band, with the initial rate freed from the asymptote: `reach·d / (reach/grip + d)`, whose
 * rate is `grip · (S/(S + d))²` for `S = reach/grip`. `grip` sets where that starts and `S` how
 * long it takes to get anywhere, and neither moves the other.
 *
 * `reach` is anchored to the floor's own travel (see the callers), so the page runs out of room in
 * the same stretch the size does. `grip < 1` also guarantees it can never outrun the finger, since
 * `S > reach` makes `held(d) < d` everywhere.
 */
export function zoomDragFollow(distance: number, reach: number, grip: number): number {
  'worklet';
  if (reach <= 0 || grip <= 0) return distance;
  const d = Math.abs(distance);
  const held = (reach * d) / (reach / grip + d);
  return distance < 0 ? -held : held;
}

/** `resolveZoomCrossAxisDragTranslation` — the off-axis, which follows loosely and never leads. */
export function zoomCrossAxisDrag(translation: number, dimension: number): number {
  'worklet';
  const direction = translation < 0 ? -1 : 1;
  const baseDistance = Math.max(1, dimension);
  const normalized = Math.abs(translation) / baseDistance;
  const resisted =
    (baseDistance * (1 - Math.exp(-ZOOM_CROSS_AXIS_DRAG_RESISTANCE * normalized))) /
    ZOOM_CROSS_AXIS_DRAG_RESISTANCE;
  return direction * Math.min(baseDistance, resisted * ZOOM_CROSS_AXIS_DRAG_TRANSLATION_SCALE);
}

// Wall-clock backstop for a collapse whose animation callback never arrives (see closeLayer).
// Generous: the close spring is stiff but a spring has no fixed duration to key off.
export const ZOOM_OUT_BACKSTOP_MS = 900;

/**
 * How close to the card counts as arrived, for the leave reaction. ZERO — the collapse must be at
 * REST, not merely near.
 *
 * This was 0.02, chosen as "small enough to be invisible", which measures the wrong thing. The gap
 * isn't what you can see of the mask, it's what the app is DOING while the mask is still moving:
 * leaving unmounts the whole series page, pops the route, and un-blanks the source card, and all of
 * that lands on the main thread — the same one the animation draws on. At 0.02 that teardown
 * overlapped the final frames of the motion, so every collapse hitched just as it reached the card,
 * fast swipe or slow, which is precisely where it was reported.
 *
 * At rest the page is already sitting exactly on the card with its content cross-faded to the
 * thumbnail copy — visually indistinguishable from the card underneath. So the teardown still costs
 * the same, and now costs it against a still frame, where a stall has nothing to stutter.
 *
 * Zero is reachable, not a hope: the collapse springs with `overshootClamping`, and Reanimated
 * writes the target exactly when a spring completes. A collapse that gets CANCELLED before arriving
 * never trips this — which is the case the wall-clock backstop is for.
 */
export const LEAVE_AT_ZOOM = 0;

/** The two ends of "a collapse is under way". Not symmetric: `ARMED` sits nearer the top so a drag
 *  released short has to actually return home before it may probe again. */
export const COLLAPSE_STARTED = 0.995;

export const COLLAPSE_ARMED = 0.999;
