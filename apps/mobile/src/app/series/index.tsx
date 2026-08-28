import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, type ImageLoadEventData } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, type ComposedGesture } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { LinearGradient } from 'expo-linear-gradient';

import { ChevronUpIcon } from '@/components/icons/ui-icons';
import { ChapterNavigator } from '@/components/reader/chapter-navigator';
import { PagedReader, type PagedReaderHandle, type ReaderPageItem } from '@/components/reader/paged-reader';
import { ProgressPill } from '@/components/reader/progress-pill';
import { ReaderToolbar } from '@/components/reader/reader-toolbar';
import { CollectPageControl } from '@/components/reader/collect-page-control';
import { SettingsControl } from '@/components/reader/settings-panel';
import { WebtoonReader, type WebtoonReaderHandle } from '@/components/reader/webtoon-reader';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { TopBarSwitch } from '@/components/top-bar-switch';
import { Spacing } from '@/constants/theme';
import { warmPageImages } from '@/data/warm-pages';
import {
  chapterPagesQuery,
  directPagesQuery,
  historyQuery,
  inLibraryQuery,
  queryKeys,
  seriesDetailQuery,
  seriesListQuery,
} from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type Chapter } from '@/data/types';
import { useChapterReconcile } from '@/hooks/use-chapter-reconcile';
import { useReaderSequence, type ReaderSequenceEntry, type ReaderSequenceParams } from '@/hooks/use-reader-sequence';
import { useReaderSettings } from '@/hooks/use-reader-settings';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { LARGE_SCREEN_BREAKPOINT, useTopBarHeight } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { useRouter } from '@/lib/nav';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';

import { backSwipePan, backSwipeShape, backSwipeStayedHorizontal, resetBackSwipeShape, trackBackSwipeShape, BACK_ACTIVATE_DOMINANCE, BackSwipeGestureContext } from '@/lib/back-swipe';
import { trace, traceGate, traceJS, traceThrottled, useGestureTraceEnabled } from '@/lib/gesture-trace';
import { releaseCommitted, releaseCommittedEitherWay } from '@/lib/gesture-release';
import { IOS_CARD_SHADOW, IOS_CARD_SPRING, IOS_PARALLAX_FRACTION } from '@/lib/ios-card-pop';
import { registerDrillSeries, registerOpenSearchLayer, useDrillRelatedSeries } from '@/lib/series-nav';
import { holdSeriesBackdrop, seriesReaderDim } from '@/lib/series-backdrop';
import {
  holdZoomingSeries,
  onZoomSurfaceChange,
  resolveZoomTarget,
  takeZoomOrigin,
  type ZoomOrigin,
  type ZoomRect,
} from '@/lib/series-zoom';
import SearchScreen from '../search';
import { SeriesBody, truncateTopBarTitle } from '@/components/series/series-body';

// THE series page: one screen holding BOTH the series details and the reader, either side one
// gesture from the other. Everything that opens a series or opens reading opens this — a browse
// card, a History or Activity row, the card long-press menu's Read, a chapter row, a page
// thumbnail — differing only in which side it lands on. There is no separate reader route.
//
// It opens ON THE DETAILS, with the reader as a faded strip forming the TOP OF THE PAGE — not
// fixed chrome: the strip scrolls away under the content like any page header, through a tall
// gradient seam centered on the series title. The reader itself is already FULL-SCREEN beneath
// that layer (the strip is its window), so revealing it is only ever a matter of moving the
// details layer off — and the axis follows the reader's own, so the transition matches the
// gestures on both sides (see `horizontalReveal`):
//   - PAGED: pull the page down past its top and the details slide DOWN out of visibility (the
//     iOS rubber-band moves content and seam 1:1 with the finger while the reader fades in
//     above; a deep release commits, and Android/web get the same follow via a manual pan).
//   - WEBTOON: a leftward drag anywhere on the details (or on the strip) slides them LEFT off
//     the screen under the finger — vertical belongs to the scroll there, and the collapse is
//     already a rightward drag. A pull past the top still rubber-bands the strip open as an
//     affordance, but never commits (that would fling the details along the wrong axis).
// A strip tap expands in both. In the expanded reader, drag up (paged) or the Details pill brings
// the details back — webtoon reveals by BUTTON ONLY, since a horizontal drag that revealed would
// be the one gesture here going somewhere other than out. Any other drag dismisses, running the
// same collapse into the source card the chevron does (mode-locked per gesture — see the pan
// build). One TopBarSwitch slot crossfades the top chrome between the modes.
//
// The details are `SeriesBody` (components/series/series-body.tsx) — cover hero, action column,
// tag/meta/description, the real chapter list (downloads, versions, read state), page-thumb grid,
// related rails. Three props route its intents back into this screen rather than anywhere else:
// `onStartReading` (Read button → expand the in-place reader), `onOpenChapter` (chapter row →
// swap the reader pane's chapter and expand), `onOpenPage` (direct-series thumbnail → jump the
// pane to that page and expand).
//
// Chaptered series: the screen resolves resume-or-first-chapter itself (same history lookup as
// useStartReading). The NATIVE PAGED reader stitches adjacent chapters into one flat pager
// (see the `run` machinery), so swiping across a boundary is an
// ordinary page turn with an in-place relabel. Explicit jumps (chapter rows, skip buttons) and
// web/webtoon crossings remount the pane seeded at the landing page instead. While the details
// are up the reader is in STANDBY — only the single visible strip page is requested.

const CHROME_HIDE_MS = 3000;
// CI-speed override: Maestro steps can outlast the auto-hide, and hidden chrome drops out of the
// accessibility tree.
const CHROME_AUTO_HIDE = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST !== '1';
const WARM_BEHIND = 2;
/**
 * The longest a NEW stitched window will wait for the previous chapter's page list before being
 * created without it (see the `run` machinery).
 *
 * A ceiling, not a delay — both page lists are requested in the same commit, so what is actually
 * being waited on is the gap between two responses already in flight, and a boundary visited before
 * (every neighbour list is fetched eagerly and the query cache is persisted) resolves in the same
 * render and waits for nothing. What the ceiling buys is the case that can't be waited out: a
 * source that is slow or gone. There it spends this much of the "Loading…" already on screen and
 * then goes on without it, rather than holding the reader on a request that may never land.
 */
const PREV_WINDOW_GRACE_MS = 600;
const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
// The reader surface's tone. Pure black, like every other page — it mirrored the reference's
// `#reader-view { background: #0f0f0f }` until the app's own background stopped doing the same
// (see `Colors.dark.background`), and a reader a shade lighter than the app it opens out of read
// as a mismatch rather than as its own surface.
const READER_BACKDROP = '#000000';
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
const COLLAPSE_ACTIVATE_PX = 20;
const REVEAL_COMMIT_FRACTION = 0.25;
const DISMISS_COMMIT_FRACTION = 0.5;
// The reveal pull: how far past the details list's top the rubber-band must be pulled, at
// release, to expand the reader. Roughly usePullToRefresh's trigger feel.
const PULL_COMMIT_PX = 80;
// How far from the LEFT edge a touch may start and still count as the back-swipe (the native
// stack pop gesture, recreated — a transparent modal doesn't get the real one).
const SPRING_BACK = { duration: 300, dampingRatio: 1 } as const;
// The visible height of the collapsed reader strip (below the safe area) — a faded-out
// background-image band forming the TOP OF THE DETAILS PAGE (it scrolls away under the content
// like any page header, it is not fixed chrome).
const HEADER_BAND = 200;
// The strip-to-details seam gradient's height. It's tall on purpose: the transition is CENTERED
// ON THE SERIES TITLE — the title (the page's first element) renders mid-gradient over the fading
// strip, X-hero style, so the content top inset is derived from this (see headerTopInset).
const SHEET_FADE_H = 120;
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
const ZOOM_IN_SPRING = {
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
const ZOOM_OUT_SPRING = {
  damping: 23.5,
  stiffness: 170,
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
const ZOOM_CONTENT_FADE_OPEN = [0, 0.28];
const ZOOM_CONTENT_FADE_CLOSE = [0.13, 0.7];
const ZOOM_THUMB_FADE_OPEN = [0.5, 0.85];
const ZOOM_THUMB_FADE_CLOSE = [0.7, 1];
// The same fade for a copy that is NOT landing on the real cover — the `cover-offscreen`
// destination, where the details have scrolled past their own cover. On `cover` this cross-fade is
// undetectable: the copy is drawn over an identical picture, so it can be as quick as it likes. Here
// it appears over whatever chapter rows are on screen, and at [0.7, 1] — full strength a quarter of
// the way through a fling — that read as the cover popping in rather than arriving.
//
// Tracks the entry above rather than leading it: the copy is clipped by the mask until about 0.44,
// so anything this does before then is invisible anyway, and it reaches full strength at 0.15 —
// just before the page's own content finishes fading out at 0.13, so there is no frame with neither
// picture on it. What it actually buys is softening the moment the copy clears the mask edge, which
// is otherwise a hard rectangle appearing from under a line.
const ZOOM_THUMB_FADE_CLOSE_OFFCOVER = [0.15, 0.5];
// When the `cover-offscreen` copy makes its entrance, as a slice of the travel. It is the only
// destination whose copy has nowhere real to start: `cover` starts on the actual cover, `page`
// starts as the page's own image, and this one is a picture of something that has scrolled off the
// top — so centred and un-animated it simply materialised mid-screen, arriving from nothing.
//
// It arrives ALONG ITS OWN PATH, which is the whole trick and took two goes to get right. The
// copy's centre already travels a straight line from the screen centre to the card (`end` is
// centred, so its window position is just `centre + (tx, ty) * (1 - q)`), and the entry is that
// same line extended BACKWARDS: the position the copy would have at `q + k`. Nothing else moves it,
// so there is one motion in one direction from first frame to last. Pushing it up from the top edge
// instead — which is what this did first — was a second, differently-aimed movement laid over the
// diagonal collapse, and it read as exactly that: two animations rather than one.
//
// `k` is chosen per frame as the least that puts the copy clear of the MASK, so it is genuinely
// clipped rather than merely transparent, and so the distance shrinks as the mask closes. Which
// edge it clears through falls out of the geometry — a card low on the left is reached by going
// down-and-left, so the copy waits up and to the right.
//
// LATE, and the numbers matter. Held out of sight for the first half of the collapse, it emerges
// around 0.44 — by which point the mask is a fraction of the screen, so the run in from the edge is
// short — and is home by 0.10. Starting it earlier is not "more of the same": it is a longer sweep
// through a bigger window, which is what read as the copy being flung in.
const ZOOM_THUMB_ENTRY_CLOSE = [0.1, 0.45];
// The reader's static backdrop gets its OWN, earlier close — it is not part of what's being
// carried away, it is the surface being uncovered, so matching the page's curve held it opaque
// through the first third of the collapse and kept the grid hidden long after the page had
// visibly left. Starts going immediately and is gone by the halfway point.
const ZOOM_BACKDROP_FADE_CLOSE = [0.45, 0.98];
// …and its own OPEN, for the mirrored reason: opening, it is the surface being COVERED, so it
// arrives WITH the window rather than ahead of it. It shared the content's range ([0, 0.28]) for
// a while, and on a reader-first zoom from a grid tile that was the whole "flash": the spring
// passes 0.28 in its first ~100ms, so the full screen behind the still-tile-sized window went
// opaque black four frames after the tap and the remaining half-second of zoom played against
// black — a recording of it shows perfect sequencing and zero dropped frames, and it still read
// as a hard cut. A full-flight ramp dims the grid in step with the window's growth instead,
// reaching black as the window reaches the edges. (Details-first opens never render this
// backdrop, which is why the browse zoom always looked right.)
const ZOOM_BACKDROP_FADE_OPEN = [0, 1];
// `computeContentTransformGeometry`'s aspect rule: below this difference the source and the
// destination bound are close enough to shape that the scale COVERS (max), above it the scale
// CONTAINS (min) and the mask does the cropping instead.
const ZOOM_ASPECT_EPSILON = 0.1;
// No source card (deep link, web, a card recycled away before we could measure it): there is no
// rect to align to, so the page does a small centred zoom instead. Still not a slide.
const NO_ORIGIN_SCALE = 0.92;
// How long the entrance will wait for the destination page to report its hero cover's rect before
// giving up and using the computed fallback target. Invisible while it waits — the page is still
// at opacity 0, so all that shows is the untouched grid.
const ZOOM_BOUND_WAIT_MS = 220;
// How long the source card stays visible waiting for the flying copy to paint — see `blankSource`.
// A cache-warm decode is a frame or two; this only has to catch a cover that never draws at all,
// before a collapse could show the card and its copy at once.
const ZOOM_THUMB_PAINT_WAIT_MS = 400;
// The DRAG. A dismissal drag doesn't slide the page off — it runs the COLLAPSE under the finger:
// the same mask, transform and cross-fade the chevron plays, just with its progress on the end of
// a thumb, finishing from wherever it was let go.
//
// The follow is the library's zoom/drag.ts resistance, verbatim — a rubber-banded travel along the
// drag axis and a loose one across it. What is NOT ported is that file's separate shrink
// (`resolveZoomDragScale`) and release curve (`resolveZoomDismissContentScale`): those exist
// because there the transition progress stays pinned at 1 for the whole drag, so the shrink has to
// be a second, parallel scale that a Bézier then hands back to the collapse. Driving the progress
// directly makes both unnecessary — and here actively wrong, since our collapsed content scale is
// ~0.91, above that file's 0.5 drag floor, so the two would fight over which way to scale.
const ZOOM_PRIMARY_DRAG_TRANSLATION_SCALE = 0.8;
const ZOOM_PRIMARY_DRAG_RESISTANCE = 2;
const ZOOM_HORIZONTAL_DRAG_DISTANCE_SCALE = 1.5;
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
const ZOOM_DRAG_TRAVEL = 1.25;
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
function zoomThrowSpeed(pxPerSecond: number, span: number, remaining: number): number {
  'worklet';
  const handed = Math.abs(pxPerSecond) / Math.max(1, span * ZOOM_DRAG_TRAVEL);
  const floorSpeed = Math.max(0, remaining) / MIN_COLLAPSE_SECONDS;
  return Math.min(ZOOM_THROW_MAX, handed, floorSpeed);
}
// Back-swipe activation lives in lib/back-swipe.ts — shared with the SEARCH layer below, because
// the one thing that must never differ between two surfaces both pretending to have a back-swipe
// is what counts as one.

/** `resolveZoomPrimaryDragTranslation` — exponential resistance along the drag's own axis. */
function zoomPrimaryDrag(translation: number, dimension: number): number {
  'worklet';
  const direction = translation < 0 ? -1 : 1;
  const baseDistance = Math.max(1, dimension);
  const normalized = Math.abs(translation) / baseDistance;
  const resistance = ZOOM_PRIMARY_DRAG_RESISTANCE * 0.85;
  const resisted = (baseDistance * (1 - Math.exp(-resistance * normalized))) / resistance;
  return direction * Math.min(baseDistance, resisted * ZOOM_PRIMARY_DRAG_TRANSLATION_SCALE);
}

/** `resolveZoomHorizontalDragTranslation` — the primary axis, when that axis is horizontal. */
function zoomHorizontalDrag(translation: number, dimension: number): number {
  'worklet';
  return zoomPrimaryDrag(translation, dimension) * ZOOM_HORIZONTAL_DRAG_DISTANCE_SCALE;
}

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
function zoomBoundShift(geom: { kind: ZoomDestKind; maxShift: number } | null, offset: number): number {
  'worklet';
  if (!geom || geom.kind !== 'cover') return 0;
  return Math.min(offset, geom.maxShift);
}

/** How much of the details' hero cover has to be left on screen for it to still be the thing a
 *  collapse lands on. Half — see `ZoomDest`, and `zoomBoundOnScreen` for when it is decided. */
const ZOOM_BOUND_MIN_VISIBLE = 0.5;

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
 */
type ZoomDest = { kind: 'cover' | 'cover-offscreen'; bound: ZoomRect } | { kind: 'page' };
type ZoomDestKind = ZoomDest['kind'];

/**
 * The zoom's geometry for one choice of destination. `computeContentTransformGeometry` verbatim —
 * scale about the SCREEN centre, then translate so the destination's anchor meets the source's.
 * `scaleMode: 'uniform'` with its aspect rule: near-equal aspects take max(sx, sy) (cover),
 * genuinely different ones take min(sx, sy) (contain) and let the mask do the cropping. Ours differ
 * (a 2:3 cover into a wide band), so it contains — which is exactly why the mask is not optional.
 */
function computeZoomGeom(hero: ZoomOrigin, dest: ZoomDest, width: number, height: number) {
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
  const endW = dest.kind === 'page' ? fitW : dest.bound.width;
  const endH = dest.kind === 'page' ? fitH : dest.bound.height;
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
 * the cases where neither does: the expanded reader, a deep link, web.
 */
function pickZoomGeom(
  onCover: boolean,
  cover: ZoomGeom | null,
  offCover: ZoomGeom | null,
  page: ZoomGeom | null,
): ZoomGeom | null {
  'worklet';
  return (onCover ? cover : offCover) ?? page;
}

/** `resolveZoomCrossAxisDragTranslation` — the off-axis, which follows loosely and never leads. */
function zoomCrossAxisDrag(translation: number, dimension: number): number {
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
const ZOOM_OUT_BACKSTOP_MS = 900;
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
const LEAVE_AT_ZOOM = 0;

/** The two ends of "a collapse is under way". Not symmetric: `ARMED` sits nearer the top so a drag
 *  released short has to actually return home before it may probe again. */
const COLLAPSE_STARTED = 0.995;
const COLLAPSE_ARMED = 0.999;
/** Instances that have already left. See `leaveOnce` for why this lives out here. */
const LEFT = new WeakSet<object>();
// Half the title's ~40pt first line — positions the title's CENTER at the gradient's center.
const TITLE_MID = 20;
// The details-content fade (and the reader's matching tint) complete within this fraction of the
// travel — weighted toward the START of a reveal and, symmetrically, the END of a hide.
const FADE_WINDOW = 0.4;

/**
 * How still the read position has to be before the pages around it are warmed.
 *
 * Every page the reader passes reports itself — a scrub ticks about every 45ms, and a swipe through
 * a gallery reports each page as it goes by — and warming at every one of those meant a sweep from
 * page 1 to 47 enqueued a warm window per page: forty-odd windows for a journey through pages
 * nobody was going to look at. On a direct series, whose page URLs are lazy resolve-routes answered
 * one at a time by the bridge, that is minutes of round-trips bought on speculation.
 *
 * The ordering problem this used to cause is fixed properly in the resolve queue (data/api.ts): a
 * warm is `background` now and can no longer be served ahead of a page that has mounted. This is
 * the other half — not asking in the first place. Only where the reader COMES TO REST is warmed,
 * which is the only place a guess about what to read next is worth anything. Short enough that a
 * scrub that pauses to look still warms where it paused; long enough that crossing a gallery warms
 * once, at the far end.
 */
const WARM_IDLE_MS = 220;

/** How long the initial-position POSTER (see `parked` in ReaderPane) waits for the list's first
 *  position report before standing down on its own. Generous — the report normally lands within
 *  a few frames; this only exists so a wedged list can't keep a static image over a live pager. */
const POSTER_BACKSTOP_MS = 1200;

/** What the reader pane is pointed at: a chapter (chaptered series) or the series itself (direct).
 *  `start: 'last'` = land on the final page (arriving from the NEXT chapter's "previous"). */
type ReadTarget = { chapterId?: string; chapterName?: string; start: number | 'last' };

/**
 * A cross-series READER SEQUENCE — what the pager runs over when the reader was opened from a
 * collection rather than a chapter (see use-reader-sequence.ts). ONE instance serves the whole
 * album, and the pager never remounts: the sequence is its page list VERBATIM, so a series cross
 * is literally a page turn — the exact discipline that makes a stitched chapter crossing
 * seamless, applied one level up. What a cross changes is only what a stitched crossing's relabel
 * changes: the chrome and the details layer RE-POINT to the visible entry's series (query keys
 * and the details host's key — see `detailBridgeId`/`detailSeriesId` in the instance), while
 * everything mounted keeps its state. No chapter target, no stitching, no adjacency, no progress
 * recording — the sequence is the run.
 */
type ReaderSequenceRun = {
  /** Resolved page URIs, one per entry ('' = still resolving → the page's own skeleton). */
  uris: string[];
  entries: ReaderSequenceEntry[];
  /** The entry the album OPENED on — seeds the pager once; position then lives in the pager. */
  index: number;
};

/** One chapter's worth of pages inside the native pager's stitched flat list — what makes a
 *  boundary swipe an ordinary page turn instead of a bounce-and-remount. */
type Segment = { id: string; name?: string; pages: string[] };

/** "No window (yet)", as ONE array rather than a fresh `[]` per render: the run merge feeds an
 *  adjust-state-on-render `setRun`, which compares by identity — a new empty array every render is
 *  an infinite one. */
const NO_SEGMENTS: Segment[] = [];

/** Same params a series card forwards to `/series` (see series-card.tsx buildHref) — including
 *  the percent-encoded bridge name / cover, decoded the same way series.tsx does. */
type SeriesReaderParams = {
  id?: string;
  title?: string;
  bridge?: string;
  bridgeId?: string;
  cover?: string;
  /** '1' for a direct (chapterless) series — its pages ARE the series. */
  direct?: string;
  /** '1' opens straight into the READER rather than the details — how History and Activity enter,
   *  since a row there is a "carry on reading" action. A swipe up brings the details in, exactly
   *  as it does after expanding from a browse open. */
  reader?: string;
  /** Reader-first entries seed the read position directly instead of resolving it from history:
   *  the row already knows where it left off, and this is what lets the pages request go out on
   *  the first commit (see the fetch ordering below). */
  chapterId?: string;
  chapterName?: string;
  start?: string;
};

/**
 * One series instance. The SCREEN (`SeriesReaderScreen` below) renders a base instance for the
 * route's own params plus a LAYER per drilled series (a series opened from a series — related
 * rails, nested search results), stacked as plain sibling views inside this one screen.
 *
 * Layers, not navigation, on purpose: the modal is a contained transparent modal, and iOS can
 * neither stack a second one on top (UIKit re-roots the presentation and drops the middle
 * screen's view — the dismissal showed the root tabs) nor keep a covered nested CARD's view
 * alive (UINavigationController detaches it — the dismissal showed a flat backdrop). Sibling
 * views can't be detached by anyone, so the parent series is GUARANTEED live beneath a drilled
 * one: the page-view swipe-away and the edge back-swipe both reveal it for real, exactly like
 * the top-level gestures reveal the browse grid.
 *
 * `depth` 0 is the modal root (leaving = popping the route); a deeper instance zooms in over its
 * parent out of the card that opened it, exactly as the root zooms out of a card on the grid
 * behind the whole modal, and leaves via `onPopLayer` once it has collapsed (or flown) out.
 */
function SeriesReaderInstance({
  params,
  depth,
  onPopLayer,
  sequence,
}: {
  params: SeriesReaderParams;
  depth: number;
  onPopLayer: () => void;
  /** Present = this instance reads a cross-series sequence instead of a chapter. */
  sequence?: ReaderSequenceRun;
}) {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mock = useMockActive();
  const [settings] = useReaderSettings();

  const {
    id,
    title,
    bridge: bridgeParam,
    bridgeId,
    cover: coverParam,
    direct,
    reader: readerParam,
    chapterId: seedChapterId,
    chapterName: seedChapterName,
    start: seedStart,
  } = params;
  // Opened straight into the reader (History / Activity), rather than onto the details.
  const readerFirst = readerParam === '1';
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;
  const isDirect = direct === '1';

  // ── The visible page — and, in sequence mode, the visible ENTRY ────────────────────────────
  // Lives at this level because the TOOLBAR is rendered here (the pane reports it up through
  // `onVisiblePage`, already chapter-correct across a stitched crossing), and this high up in the
  // component because the DETAIL identity just below derives from it.
  const [visiblePage, setVisiblePage] = useState<{ pageIndex: number; chapterId: string } | null>(null);
  // The ENTRY the pager currently shows. The pane's flat index IS the sequence index, so this is
  // what the chrome (title, save button, settings sheet) and the details layer describe — the
  // instance's own route params only name the entry the album OPENED on.
  const visibleSequenceEntry = sequence
    ? sequence.entries[Math.min(visiblePage?.pageIndex ?? sequence.index, sequence.entries.length - 1)]
    : undefined;

  // ── The series the DETAILS side describes ──────────────────────────────────────────────────
  // Chapter mode: this instance's own series, always. Sequence mode: the VISIBLE entry's — the
  // album pager never remounts (a series cross must be as seamless as a stitched chapter
  // crossing, which is to say: a plain page turn), so instead of remounting the reader under a
  // new series, the details layer and the series queries RE-POINT by key. A stitched crossing's
  // relabel, one level up.
  const detailBridgeId = sequence ? (visibleSequenceEntry?.bridgeId ?? bridgeId) : bridgeId;
  const detailSeriesId = sequence ? (visibleSequenceEntry?.seriesId ?? id) : id;
  const detailTitle = sequence ? visibleSequenceEntry?.seriesTitle : title;
  const detailIsDirect = sequence ? visibleSequenceEntry?.chapterId === DIRECT_CHAPTER_ID : isDirect;
  const detailBridge = sequence ? undefined : bridge;
  const detailCover = sequence ? undefined : cover;
  const detailKey = `${detailBridgeId ?? ''}:${detailSeriesId ?? ''}`;

  // Sequence mode loads NOTHING about a series up front — no detail, no chapter roster, no
  // library membership. The reader side of an album needs none of it (the chrome describes the
  // visible entry), and an album that wanders through five series must not fetch five series'
  // details on the way. Armed PER SERIES the moment the reveal starts moving (see the reaction
  // beside `progress`): reveal on series A, collapse, cross to B — B stays unfetched until ITS
  // reveal, while A's answer sits in the query cache for an instant re-reveal. Non-sequence
  // instances are armed for their own series from mount, so their ordering contract (detail
  // dispatched at mount) is untouched.
  const [wantedKey, setWantedKey] = useState<string | null>(() => (sequence ? null : detailKey));
  const seriesWanted = wantedKey === detailKey;
  const armSeriesQueries = useCallback(() => setWantedKey(detailKey), [detailKey]);

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Chapter list (chaptered series only) — drives resume-or-first resolution and prev/next
  // adjacency for the reader pane. (The details card's own list rendering — read state, downloads,
  // versions — is SeriesBody's business, not duplicated here.)
  const { data: listData } = useQuery(
    seriesListQuery(ds, mock, detailBridgeId ?? '', detailSeriesId ?? '', false, !detailIsDirect && seriesWanted),
  );
  const chapters = listData?.chapters;

  // Library membership — picks the reader pane's progress-recording path (library series →
  // chapter progress, everything else → the reading log). The query lives HERE, not in the pane:
  // the pane re-renders on every page sweep, and useQuery's per-render subscription work (query
  // key hashing) is measurable at that cadence.
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, detailBridgeId ?? '', detailSeriesId ?? ''),
    retry: false,
    // Deferred with the rest of the series queries in sequence mode — it only picks the
    // progress-recording path, and a sequence records no progress.
    enabled: !!detailBridgeId && !!detailSeriesId && seriesWanted,
  });

  // ── Where does reading start? ────────────────────────────────────────────
  // Resume from the reading history (same lookup as useStartReading — resolved here, not at the
  // card tap, so cards in recycled lists never subscribe to history), else the first chapter in
  // reading order, else — for a direct series — the pages themselves. The derived value settles
  // once the history (and, chaptered, the chapter list) is in; after that, chapter navigation
  // OVERRIDES it. The mounted pane seeds its position once at mount, so later history refetches
  // (our own progress writes invalidate it) never yank the pager.
  const { data: history, isLoading: historyLoading } = useQuery(historyQuery(ds, mock));
  const resume = useMemo(
    () => history?.find((h) => h.bridgeId === bridgeId && h.seriesId === id),
    [history, bridgeId, id],
  );
  const derivedTarget: ReadTarget | null = useMemo(() => {
    if (historyLoading) return null;
    if (isDirect) {
      const resumeDirect = resume && (resume.chapterId === DIRECT_CHAPTER_ID || !resume.chapterId);
      return { start: resumeDirect ? (resume?.lastPage ?? 0) : 0 };
    }
    if (resume?.chapterId && resume.chapterId !== DIRECT_CHAPTER_ID) {
      return { chapterId: resume.chapterId, chapterName: resume.chapterName, start: resume.lastPage ?? 0 };
    }
    if (chapters?.length) {
      const first = firstChapterInReadingOrder(chapters, getPreferredGroup());
      if (first) return { chapterId: first.id, chapterName: first.name, start: 0 };
    }
    return null; // chapter list still loading (or empty)
  }, [historyLoading, isDirect, resume, chapters]);
  // Reader-first entries seed this from their params, which is what makes the pages query live on
  // the very first commit — no waiting on history, and the request goes out ahead of detail.
  const [override, setOverride] = useState<ReadTarget | null>(() => {
    if (!readerFirst) return null;
    const parsed = Number(seedStart);
    const at = Number.isFinite(parsed) ? parsed : 0;
    if (seedChapterId) return { chapterId: seedChapterId, chapterName: seedChapterName, start: at };
    if (direct === '1') return { start: at };
    return null;
  });
  // Sequence mode: the target is the sequence itself. `chapterId` is deliberately ABSENT — it
  // would otherwise arm the chapter-pages query, the preferred-group effect, chapter adjacency and
  // the pane's remount key, all of which are chapter machinery a sequence doesn't have. Per-entry
  // chapter identity lives on the VISIBLE entry (see visibleSequenceEntry below), not the target.
  const inSequence = !!sequence;
  const sequenceTarget = useMemo<ReadTarget | null>(
    () => (sequence ? { start: sequence.index } : null),
    // The mount index seeds the pager once; later index changes ride the pager itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once, see above
    [inSequence],
  );
  const target = sequenceTarget ?? override ?? derivedTarget;
  const targetChapterId = target?.chapterId;

  // Keep next/prev chapter following the same scanlation group.
  useEffect(() => {
    if (!targetChapterId) return;
    const group = chapters?.find((c) => c.id === targetChapterId)?.group;
    if (group !== undefined) setPreferredGroup(group);
  }, [targetChapterId, chapters]);

  // The target chapter's pages (or the direct page list). Cached per chapter, so revisiting one
  // (or skipping back) repaints from the query cache.
  const {
    data: chapterPagesData = null,
    error: queryError,
    refetch,
  } = useQuery({
    ...(targetChapterId
      ? chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', targetChapterId)
      : directPagesQuery(ds, mock, bridgeId ?? '', id ?? '')),
    // A DIRECT series' page list is just "this series' pages" — `directPagesQuery` takes nothing
    // from the read target, so waiting for one held it behind the history query for no reason
    // (history only decides which PAGE to land on, which the pane needs, not which request to
    // make). Chaptered still waits, and genuinely must: until the target resolves there is no
    // chapter id, and firing without one would ask `directPagesQuery` for a series that has none.
    enabled: !!id && (isDirect || !!target) && !sequence,
  });
  // In sequence mode the sequence IS the page list — the chapter query above never runs.
  const pages = sequence ? sequence.uris : chapterPagesData;
  // Series detail for the toolbar/settings gear (placeholder-seeded from the forwarded
  // title+cover). The details card's SeriesDetailsHost subscribes to this same query key, so this
  // costs one fetch total.
  const { data: series = null } = useQuery({
    ...seriesDetailQuery(ds, mock, detailBridgeId ?? '', detailSeriesId ?? '', {
      direct: detailIsDirect,
      bridgeName: detailBridge ?? 'Library',
      title: detailTitle,
      cover: detailCover,
    }),
    // Sequence mode: keyed to the VISIBLE entry's series, and nothing fetched until the reveal
    // asks (`seriesWanted`) — sequence chrome describes the visible entry, not this query.
    // `!!detailSeriesId` preserves the option's own guard, which this override replaces.
    enabled: !!detailSeriesId && seriesWanted,
  });
  // ORDERING, and why this query sits HERE rather than at the top of the component. React Query
  // dispatches on mount effects, which run in hook order, so declaration order IS request order
  // for anything enabled on the first commit. That gives both directions for free:
  //   · a BROWSE open — the pages query above is gated on a resolved read target, which needs
  //     history (and, chaptered, the chapter list) to come back first. Detail is dispatched at
  //     mount and wins by a mile; it needs no gate of its own.
  //   · a READER-FIRST open — the row seeds the target from its own params, so the pages query is
  //     live on the first commit and, being declared above, is dispatched first. Which is the
  //     ordering History and Activity want: the page they tapped to keep reading, then the rest.
  // Both matter on device, where the on-device runtime serves everything through one in-process
  // transport and order of arrival is order of service.
  //
  // What this replaced was `/series`'s `detailStarted` rule — an `enabled` gate on the pages query,
  // true once detail was in flight. Hook order already guarantees that, and can express the
  // reverse as well, which a gate cannot: a gate only ever holds one query back, it can never swap
  // which goes first. Nothing here delays a request that is ready to go.

  const error = !sequence && queryError ? (queryError as Error).message || 'Failed to load pages' : null;

  // ── Adjacent chapters (chaptered only; no stitching — see the header comment) ──
  const currentChapter = useMemo(
    () => (targetChapterId ? chapters?.find((c) => c.id === targetChapterId) : undefined),
    [chapters, targetChapterId],
  );
  const nextChapter = useMemo(
    () => (currentChapter && chapters ? getAdjacentChapter(chapters, currentChapter, 1, getPreferredGroup()) : null),
    [chapters, currentChapter],
  );
  const prevChapter = useMemo(
    () => (currentChapter && chapters ? getAdjacentChapter(chapters, currentChapter, -1, getPreferredGroup()) : null),
    [chapters, currentChapter],
  );
  // `landing` defaults to whichever keeps PAGING continuous: forward
  // lands on page 1, backward on the last page. The navigator's skip buttons pass 'first'.
  // This is the EXPLICIT-jump path (skip buttons, webtoon advance, cold-window edge fallbacks) —
  // it bumps `jumpNonce` so the pane remounts seeded at the landing page. Stitched paged
  // crossings never come through here; they relabel in place (see relabelFromPager).
  const [jumpNonce, setJumpNonce] = useState(0);
  const goAdjacentChapter = useCallback(
    (delta: 1 | -1, landing: 'first' | 'last' = delta === 1 ? 'first' : 'last') => {
      const chapterTo = delta === 1 ? nextChapter : prevChapter;
      if (!chapterTo) return;
      setJumpNonce((n) => n + 1);
      setOverride({ chapterId: chapterTo.id, chapterName: chapterTo.name, start: landing === 'last' ? 'last' : 0 });
    },
    [nextChapter, prevChapter],
  );

  // ── Stitching (native paged mode): the pager's window ────────────────────
  // Adjacent chapters' page lists, subscribed eagerly (cache-first; a list is just URLs) so the
  // native paged reader can stitch them into ONE flat pager — swiping across a chapter boundary
  // is then an ordinary page turn with an in-place relabel, no remount.
  // BOTH native modes stitch now. It was paged-only for as long as the pager was the only list
  // that could take a chapter joining in front of the reader without lurching — vertical mode was
  // left crossing chapters by jumping, which is why it never had the paged reader's peek of the
  // page you are about to reach, and why it needed sentinels and buttons to do what scrolling
  // should. Both readers are LegendLists that anchor on the item now, so both can hold a window.
  const stitched = !IS_WEB && !isDirect && !sequence;
  // The committed side of the reveal (declared up here — the stitching queries below gate on
  // it). The screen opens ON the details; see the reveal section further down.
  const [detailsActive, setDetailsActive] = useState(!readerFirst);
  // True while a horizontal details gesture (back-swipe or webtoon reveal) is ACTIVE. The pans
  // ride the details scroller's own detector, simultaneous with it — that's the only way they
  // activate over a UIScrollView at all (see makeBackSwipePan) — but simultaneous means the list
  // happily keeps scrolling underneath a swipe that is carrying the whole page away. Freezing
  // the scroller for the duration is the standard fix: one re-render as the gesture takes over,
  // and iOS drops its in-flight tracking the moment scrolling is disabled.
  const [swipeLocked, setSwipeLocked] = useState(false);
  // `detailsActive`, but lagging past the 240ms reveal/collapse animation: the HEAVY mode flips
  // (the standby render window, the image warm-ahead) key off THIS, so page cells mount and lists
  // re-window after the transition has finished instead of chopping it mid-flight. What must NOT
  // key off it is anything that changes the SHAPE of the stitched window — see the adjacent-chapter
  // queries below for what that cost.
  const [detailsSettled, setDetailsSettled] = useState(!readerFirst);
  // Whether the ENTRANCE animation has finished (the zoom spring's completion callback flips it —
  // see startZoom). The zoom scales the WHOLE destination screen behind a growing mask, and a
  // reader-first open whose pages are already cached (a sequence open, a History revisit) would
  // otherwise mount the entire pager — list, cells, warm-ahead — in the very commit the spring
  // starts, on the thread the spring is drawing on. So the pane rides `standby` until this flips:
  // the visible page mounts and paints (it is what the entrance reveals), everything else waits
  // out the flight — the same deferral `detailsSettled` gives the reveal, applied to the open.
  const [entranceSettled, setEntranceSettled] = useState(false);
  const markEntranceSettled = useCallback(() => setEntranceSettled(true), []);
  useEffect(() => {
    const t = setTimeout(() => {
      // Traced because this is the largest React commit anywhere near a reveal and it lands 300ms
      // after it — the standby window opens, page cells mount, both lists re-window, all at once,
      // and on iOS that commit runs on the main thread, which is the thread the reveal is drawing
      // on. Keep it: it is the mark that says whether a stutter belongs to the reveal itself or to
      // the work scheduled behind it.
      traceJS('reveal', 'settle', { details: detailsActive });
      setDetailsSettled(detailsActive);
    }, 300);
    return () => clearTimeout(t);
  }, [detailsActive]);
  // EAGER, deliberately — not deferred behind `detailsSettled` like the render window is.
  //
  // A run can only take its previous chapter at the instant it is created (see the window below),
  // so how soon these resolve decides whether the FIRST chapter boundary you read backward across
  // is seamless. Deferring them, as this did for a while, guaranteed they lost that race on every
  // cold open.
  //
  // The cost is two page LISTS — cache-first, and a list is just URLs. It does not mount page cells
  // or warm images: both of those key off `standby`/`detailsSettled` in ReaderPane, unchanged.
  const { data: prevPages, error: prevPagesError } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', prevChapter?.id ?? ''),
    enabled: stitched && !!id && !!prevChapter,
  });
  const { data: nextPages } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', nextChapter?.id ?? ''),
    enabled: stitched && !!id && !!nextChapter,
  });

  // Declared up here, though nothing sets it until the collapse reaction far below: the stitching
  // underneath has to read it.
  const [collapsing, setCollapsing] = useState(false);

  // The stitched window — the RUN: a segment only joins once its pages are loaded (no holes); it
  // only ever grows AT THE TAIL during one continuous run; landing outside the run starts a fresh
  // one, bumping `runKey` so the pane remounts and seeds from `start` instead of re-anchoring.
  //
  // ── The HEAD of a live run, and why it may grow again ────────────────────────────────────────
  // For a while nothing could ever be added in front of the current position, and the reason was
  // the pager: a FlatList's position is a raw pixel offset and its render window is a range of
  // indices derived from that offset, so putting a chapter in front of the current one moved every
  // page after it by a whole chapter while the offset stayed put. The correction that followed —
  // find the anchored key, scroll there — arrived at the right place with nothing mounted, because
  // the window had been computed from the old position. THAT was the flash on this screen, chased
  // twice from the wrong end (first blamed on the adjacent-chapter queries being deferred, then on
  // their being eager; the arrival TIME was never the problem, the head insert was).
  //
  // The pager is a LegendList now, which holds item sizes BY KEY and anchors a data change on the
  // item rather than on an offset or a view (`maintainVisibleContentPosition={{ data: true }}` —
  // see paged-reader.tsx for the full why). A chapter arriving at the head is absorbed with the
  // page under the reader's thumb left exactly where it is, so the head can grow again: reading
  // backward stays a page turn chapter after chapter instead of turning into a jump at the second
  // boundary.
  //
  // The hold below stays anyway. A window that is right when it is BUILT never has to anchor
  // anything, and the cheapest correction is the one that doesn't happen.
  //
  // ── …and why the window is worth WAITING a beat for ─────────────────────────────────────────
  // Creation being the only moment a run can take its previous chapter makes that moment worth
  // getting right. A run created the instant this chapter's own pages land is a run created into
  // a race: the neighbour's list was requested in the same commit and is usually a beat behind, so
  // the window came out one chapter short and the boundary it was short of was the one the reader
  // was parked on — swipe back from page 1 and there was nothing there to swipe to.
  //
  // So a NEW run holds for the previous chapter's list, and the pane holds with it (`readerReady`
  // below) rather than mounting onto a window that is about to be wrong. Not indefinitely: the
  // hold is capped at PREV_WINDOW_GRACE_MS, past which the run is created without it and the
  // backward boundary falls back to the pager's off-the-end hand-off (paged-reader's `edgeTurn`),
  // which crosses by jumping rather than by turning. The cap is what keeps a slow or dead source
  // from holding the reader: it can cost a moment of the "Loading…" that was already on screen,
  // never the page itself.
  //
  // What it must NOT become is a wait for something already in hand — every neighbour list is
  // fetched eagerly and persisted, so the second visit to a boundary resolves in the same render
  // and holds for nothing at all.
  const [run, setRun] = useState<{ key: number; segs: Segment[] }>({ key: 0, segs: [] });
  // The grace clock, armed the moment a run COULD be created (this chapter's pages are in) and
  // belonging to that chapter, so navigating re-arms it. Keyed by string rather than timestamped so
  // nothing here has to read a clock during render. A chapter whose grace has run out stays run out
  // for the life of this screen, deliberately: by then its neighbour's list has either arrived — in
  // which case it is cached and the next run takes it with no wait at all — or it is not coming,
  // and waiting a second time would buy the same nothing twice.
  const graceKey = pages && stitched ? (targetChapterId ?? DIRECT_CHAPTER_ID) : null;
  const [graceOverFor, setGraceOverFor] = useState<string | null>(null);
  useEffect(() => {
    if (!graceKey) return;
    const t = setTimeout(() => setGraceOverFor(graceKey), PREV_WINDOW_GRACE_MS);
    return () => clearTimeout(t);
  }, [graceKey]);
  const { segments, runKey } = useMemo(() => {
    if (!pages || !stitched) return { segments: NO_SEGMENTS, runKey: run.key };
    const currentId = targetChapterId ?? DIRECT_CHAPTER_ID;
    const prevSeg: Segment | null =
      targetChapterId && prevChapter && prevPages?.length
        ? { id: prevChapter.id, name: prevChapter.name, pages: prevPages }
        : null;
    const nextSeg: Segment | null =
      targetChapterId && nextChapter && nextPages?.length
        ? { id: nextChapter.id, name: nextChapter.name, pages: nextPages }
        : null;

    const at = run.segs.findIndex((s) => s.id === currentId);
    if (at === -1) {
      // The hold (see above). It waits on the RESPONSE, not on a usable segment: a chapter that
      // comes back with no pages, or a request that comes back an error, has answered — there is
      // nothing further to wait for and the run is created without it. `NO_SEGMENTS` — one stable
      // array, not a fresh `[]` — because this return feeds the adjust-state-on-render below, and
      // a new identity every render is an infinite loop.
      //
      // Not knowing yet whether there IS a previous chapter counts as waiting, and that case is
      // not exotic — it is how RESUMING works. A resumed target comes from the reading history,
      // which is local and instant, so the pages request goes out (and can come back) while the
      // chapter LIST is still in flight; until that list lands there is no `prevChapter` to have a
      // page list for, and a run built in that gap is built blind. The same grace covers it.
      const awaitingPrev =
        !!targetChapterId && (!chapters || (!!prevChapter && prevPages === undefined && !prevPagesError));
      if (awaitingPrev && graceOverFor !== currentId) return { segments: NO_SEGMENTS, runKey: run.key };
      const segs: Segment[] = [];
      if (prevSeg) segs.push(prevSeg);
      segs.push({ id: currentId, name: target?.chapterName, pages });
      if (nextSeg) segs.push(nextSeg);
      // Bump the key only when there was a real run to leave, so the very first window doesn't
      // count as a remount.
      return { segments: segs, runKey: run.key + (run.segs.length ? 1 : 0) };
    }
    // Extend at either end. The TAIL is free by construction (nothing before it moves). The HEAD is
    // the list's job, and the reason this file can ask for it at all — see the note above.
    //
    // ── The wobble, and why it isn't a reason to stop asking ─────────────────────────────────────
    // Growing the head of the CONTINUOUS strip visibly nudged the content: a trace caught the window
    // gaining 13 rows, the content height gaining 7427, and the offset gaining 7400 — 27px of drift
    // — then 78 against 36 on the next frame as those rows measured. The obvious reading was that
    // variable row heights make this irreducible (a correction computed against an estimate that
    // isn't true yet), and the obvious fix was to stop growing the head where sizes are unknown.
    //
    // That reading was wrong, and the version number is why. This app was pinned to legend-list
    // 3.3.2; 3.3.3 fixes precisely these two things — "row measurements are applied together in a
    // batch, so item positions don't sometimes move after rendering" and "prepending items with
    // maintainVisibleContentPosition was sometimes flashing the wrong items for one frame". Holding
    // a viewport still across a prepend of unmeasured rows is what the list is FOR; ours simply
    // couldn't yet. So the head grows in both readers, and the fix lives at the version.
    const stale = run.segs[at]!;
    const refreshCurrent = stale.pages !== pages || stale.name !== target?.chapterName;
    // Not while a dismiss is in flight. Growing the strip is the expensive edit in here — the head
    // grow above measures a whole window of new rows and corrects the offset against them — and a
    // neighbour's page list arriving happens to land mid-gesture often, because the same tap that
    // opened the reader requested it. Traced at 187ms of stalled UI thread inside a held collapse,
    // spent extending a reading window the reader is on its way out of. The current chapter still
    // refreshes: that one is what's on screen.
    const addPrev = !collapsing && !!prevSeg && at === 0;
    const addNext = !collapsing && !!nextSeg && run.segs[run.segs.length - 1]!.id === currentId;
    if (!refreshCurrent && !addPrev && !addNext) return { segments: run.segs, runKey: run.key };
    const segs = run.segs.slice();
    if (refreshCurrent) segs[at] = { id: currentId, name: target?.chapterName, pages };
    if (addPrev) segs.unshift(prevSeg);
    if (addNext) segs.push(nextSeg);
    return { segments: segs, runKey: run.key };
  }, [
    run,
    pages,
    stitched,
    targetChapterId,
    target?.chapterName,
    chapters,
    prevChapter,
    prevPages,
    prevPagesError,
    nextChapter,
    nextPages,
    graceOverFor,
    collapsing,
  ]);
  // Catch the run state up DURING render (React's adjust-state-on-render pattern — the merge
  // above returns `run.segs` by identity when there's nothing to add, which is what stops this
  // from looping). `!pages` (a chapter still loading) renders no window at all, but must not wipe
  // the run — the pager is unmounted then and comes back to the same one.
  if (pages && stitched && (segments !== run.segs || runKey !== run.key)) {
    setRun({ key: runKey, segs: segments });
  }

  // Ready to read: the target's own pages, AND — where the pager is stitched — the window they go
  // in. Holding the pane back for the window is the point of the hold above: a pane mounted onto a
  // one-chapter window reads `initialPage` there and then, and no later arrival can move it.
  const readerReady = !!target && !!pages && (!stitched || segments.length > 0);

  // What the reader side has to render, and WHEN it got it. A flash on the first reveal is a
  // question about ordering — whether the reader becomes the visible side before it has pages, and
  // for how long — and that is only answerable against the reveal mark on the same clock. Both
  // halves are traced rather than reasoned about because the difference between "300ms of Loading"
  // and "one frame with nothing opaque behind it" is invisible in source and obvious in a
  // recording.
  useEffect(() => {
    traceJS('reader', 'ready', {
      ready: readerReady,
      target: !!target,
      pages: pages?.length ?? 0,
      segs: segments.length,
    });
  }, [readerReady, target, pages, segments]);

  // The backward jump's destination, warmed. Wherever the previous chapter is not in the pager's
  // window — the whole of vertical mode, which never stitches, plus the paged cases where the
  // window couldn't take it — going back lands on that chapter's LAST page, and the pane's own
  // warm-ahead can't reach it: that walks the window, and this page is outside it by definition. So
  // the screen warms the few pages the jump can land on, and the crossing arrives on an image like
  // any other. Standby is excluded like every other image request on this screen.
  useEffect(() => {
    if (!stitched || detailsSettled || !prevChapter || !prevPages?.length) return;
    if (segments.some((s) => s.id === prevChapter.id)) return;
    warmPageImages(prevPages.slice(-1 - WARM_BEHIND));
  }, [stitched, detailsSettled, prevChapter, prevPages, segments]);

  // A stitched crossing settled: flush of the OLD chapter's progress already happened in the pane;
  // this just relabels which chapter is "current" WITHOUT remounting (the pane's key is the run,
  // not the chapter, and the window merge above finds the new current already in `run.segs`).
  const relabelFromPager = useCallback((chapterId: string, chapterName: string | undefined, page: number) => {
    // Marked so a boundary adjustment can be told apart from the window growing around it — the
    // two land within a frame or two of each other and want different fixes. See the vertical
    // reader's `window`/`scroll` marks.
    traceJS('reader', 'relabel', { page });
    setOverride({ chapterId, chapterName, start: page });
  }, []);

  // ── Chrome auto-hide ───────────────────────────────────────────────────────
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeHeldRef = useRef(false);
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!CHROME_AUTO_HIDE || chromeHeldRef.current) return;
    hideTimer.current = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  }, []);
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);
  const showChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleHide();
  }, [scheduleHide]);
  const holdChrome = useCallback(
    (hold: boolean) => {
      chromeHeldRef.current = hold;
      if (hold) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      } else {
        setChromeVisible(true);
        scheduleHide();
      }
    },
    [scheduleHide],
  );
  const toggleChrome = useCallback(() => {
    setChromeVisible((v) => {
      const nextVisible = !v;
      if (nextVisible) scheduleHide();
      else if (hideTimer.current) clearTimeout(hideTimer.current);
      return nextVisible;
    });
  }, [scheduleHide]);

  // Pinch-zoom / an active scrub both suspend the reveal pan (a one-finger drag pans the zoomed
  // page; a scrub owns the finger).
  const [readerZoomed, setReaderZoomed] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const onScrubActive = useCallback(
    (active: boolean) => {
      setScrubbing(active);
      holdChrome(active);
    },
    [holdChrome],
  );

  // ── The reveal: reader ⇄ details card ────────────────────────────────────
  // `progress` (0 = reader, 1 = details) is the single source of truth, written on the UI thread
  // by the pans below and animated by `setRevealed`. `detailsActive` mirrors the committed side
  // for everything JS-side (gesture enabling, back handling, status bar). The screen opens ON the
  // details (reader collapsed to the strip) — unless `reader: '1'` brought us here, in which case
  // it opens on the READER and the details are one swipe away, which is the same gesture either
  // entry ends up using.
  const progress = useSharedValue(readerFirst ? 0 : 1);
  // The details page's internal scroll offset (SeriesBody's list writes it on the UI thread via
  // the same `sharedValues` wiring pull-to-refresh uses) — drives the strip occlusion, the top
  // bar's scroll crossfade, and the pull-past-top reveal.
  const detailsScrollOffset = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset: detailsScrollOffset }), [detailsScrollOffset]);
  // UI-thread mirror of `detailsActive`, for the worklets below (the iOS pull-follow must stop the
  // instant a commit animation takes over `progress`).
  const detailsActiveSV = useSharedValue(!readerFirst);
  // `dismissing` freezes the collapse pan once an exit animation owns the transition. (It used to
  // sit beside `dismissX`/`dismissY`, the old swipe-away's 2D offsets; the swipe-away drives the
  // collapse itself now, so those are gone and this is what's left of that trio.)
  const dismissing = useSharedValue(false);
  // The iOS pull-past-top follow (the reaction below): whether it currently owns `progress`,
  // and where `progress` stood when the pull engaged (the pull maps relative to it).
  const pullEngagedSV = useSharedValue(false);
  const pullStartSV = useSharedValue(1);

  // Arms the deferred series queries (`seriesWanted`, sequence mode) the moment the reveal STARTS
  // moving — not when it commits — so the card the swipe uncovers is already fetching, for the
  // series the swipe is revealing. Non-sequence instances are armed from mount; the arm is a
  // no-op there.
  useAnimatedReaction(
    () => progress.value > 0.02,
    (revealing, was) => {
      if (revealing && !was) runOnJS(armSeriesQueries)();
    },
    [armSeriesQueries],
  );

  // JS-side half of a commit — deliberately closes over nothing but state setters (no shared
  // values, no timer refs), so the gesture worklets can `runOnJS` it; the worklets animate
  // `progress` themselves. Landing back in the reader re-shows the chrome (it may have auto-hidden
  // while the details were up) — the effect below re-arms the countdown.
  const commitReveal = useCallback((to: 0 | 1) => {
    // `to` 0 means the READER is now the side on screen. Traced because the reported flash is on
    // that transition specifically, and the question is what the reader side has to show at the
    // instant it becomes visible — see the `reader ready` mark below for the other half.
    traceJS('reveal', 'commit', { toReader: to === 0 });
    setDetailsActive(to === 1);
    if (to === 0) setChromeVisible(true);
  }, []);
  useEffect(() => {
    if (!detailsActive) scheduleHide();
  }, [detailsActive, scheduleHide]);
  // Full JS-side reveal (pill, grab-handle, hardware back, chapter/page intents).
  const setRevealed = useCallback(
    (to: 0 | 1) => {
      detailsActiveSV.set(to === 1);
      pullEngagedSV.set(false); // the commit animation owns `progress` — stop any live pull-follow
      progress.set(withTiming(to, { duration: 240, easing: Easing.out(Easing.cubic) }));
      commitReveal(to);
    },
    [progress, detailsActiveSV, pullEngagedSV, commitReveal],
  );

  // The collapsed reader strip is the top of the details PAGE, so its reveal is the page's own
  // overscroll — any pull past the top rides the native rubber-band down, with the whole page
  // (background sheet + content, see headerSheetBgStyle) following the finger and the reader
  // fading in above. No arming/freeze: the content moving WITH the pull is the point.
  //
  // Like the pans, the follow is RELATIVE: it engages only when the offset crosses past the top
  // (capturing `progress` where it stands, so a pull that begins mid-animation continues the
  // motion instead of snapping to the absolute position), and a release that didn't commit
  // ANIMATES back to the details rather than hard-setting. Without the engage gate, the
  // rubber-band bounce still settling after a pull-commit would stomp a quick follow-up
  // collapse animation — the "completes instantly" chop.
  const headerSpan = Math.max(1, height - (insets.top + HEADER_BAND));
  // The details travel VERTICALLY in both reading modes. Webtoon used to reveal them horizontally
  // — they exited left, uncovering the reader — on the theory that vertical finger language
  // belongs to the scroll there. That is still true of the GESTURE, and is why webtoon no longer
  // reveals the details by dragging at all (see the collapse pan): the Details button is the way
  // back. But the button's animation has no axis to match, and having the two modes slide the
  // page in different directions made the same control behave like two different controls.
  // The details list's own scrolling, in the same timeline as the gestures. This is how a trace
  // distinguishes "the scroller took the touch stream" from "nothing claimed it": scroll offset
  // moving between a BEGAN and a missing START is the native recognizer winning the contest.
  const scrollTraceGate = useMemo(() => traceGate(), []);
  useAnimatedReaction(
    () => detailsScrollOffset.value,
    (off, prevOff) => {
      traceThrottled(scrollTraceGate, 60, 'details.scroll', 'offset', { y: off, active: detailsActiveSV.value });
      if (!IS_IOS) return;
      if (!detailsActiveSV.value) {
        // A commit's animation owns `progress` now; the leftover bounce must not re-engage.
        pullEngagedSV.set(false);
        return;
      }
      if (off < 0) {
        if ((prevOff ?? 0) >= 0) {
          pullEngagedSV.set(true);
          pullStartSV.set(progress.value);
        }
        if (pullEngagedSV.value) {
          progress.set(Math.max(0, Math.min(1, pullStartSV.value + off / headerSpan)));
        }
      } else if (pullEngagedSV.value) {
        pullEngagedSV.set(false);
        if (progress.value < 1) {
          progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        }
      }
    },
    [headerSpan, detailsScrollOffset, detailsActiveSV, pullEngagedSV, pullStartSV, progress, scrollTraceGate],
  );
  const onDetailsScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      traceJS('details.scroll', 'endDrag', { y: e.nativeEvent.contentOffset.y, active: detailsActive });
      if (!IS_IOS || !detailsActive) return;
      // The UI-thread release watcher (pullReleaseWatch below) usually lands this commit first;
      // the shared-value mirror is already false then — don't restart its animation. This JS
      // path remains the full fallback when those touches weren't observed.
      if (!detailsActiveSV.get()) return;
      if (e.nativeEvent.contentOffset.y <= -PULL_COMMIT_PX) setRevealed(0);
    },
    [detailsActive, detailsActiveSV, setRevealed],
  );

  // Leaving this instance. The modal ROOT pops the route (deep-linked/full-page-loaded entries
  // on web have no back stack — land on the browse tabs instead of dead-ending). A drilled
  // LAYER never touches navigation: it collapses on the same `zoom` the back-swipe drags
  // (closeLayer — chevron/hardware back), or is removed outright once a gesture has already
  // collapsed it / flown the page out (leaveNow — the parent series is live beneath).
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  const leaveNow = useCallback(() => {
    // Bracketed in the trace with the unmount below, so a recording measures the TEARDOWN — popping
    // the route, unmounting the page, un-blanking the source card — as its own span. It is the last
    // thing that happens on a collapse and the only thing left at that end of it; `frame LONG` lines
    // falling between these two say what it costs, which is the number any attempt to shrink it
    // would have to beat.
    traceJS('leave', 'start', { depth });
    if (depth > 0) onPopLayer();
    else goBack();
  }, [depth, onPopLayer, goBack]);
  useEffect(() => () => traceJS('leave', 'unmounted', { depth }), [depth]);
  // The other end of the page's life. Teardown measured 9-44ms and turned out not to be worth
  // attacking; this is the half that hasn't been measured, and it is the larger one — a whole
  // details tree mounts here while the entrance animation plays.
  useEffect(() => traceJS('open', 'mount', { depth }), [depth]);
  // EVERY exit animation ends here rather than calling `leaveNow` directly, because an animation
  // callback is not a promise that it ran: reanimated reports `finished: false` for a curve that
  // got interrupted, and an exit that reached its end state without leaving stranded the page —
  // mounted, invisible or shrunk, and still swallowing touches. So the exits below fire this
  // whether or not the curve finished, AND arm a wall-clock backstop, and this makes the extra
  // calls harmless.
  /**
   * …and this latch is what makes them harmless. It is a PLAIN JS BOX, and that is the fix for a
   * real bug rather than a style preference.
   *
   * It used to be a shared value, on the reasoning that the pan is built during render so nothing
   * its worklets reach may touch a React ref. True of the worklets — but `leaveOnce` is not one.
   * Every caller reaches it through `runOnJS`, so it only ever executes on the JS thread, where a
   * shared value is the wrong instrument: a `.set()` here is not guaranteed visible to a `.get()`
   * in the next JS task, because the value's home is the UI thread. So two exits firing off one
   * frame — the leave reaction and the collapse spring's completion, which by design both mean
   * "arrived" — each read the latch as false and each ran.
   *
   * A device trace caught it exactly:
   *
   *     leave start depth=2 / layer pop from=2 left=1
   *     leave start depth=2 / layer pop from=1 left=0
   *
   * One instance leaving, two pops — so dismissing a series drilled from a search layer took the
   * search layer with it and landed back on the series underneath. Only via the swipe, because the
   * chevron path has a single caller and never exercises the latch at all.
   *
   * Held in a module-level WeakSet keyed on a per-instance token, which is the one shape both lint
   * rules allow here: `useRef` is out because the pan is built during render, and mutating a
   * `useMemo` result is out too — so the memo hands out an identity and the mutation happens in the
   * set. Plain JS, one thread, no cross-runtime visibility to reason about.
   */
  const token = useMemo(() => ({}), []);
  const leaveOnce = useCallback(() => {
    if (LEFT.has(token)) return;
    LEFT.add(token);
    leaveNow();
  }, [token, leaveNow]);
  // NOTE: nothing here tracks "this page is leaving". It used to — `const [leaving, setLeaving] =
  // useState(false)`, flipped from inside the commit — and that re-rendered all of
  // SeriesReaderInstance on the frame the collapse animation started. Profiles measured that render
  // at 40–114ms, and on iOS the UI thread IS the main thread, so the native commits behind it land
  // on the one thread the animation needs. A stutter on every single exit, unreachable by any amount
  // of animation tuning because the animation was never the problem. The two things that flag bought
  // — dropping touches on a page on its way out, and the wall-clock backstop — both live in
  // `LeavingMask` now, which reads `edgeCommitting` itself and re-renders nothing but itself.

  // ── The zoom's shared values ────────────────────────────────────────────────────────────────
  // Hoisted above the gestures because BOTH of them drive the collapse now: the back-swipe and
  // the expanded reader's dismiss. Their comments live with the machinery that reads them.
  // …and the DESTINATION BOUND: this page's own hero cover, measured. The library takes this from a
  // `Transition.Boundary.View` in the destination screen and its whole zoom is built around the
  // pairing — the destination's copy of the picture is what lands on the tapped card, which is why
  // its demo reads as the thumbnail itself expanding. Aligning to anything else (the reader band,
  // as the first cut of this port did) puts unrelated content in the card-shaped window and the
  // connection to the thumbnail is lost.
  // 0 = the thumbnail is sitting on its card and the page is invisible, 1 = the page is up and
  // the thumbnail is gone.
  const zoom = useSharedValue(0);
  // The entrance waits for that measurement — the library does the same, holding the pair until
  // both ends have reported. Invisible here: the page is at opacity 0 until the spring starts, so
  // a frame or two of waiting just shows the untouched grid. A deadline caps it, after which the
  // transition falls back to the library's own no-destination behaviour (see zoomGeom).
  //
  // ARMING matters as much as waiting. `measureInWindow` reports a view's rect AFTER every
  // ancestor transform, so measuring the cover while the page is already scaled hands back a
  // shrunken rect — and a destination smaller than the source inverts the scale, which is the page
  // starting large and settling down to its real size. So the page stays at IDENTITY (invisible,
  // opacity 0) until the bound is in; only then do the transform and the mask engage. That is what
  // the library means by keeping a component at its base layout for pre-animation measurement.
  const zoomArmed = useSharedValue(false);
  // Which set of cross-fade ranges is in play (see the constants) — an exit uses different ones.
  const zoomClosing = useSharedValue(false);
  // The flying copy's IMAGE aspect (w/h), captured from its own onLoad. 0 = not yet known. What
  // the sequence-mode copy morph needs (see zoomThumbStyle): the copy's rect interpolates toward
  // the image's true fit rect, and only the image itself knows its shape.
  const zoomThumbAspect = useSharedValue(0);
  // Back-swipe (details mode): the native stack's pop gesture, recreated — the route is a
  // contained transparent modal (needed for the reader's dismissal reveal), which doesn't get
  // the real one. A decisive rightward drag ANYWHERE on the details (full-surface, like the
  // platform's full-screen pop) starts the COLLAPSE under the finger, and on release finishes it
  // from wherever it got to. It no longer slides the page off sideways: the drag scales the page
  // down in place, with resistance on the drag axis and a loose follow on the cross axis, exactly
  // as the reader's own swipe-away treats a page — and then hands that scale straight into the
  // gallery collapse. See the drag helpers above; this is the library's zoom/drag.ts model.
  //
  //  · zoom itself is what the finger moves — 1 open, 0 collapsed onto the card.
  //  · dragX/dragY — the resisted follow, added to the page's transform and faded out by the
  //    collapse, so a page released well off to the side still lands exactly on its card.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const edgeCommitting = useSharedValue(false);

  /**
   * THE leave trigger: the page having actually reached the card. One reaction for every exit —
   * the chevron, hardware back, the reader's dismiss fling, and the details back-swipe.
   *
   * All four used to leave from their own spring's completion callback, deliberately ignoring
   * `finished` on the grounds that an interrupted collapse is still a collapse and a page that
   * animates out without leaving is stranded. That reasoning holds for a curve interrupted AT its
   * end state. It is exactly wrong for one interrupted at the START — and something opening the
   * page can still be writing `zoom` a moment later (the entrance spring, a late `startZoom` once
   * the hero cover measures — see ZOOM_BOUND_WAIT_MS). Any such write cancels the collapse, the
   * callback fires regardless, and the page vanishes on the frame the finger lifted. Which is
   * precisely the report: close soon after opening and the animation "finishes as soon as I let go".
   *
   * Asking the VALUE instead of the curve removes the whole class. It cannot fire early, because
   * zoom at the card is what leaving means; and it cannot strand the page, because a collapse that
   * gets cancelled before arriving is still covered by the wall-clock backstop above.
   */
  useAnimatedReaction(
    () => edgeCommitting.value && zoom.value <= LEAVE_AT_ZOOM,
    (arrived, was) => {
      if (arrived && !was) runOnJS(leaveOnce)();
    },
  );

  // Collapse/dismiss pan — wraps the expanded reader, on the cross axis of its scroll: the
  // collapse direction (up in paged, right in webtoon) slides the details back in; the opposite
  // direction dismisses — and that dismissal now runs THE SAME GALLERY COLLAPSE the back-swipe and
  // the chevron run: mask closing onto the card, page cross-fading out, the thumbnail copy fading
  // in and landing on it. The finger-follow is free and unclamped in 2D and the release decision
  // reads the cross-axis offset alone — what a dismissal must NOT do is fling out along the
  // gesture's own vector, which had nowhere to land. Built inside
  // useMemo like chapter-navigator's pan (the React Compiler lint can't tell worklets from render
  // code).
  const collapseEnabled = !detailsActive && !readerZoomed && !scrubbing;
  // Each GESTURE is one thing, decided at activation and locked: a drag that sets off toward the
  // details is a reveal (progress only, and paged only); anything else is a dismiss — a free 2D
  // follow in BOTH directions, released on the |cross| decision below, driving the
  // collapse. A new gesture that begins while the page hasn't settled from a previous dismiss drag
  // is always a dismiss — only a settled page reveals the details on a swipe.
  const gestureMode = useSharedValue<0 | 1 | 2>(0); // 0 undecided, 1 reveal, 2 dismiss
  // Where `progress` stood when the gesture locked — drags map RELATIVE to it, so a gesture that
  // begins mid-animation continues the motion from where it is instead of snapping to the drag's
  // absolute position (the "fast-forward" chop under quick successive swipes).
  const progressStartSV = useSharedValue(0);
  const panBeganSV = useSharedValue(false);
  const collapsePan = useMemo(() => {
    const revealByDrag = settings.mode === 'paged';
    const dismissSpan = settings.mode === 'paged' ? height : width;
    const span = settings.mode === 'paged' ? headerSpan : width;
    {
      const collapseGate = traceGate();
      const pan = Gesture.Pan()
        .enabled(collapseEnabled)
        .onBegin(() => {
          trace('reader.collapse', 'BEGAN');
        })
        .onUpdate((e) => {
          traceThrottled(collapseGate, 60, 'reader.collapse', 'update', {
            tx: e.translationX,
            ty: e.translationY,
            mode: gestureMode.value,
          });
          // detailsActiveSV double-checks `enabled` INSIDE the worklet — RNGH web can keep a
          // rebuilt-disabled recognizer live, and a stale reader pan must never act while the
          // details own the screen (and vice versa for returnPan below).
          if (dismissing.value || detailsActiveSV.value) return;
          const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
          // Lock the gesture's mode at the first REAL movement (web fires its opening updates
          // with translation 0 — deciding on that frame mislabels every drag). A gesture
          // beginning while the page hasn't settled from a previous dismiss drag is always a
          // dismiss gesture.
          if (gestureMode.value === 0) {
            const settled = zoom.value > 0.999 && Math.hypot(dragX.value, dragY.value) <= 1;
            if (!settled) gestureMode.set(2);
            else if (Math.abs(cross) >= 2) {
              // WEBTOON never reveals by dragging — the Details button is the only way back, so
              // every drag here is a dismiss. Its cross axis is horizontal (vertical belongs to
              // the scroll), and a horizontal drag that revealed would be the one gesture on this
              // screen going somewhere other than out.
              gestureMode.set(revealByDrag && cross <= 0 ? 1 : 2);
              progressStartSV.set(progress.value);
            } else return; // no meaningful movement yet
          }
          if (gestureMode.value === 1) {
            progress.set(Math.min(1, Math.max(0, progressStartSV.value + -cross / span)));
            return;
          }
          // The follow: both axes, unclamped — feeding the collapse instead of a fling. Distance
          // in ANY direction drives it, since unlike the back-swipe this gesture has no single
          // axis to measure along.
          zoomClosing.set(true);
          zoom.set(
            1 - Math.min(1, Math.hypot(e.translationX, e.translationY) / (dismissSpan * ZOOM_DRAG_TRAVEL)),
          );
          dragX.set(e.translationX);
          dragY.set(e.translationY);
        })
        .onEnd((e) => {
          trace('reader.collapse', 'END', {
            mode: gestureMode.value,
            vx: e.velocityX,
            vy: e.velocityY,
            dismissing: dismissing.value,
            active: detailsActiveSV.value,
          });
          if (dismissing.value || detailsActiveSV.value) return;
          if (gestureMode.value === 1) {
            const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
            const crossVelocity = settings.mode === 'paged' ? e.velocityY : -e.velocityX;
            // Same projected release as everywhere else, along the direction that OPENS the
            // details (which is negative `cross`).
            const open = releaseCommitted(-cross, -crossVelocity, span * REVEAL_COMMIT_FRACTION);
            detailsActiveSV.set(open);
            progress.set(withTiming(open ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) }));
            runOnJS(commitReveal)(open ? 1 : 0);
            return;
          }
          // The release decision — the shared projection (lib/gesture-release), judged along the
          // direction the page actually travelled, since this one can be thrown off either side.
          const crossOffset = settings.mode === 'paged' ? dragY.value : dragX.value;
          const crossVelocityRaw = settings.mode === 'paged' ? e.velocityY : e.velocityX;
          if (!releaseCommittedEitherWay(crossOffset, crossVelocityRaw, dismissSpan * DISMISS_COMMIT_FRACTION)) {
            zoomClosing.set(false);
            zoom.set(withSpring(1, SPRING_BACK));
            dragX.set(withSpring(0, SPRING_BACK));
            dragY.set(withSpring(0, SPRING_BACK));
            return;
          }
          // …and the collapse finishes from wherever the drag left it, into the card. Same springs,
          // same velocity handoff and the same one-way `edgeCommitting` latch as the back-swipe —
          // see there for why a committed collapse must never be settled back.
          dismissing.set(true);
          edgeCommitting.set(true);
          const throwSpeed = zoomThrowSpeed(Math.hypot(e.velocityX, e.velocityY), dismissSpan, zoom.value);
          zoom.set(
            // overshootClamping: there is nothing past "collapsed", so the spring must not travel
            // through 0 and settle back up to it. No completion callback — leaving is driven by
            // `zoom` actually reaching the card (see the reaction near leaveOnce).
            withSpring(0, { ...ZOOM_OUT_SPRING, overshootClamping: true, velocity: -throwSpeed }),
          );
          dragX.set(withSpring(0, ZOOM_OUT_SPRING));
          dragY.set(withSpring(0, ZOOM_OUT_SPRING));
        })
        // Always fires once the gesture resolves (release OR cancel) — the next gesture decides
        // its own mode fresh.
        .onFinalize((_e, success) => {
          // A cancelled dismiss drag never reaches onEnd — don't leave the page part-collapsed.
          // Same `success` test as the back-swipe's, for the same reason.
          if (gestureMode.value === 2 && !success) {
            zoomClosing.set(false);
            zoom.set(withSpring(1, SPRING_BACK));
            dragX.set(withSpring(0, SPRING_BACK));
            dragY.set(withSpring(0, SPRING_BACK));
          }
          gestureMode.set(0);
        });
      // The back-swipe's ACTIVATION-side dominance (lib/back-swipe), applied to whichever axis this
      // mode dismisses along: paged drags across the pages' axis (vertical), webtoon across the
      // scroll's (horizontal). The activation half, not the strict release angle — this pan has no
      // release-time second look, so its one gate has to stay generous enough to catch real drags.
      // The DISTANCE stays this surface's own: nothing here is racing a scroller for the claim, so
      // it can afford to ask for more travel before it takes the gesture.
      const cross = Math.round(COLLAPSE_ACTIVATE_PX * BACK_ACTIVATE_DOMINANCE);
      if (settings.mode === 'paged') {
        pan.activeOffsetY([-COLLAPSE_ACTIVATE_PX, COLLAPSE_ACTIVATE_PX]).failOffsetX([-cross, cross]);
      } else {
        pan.activeOffsetX([-COLLAPSE_ACTIVATE_PX, COLLAPSE_ACTIVATE_PX]).failOffsetY([-cross, cross]);
      }
      return pan;
    }
  }, [
    settings.mode,
    collapseEnabled,
    width,
    height,
    headerSpan,
    gestureMode,
    progressStartSV,
    progress,
    dismissing,
    detailsActiveSV,
    commitReveal,
    zoom,
    zoomClosing,
    dragX,
    dragY,
    edgeCommitting,
  ]);

  // Band pan. The strip (the reader band at the top of the details page) expands the reader the
  // same way the page's own overscroll does: a tap, or a DOWNWARD drag that slides the whole
  // details page down under the finger. (The expanded reader's gestures are collapsePan above.)
  const bandPan = useMemo(() => {
    // The drag axis follows the reveal axis: paged drags the strip DOWN (the details slide down
    // away); horizontal-reveal (webtoon) drags it LEFT (the details exit left). Same relative
    // follow + commit either way.
    const span = headerSpan;
    const pan = Gesture.Pan()
      .enabled(detailsActive)
      .onUpdate((e) => {
        if (!detailsActiveSV.value) return;
        if (!panBeganSV.value) {
          panBeganSV.set(true);
          progressStartSV.set(progress.value);
        }
        const toward = e.translationY;
        progress.set(Math.max(0, Math.min(1, progressStartSV.value - toward / span)));
      })
      .onEnd((e) => {
        if (!detailsActiveSV.value) return;
        const toward = e.translationY;
        const towardVelocity = e.velocityY;
        const open = releaseCommitted(toward, towardVelocity, span * REVEAL_COMMIT_FRACTION);
        detailsActiveSV.set(!open);
        progress.set(withTiming(open ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        runOnJS(commitReveal)(open ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
    pan.activeOffsetY([-20, 20]).failOffsetX([-15, 15]);
    return pan;
  }, [detailsActive, headerSpan, panBeganSV, progressStartSV, progress, detailsActiveSV, commitReveal]);

  // Reveal pan — on the details layer, for platforms without the native rubber-band (the iOS
  // path is the reaction above). Both modes now, since the reveal is vertical everywhere: the
  // details page reveals the reader by moving DOWN, sharing the vertical axis with
  // the details' own scroller, so it activates MANUALLY — only a clearly-downward drag with the
  // content at its top pulls the page down; everything else fails fast and the list scrolls.
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const returnPan = useMemo(() => {
    // Horizontal-reveal mode has no vertical pull-reveal (a downward drag must not slide the
    // page sideways) — the leftward reveal pan below is its gesture.
    return Gesture.Pan()
      .enabled(detailsActive && !IS_IOS)
      .manualActivation(true)
      .onTouchesDown((e) => {
        const t = e.allTouches[0]!;
        touchStartX.set(t.x);
        touchStartY.set(t.y);
      })
      .onTouchesMove((e, mgr) => {
        const t = e.allTouches[0]!;
        const dx = t.x - touchStartX.get();
        const dy = t.y - touchStartY.get();
        if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) {
          mgr.fail();
          return;
        }
        if (dy < -16) {
          mgr.fail(); // scrolling the details content up
          return;
        }
        if (dy > 16) {
          if (detailsScrollOffset.get() <= 1) mgr.activate();
          else mgr.fail();
        }
      })
      .onUpdate((e) => {
        // detailsActiveSV double-checks `enabled` INSIDE the worklet — RNGH web can keep a
        // rebuilt-disabled recognizer live, and a stale details pan must never act while the
        // reader owns the screen.
        if (!detailsActiveSV.value) return;
        if (!panBeganSV.value) {
          panBeganSV.set(true);
          progressStartSV.set(progress.value);
        }
        progress.set(Math.max(0, Math.min(1, progressStartSV.value - e.translationY / headerSpan)));
      })
      .onEnd((e) => {
        if (!detailsActiveSV.value) return;
        const close = releaseCommitted(e.translationY, e.velocityY, headerSpan * REVEAL_COMMIT_FRACTION);
        detailsActiveSV.set(!close);
        progress.set(withTiming(close ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        runOnJS(commitReveal)(close ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
  }, [detailsActive, headerSpan, panBeganSV, progressStartSV, progress, touchStartX, touchStartY, detailsScrollOffset, detailsActiveSV, commitReveal]);

  // ── The ZOOM: how this instance arrives and leaves ───────────────────────────────────────────
  // Where the page came FROM: the cover box of the card that was tapped, in window coordinates
  // (lib/series-zoom). EVERY instance takes one — a drilled layer is opened from a card in a
  // related rail (or a nested search result), and that is just as much an "open this series" as a
  // tap on the browse grid, so it gets the same entrance rather than a push.
  //
  // Consumed in a state initializer so it's known on the FIRST render — a frame later would start
  // the grow from the wrong geometry. The ENTRANCE keeps this rect; the exit re-aims off it via
  // `heroShift`, because on a last-read list the card has moved by then. Don't freeze the exit to it.
  const [zoomSource] = useState(() => (IS_WEB ? null : takeZoomOrigin(id)));
  /**
   * How far the source card has moved since capture, applied only at the collapsed end (scaled by
   * `1 - q`). Kept out of `hero` so `zoomGeom` and its styles never recompute mid-flight; sprung, so
   * a row that moves during a collapse curves the transition to it rather than snapping. Only x/y —
   * a reorder moves a row without resizing it, which keeps `zoomGeom` valid throughout.
   */
  const heroShiftX = useSharedValue(0);
  const heroShiftY = useSharedValue(0);
  // The source rect this page aligns itself to. No image is needed — unlike a classic shared
  // element, nothing is copied or flown; the page is its own transition subject (see zoomMaskStyle).
  const hero = zoomSource?.origin ?? null;
  // The tapped card's shape, handed to the details so its hero cover opens at the same aspect —
  // which is what keeps the zoom's destination bound honest for a bridge whose covers aren't 2:3.
  // See `coverAspect` in SeriesDetailsHost.
  const heroAspectSeed = hero && hero.height > 0 ? hero.width / hero.height : undefined;
  const [destBound, setDestBound] = useState<ZoomRect | null>(null);
  const zoomStartedRef = useRef(false);
  // Blanking the source card is tied to ARMING, not to mount: the wait for the destination
  // measurement happens with everything here invisible, and a card blanked during it would just be
  // a hole in the grid. From arming on it stays blanked for this page's whole life — the copy
  // stands in for it, and the collapse spends most of its length with a half-transparent page over
  // the live grid, which is where showing both would be obvious.
  //
  // …and it also waits for the COPY TO HAVE PIXELS, which is the rest of the same thought. The
  // copy's <Image> only mounts once `zoomGeom` exists, and `zoomGeom` and the arm land in the SAME
  // commit — both hang off the hero rect report below — so the copy is a brand new image view at
  // the moment the animation starts, and a brand new image view has nothing to draw for at least a
  // frame even when the bitmap is already in memory. Blanking the card on that frame left a hole
  // exactly where the eye was: the card gone, the copy not yet there, the page still at opacity 0.
  // That is the flash on tapping a card.
  //
  // Waiting costs nothing, because the two are INTERCHANGEABLE while it waits: the copy is laid out
  // on the tapped card's own rect and drawn from the card's own cover URL (the route's `cover`
  // param IS `entry.cover`), so for those frames the real card showing through the not-yet-painted
  // copy is the correct picture. `blankSource` is called from both ends and acts on whichever is
  // last.
  const zoomReleaseRef = useRef<(() => void) | null>(null);
  const thumbPaintedRef = useRef(false);
  const blankBackstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      zoomReleaseRef.current?.();
      if (blankBackstopRef.current) clearTimeout(blankBackstopRef.current);
    },
    [],
  );
  const blankSource = useCallback(() => {
    if (zoomReleaseRef.current) return;
    if (!zoomStartedRef.current || !thumbPaintedRef.current) return;
    if (blankBackstopRef.current) {
      clearTimeout(blankBackstopRef.current);
      blankBackstopRef.current = null;
    }
    // Blank the ONE card this grew out of — not every card showing this series (see the module).
    // Traced with this instance's DEPTH, which is the piece `zoom hold` in the module can't know:
    // with a series, its tag search and that same series again all mounted at once, the question
    // behind a card coming back unblanked is which of them owned it.
    if (zoomSource && id) {
      traceJS('zoom', 'blank', { depth, src: zoomSource.source });
      zoomReleaseRef.current = holdZoomingSeries(id, zoomSource.source);
    } else {
      traceJS('zoom', 'blank.none', { depth });
    }
  }, [zoomSource, id, depth]);
  /** The copy reported pixels. Wired to its `onError` as well as its `onLoad` — a cover that is
   *  never going to draw is not a reason to keep two of it on screen forever. The load event also
   *  carries the image's intrinsic size, which feeds the sequence-mode copy morph. */
  const onZoomThumbPainted = useCallback(
    (e?: unknown) => {
      const src = (e as ImageLoadEventData | undefined)?.source;
      if (src?.width && src.height) zoomThumbAspect.set(src.width / src.height);
      thumbPaintedRef.current = true;
      blankSource();
    },
    [blankSource, zoomThumbAspect],
  );
  const startZoom = useCallback(() => {
    if (zoomStartedRef.current) return;
    zoomStartedRef.current = true;
    blankSource();
    // The wait is BOUNDED, and the bound is about the collapse rather than the open. Through an
    // open the card ends up behind an opaque page, so a copy that never loads leaves the real card
    // harmlessly underneath it; the collapse is the direction where two of them would show. Long
    // enough that a decode is never cut short, far shorter than any collapse.
    if (!thumbPaintedRef.current) {
      blankBackstopRef.current = setTimeout(() => {
        blankBackstopRef.current = null;
        thumbPaintedRef.current = true;
        blankSource();
      }, ZOOM_THUMB_PAINT_WAIT_MS);
    }
    zoomArmed.set(true);
    zoom.set(
      withSpring(1, ZOOM_IN_SPRING, (finished) => {
        // Closes the bracket opened at mount — see the effect below. The span between them is the
        // OPEN: mounting the details tree and playing the entrance, which is the cost any scheme
        // for reusing this page instead of rebuilding it would be buying back.
        trace('open', 'entered', { finished: !!finished });
        // Fires on cancellation too (finished: false) — an interrupted entrance must still open
        // the pane's window, or a dismissal begun mid-entrance would strand it at standby.
        runOnJS(markEntranceSettled)();
      }),
    );
  }, [zoom, zoomArmed, blankSource, markEntranceSettled]);
  const onHeroCoverRect = useCallback((rect: ZoomRect) => {
    // Only the FIRST report, and only before the geometry is committed: the cover box re-lays out
    // as its aspect settles, and moving the destination mid-flight would visibly jump. What the
    // latch does NOT freeze is where that box has since scrolled to — the geometry carries the
    // scroll offset separately, on the UI thread (see zoomBoundShift).
    if (zoomStartedRef.current) return;
    setDestBound((prev) => prev ?? rect);
  }, []);
  useEffect(() => {
    if (destBound) startZoom();
  }, [destBound, startZoom]);
  useEffect(() => {
    // No source rect at all (deep link, web): nothing to align to, so don't wait for anything.
    // Reader-first skips the wait too, and for a subtler reason: the details card is translated
    // off-screen at progress 0, so its hero cover would measure a rect that isn't on screen. The
    // computed fallback target — derived from the source rect alone — is the right destination
    // when the destination has nothing to show.
    if (!zoomSource || readerFirst) {
      startZoom();
      return;
    }
    const t = setTimeout(startZoom, ZOOM_BOUND_WAIT_MS);
    return () => clearTimeout(t);
    // Mount-only entrance — `zoomSource` never changes for an instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Silent on failure: no registration, an unmounted card or a timed-out probe all leave the shift
   *  alone, which is the captured rect — never a worse answer than not asking. The run counter drops
   *  a walk still settling when a newer surface change starts its own. */
  const exitProbeRun = useRef(0);
  const refreshExitOrigin = useCallback(() => {
    const from = zoomSource?.origin;
    if (!from || !id) return;
    const run = ++exitProbeRun.current;
    void resolveZoomTarget(id, zoomSource, (fresh) => {
      if (exitProbeRun.current !== run) return;
      heroShiftX.set(withSpring(fresh.x - from.x, ZOOM_OUT_SPRING));
      heroShiftY.set(withSpring(fresh.y - from.y, ZOOM_OUT_SPRING));
    });
  }, [heroShiftX, heroShiftY, id, zoomSource]);

  // The chevron / hardware-back exit, for a drilled layer AND the modal root: shrink back into the
  // card we came from, then leave (leaveNow pops the layer, or the route when depth 0). The
  // route's `animation: 'none'` means this IS the exit animation — without it a tapped back would
  // just blink the screen away.
  const closeLayer = useCallback(() => {
    if (LEFT.has(token)) return;
    zoomClosing.set(true);
    edgeCommitting.set(true);
    zoom.set(withSpring(0, ZOOM_OUT_SPRING));
    // No completion callback: leaving is driven by `zoom` reaching the card (see the reaction near
    // leaveOnce), with the `leaving` backstop above as the safety net.
  }, [token, edgeCommitting, zoom, zoomClosing]);

  /**
   * Ask the source card where it is, once per collapse. Hung off `zoom` leaving the top rather than
   * off the gestures — the pan, the back-swipe, the chevron and Android back all move it, and a new
   * exit path can't forget to call it. `probed` starts true so the entrance (`zoom` 0→1) can't trip
   * it; reaching the top arms it.
   */
  const probed = useSharedValue(true);
  useAnimatedReaction(
    () => zoom.value,
    (z) => {
      if (z < COLLAPSE_STARTED && !probed.value) {
        probed.set(true);
        runOnJS(setCollapsing)(true);
        runOnJS(refreshExitOrigin)();
      } else if (z > COLLAPSE_ARMED && probed.value) {
        probed.set(false);
        runOnJS(setCollapsing)(false);
      }
    },
  );

  // Only for the few hundred ms it can matter.
  useEffect(() => {
    if (!collapsing || !zoomSource) return;
    return onZoomSurfaceChange(zoomSource.source, refreshExitOrigin);
  }, [collapsing, refreshExitOrigin, zoomSource]);

  // Android hardware back steps back HOME (the details) before leaving: reader expanded → back
  // collapses it; details up → the instance slides out (a drilled layer back to its parent
  // series, the root back to whatever it was opened over).
  // Layer handlers register after their parent's (mounted later), so BackHandler's LIFO order
  // naturally gives the topmost instance the event. (Android-only API — react-native-web's
  // BackHandler stub rejects addEventListener.)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!detailsActive) setRevealed(1);
      else closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [detailsActive, setRevealed, closeLayer]);
  // The back-swipe recipe. FULL-SURFACE, not edge-only — a rightward drag anywhere on the details
  // goes back, the way a full-screen pop gesture does. What counts as an activation is
  // lib/back-swipe's, declarative (activeOffsetX/failOffset*), for the reasons written there.
  //
  // It is built ONCE PER PLATFORM, and which one is live is decided by `.enabled` below: on native
  // the copy composed with the list's scroller, on web the screen-level one. A device trace is what
  // settled that — it used to be both at once, and the two spent every drag cancelling each other.
  //
  // Why the native copy has to ride the scroller: the details surface is almost entirely a native
  // vertical scroll view, and UIKit force-fails any recognizer not allowed to run simultaneously
  // with a scroll view that has claimed the touch. A cross-detector `simultaneousWithExternalGesture`
  // relation did NOT reliably bind on device, so the simultaneity is declared where RNGH is built to
  // honor it: `detailsScrollGesture` below is `Gesture.Simultaneous(Gesture.Native(), <this pan>)`
  // attached BY the list's own detector (threaded down via PullListWiring.scrollGesture) — one
  // detector, both tags assigned in one attach, the relation internal to the composition.
  //
  // `.enabled(detailsActive)` is a NATIVE gate, matching the offsets. With activation decided inside
  // the recognizer, a worklet check inside the callbacks would come too late to stop one.
  // Every callback below carries an explicit `'worklet'` — REQUIRED, because the chain is rooted at
  // `backSwipePan(...)` rather than `Gesture.Pan()` and Reanimated's plugin only auto-workletizes
  // the latter. See lib/back-swipe for what a demoted gesture costs.
  const makeBackSwipePan = useCallback((tag: string) => {
    // The trace's throttle window, kept with the gesture rather than the component so the two
    // platform copies (and any future one) can't share a window and hide each other's samples.
    const updateGate = traceGate();
    // Did this gesture ACTIVATE? onFinalize fires either way — for a drag that was rejected before
    // it ever started as much as for one that ran — and almost everything there (settling the page,
    // handing scrolling back) is only correct for one that ran.
    const ranHere = makeMutable(false);
    // Where the finger was when the gesture ACTIVATED, so the page is dragged from there rather
    // than from touch-down. RNGH reports `translationX` from the touch, not from activation, so
    // without this every pixel travelled before it activates lands on `zoom` in the first frame
    // after. At the current 10px threshold that would be a small jump; it mattered far more under
    // the old rule, which could deliberate for most of a swipe and then apply the whole distance at
    // once, leaving the release with nothing left to animate.
    const originX = makeMutable(0);
    const originY = makeMutable(0);
    // Whether this drag has already been an unambiguous back-swipe — see backSwipeStayedHorizontal.
    const qualified = backSwipeShape();
    const settle = () => {
      'worklet';
      // Traced because settling is the only thing on this surface that can cancel a committed
      // collapse, so a trace showing an instant release must show whether it ran.
      trace(tag, 'settle', { zoom: zoom.value, committing: edgeCommitting.value });
      zoomClosing.set(false);
      zoom.set(withSpring(1, SPRING_BACK));
      dragX.set(withSpring(0, SPRING_BACK));
      dragY.set(withSpring(0, SPRING_BACK));
    };
    // The committed collapse, behind the same one-way `edgeCommitting` door the search layer's
    // slideOut uses. The door matters because a second write to `zoom` CANCELS the first spring, and
    // a cancelled Reanimated animation still fires its callback — so a duplicate commit would run
    // the collapse's callback on the frame the finger lifted and the page would simply be gone.
    // (That symptom turned out to have a different cause here — see onFinalize — but the guard is
    // still the right shape, and a one-way latch read across callbacks is the read that works.)
    const commit = (velocityX: number) => {
      'worklet';
      trace(tag, 'commit', { vx: velocityX, zoom: zoom.value, already: edgeCommitting.value });
      if (edgeCommitting.value) return;
      edgeCommitting.set(true);
      // Read STRAIGHT back — and on device this reports FALSE. `commit.latched readback=n` is what
      // a real trace says: a shared-value write is not visible to a read later in the SAME worklet
      // invocation, though it is visible to the next one (which is why the guard above still works
      // across gestures). Nothing here depends on it any more — onFinalize asks `success` instead
      // — but the probe stays, because anything that ever reaches for this latch inside one
      // callback will silently get the stale answer.
      trace(tag, 'commit.latched', { readback: edgeCommitting.value });

      // Resume from exactly where it was slid to: the collapse and the follow both spring from
      // their current values, so the page carries on from that spot into the card. Hand the throw
      // over too — the pan's velocity is in points per second and `zoom` moves one unit per
      // `width * ZOOM_DRAG_TRAVEL` points, so this is the same motion continuing rather than a
      // fresh spring starting from rest at the release point.
      zoom.set(
        withSpring(0, { ...ZOOM_OUT_SPRING, overshootClamping: true, velocity: -zoomThrowSpeed(velocityX, width, zoom.value) }, (finished) => {
          // Traced only. This used to leave as well, gated on `finished` — which is redundant with
          // the reaction (a completed spring writes exactly 0, which is what the reaction watches
          // for) and was the second half of the double-pop: two callers off one frame, each seeing
          // an unset latch. One caller is a better guarantee than a better latch.
          trace(tag, 'collapse.done', { finished: !!finished, zoom: zoom.value });
        }),
      );
      dragX.set(withSpring(0, ZOOM_OUT_SPRING));
      dragY.set(withSpring(0, ZOOM_OUT_SPRING));
    };
    // The shared activation criteria (lib/back-swipe). Everything after it is this surface's own:
    // a back-swipe here drives the gallery collapse, not a slide. Whether the details are the side
    // on screen is `.enabled()` on each copy below — a native gate, like the offsets themselves.
    return backSwipePan(tag)
      // Activation = this gesture owns the screen; the list must stop scrolling under it.
      .onStart((e) => {
        'worklet';
        // BEFORE the gate, always: "activated but every callback no-oped on detailsActive" and
        // "never activated" are different diagnoses and must not look the same in the log.
        trace(tag, 'START', { tx: e.translationX, ty: e.translationY, active: detailsActiveSV.value });
        if (!detailsActiveSV.value) return;
        ranHere.set(true);
        originX.set(e.translationX);
        originY.set(e.translationY);
        resetBackSwipeShape(qualified);
        runOnJS(setSwipeLocked)(true);
        // A drag IS a collapse, so it uses the collapse's cross-fade ranges from the first frame.
        zoomClosing.set(true);
      })
      .onUpdate((e) => {
        'worklet';
        if (!detailsActiveSV.value) return;
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        traceThrottled(updateGate, 60, tag, 'update', { tx, ty, zoom: zoom.value });
        trackBackSwipeShape(qualified, tx, ty, width * DISMISS_COMMIT_FRACTION);
        zoom.set(1 - Math.min(1, Math.max(0, tx / (width * ZOOM_DRAG_TRAVEL))));
        dragX.set(zoomHorizontalDrag(tx, width));
        dragY.set(zoomCrossAxisDrag(ty, height));
      })
      .onEnd((e) => {
        'worklet';
        trace(tag, 'END', {
          tx: e.translationX - originX.value,
          ty: e.translationY - originY.value,
          vx: e.velocityX,
          zoom: zoom.value,
          active: detailsActiveSV.value,
          committing: edgeCommitting.value,
          ran: ranHere.value,
        });
        if (!detailsActiveSV.value) return;
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        // Two questions, and BOTH have to say yes: was this a back-swipe at all (did it stay
        // horizontal over its whole length — activation could only see the first ten points, see
        // lib/back-swipe), and did it go far enough. A diagonal drag followed the finger and springs
        // back, which is the right outcome for one: it was never going anywhere.
        //
        // Finish from exactly where the finger left it — the spring starts at the current value, so
        // there is no seam between the dragged part and the animated part.
        if (
          backSwipeStayedHorizontal(tx, ty, qualified) &&
          releaseCommitted(tx, e.velocityX, width * DISMISS_COMMIT_FRACTION)
        )
          commit(e.velocityX);
        // …and a losing copy must not settle over a commit the winner just made, hence the check
        // here as well as in onFinalize.
        else if (!edgeCommitting.value) settle();
      })
      .onFinalize((_e, success) => {
        'worklet';
        // `success` is the single most valuable field in the whole trace: false here with no
        // preceding START is a recognizer that was FAILED or CANCELLED, which is a completely
        // different bug from one whose offsets were never satisfied.
        trace(tag, 'FINALIZE', { ok: !!success, ran: ranHere.value, committing: edgeCommitting.value, zoom: zoom.value });
        // `success` — NOT `edgeCommitting` — is what says whether onEnd already decided this drag.
        // onFinalize exists here for ONE case: a drag that was cancelled before it could be
        // released, which must not leave the page part-collapsed. When the gesture ended normally,
        // onEnd has already either committed or settled, and anything done here is a second opinion
        // on a decision that was made.
        //
        // It used to ask `edgeCommitting` instead, and a device trace caught that read coming back
        // FALSE in this callback on the same frame the commit set it true — so `settle` ran over a
        // committed collapse, cancelled its spring, and a cancelled Reanimated animation still
        // fires its callback. The callback is what leaves. That is what "the release finishes
        // instantly" was, and `success` doesn't depend on a cross-callback read to get it right.
        if (ranHere.value && !success) settle();
        // Only a gesture that actually drove may unlock the list — otherwise every rejected drag
        // would hand scrolling back, including one rejected mid-swipe while another is driving.
        if (ranHere.value) runOnJS(setSwipeLocked)(false);
        ranHere.set(false);
        // NOTE: `edgeCommitting` is deliberately NOT cleared. It means "this instance is leaving",
        // which is a one-way door — clearing it let a second onFinalize (the other copy's, whose
        // ordering is not guaranteed) fall through to `settle` after the commit.
      });
  }, [
    width,
    height,
    dragX,
    dragY,
    edgeCommitting,
    detailsActiveSV,
    zoom,
    zoomClosing,
  ]);
  // `traceOn` is a DEP on purpose: backSwipePan only attaches its touch observers while the trace
  // is recording, so flipping the toggle has to rebuild the gestures for the change to take.
  const traceOn = useGestureTraceEnabled();
  // WEB ONLY. This used to be a second copy of the back-swipe living on the screen-level detector,
  // alongside the one riding the list — the theory being that the list copy covers the scroller and
  // this one covers the chrome around it.
  //
  // A device trace killed that. Across ~20 attempts the screen-level copy activated ZERO times, and
  // in every failed attempt BOTH copies finalized unsuccessfully in the same millisecond, right as
  // the drag reached the activation threshold — with `dy` of one or two pixels, so nothing in the
  // criteria had failed. That is what an ancestor detector and a descendant detector reaching for
  // the same touch on the same frame looks like: they are not declared simultaneous with each
  // other, so each cancels the other and the swipe dies at exactly the moment it should have
  // started. The swipes that DID work were the fast ones, where one copy crossed the threshold a
  // frame before the other could contest it.
  //
  // So on native there is now ONE back-swipe: the copy composed with the scroller (below), which is
  // the only one that ever won. Web keeps this one instead, because there `detailsScrollGesture` is
  // undefined — no native recognizer to be simultaneous with, and nothing for it to fight.
  //
  // Not merely disabled on native — not BUILT. A permanently-disabled gesture still rebuilds when
  // its deps change, and a rebuilt gesture costs a full re-serialization of its callbacks (see
  // detailsBackSwipe below for the measurement). Dead weight that bills on every settle is worse
  // than dead weight.
  const edgePan = useMemo(
    () => (IS_WEB ? makeBackSwipePan(`series.edge@${depth}`).enabled(detailsActive) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, detailsActive, traceOn, depth],
  );
  // THE back-swipe on native (see edgePan above for why it's the only one).
  //
  // Held separately from the composition below because the rails inside the details need to name it
  // — they declare that THIS waits for THEM, which is the one relation keeping a rail scrollable now
  // that the back-swipe activates at the same distance a scroller claims at (see BackSwipeBoundary).
  //
  // ── NOT gated on `detailsActive`, and that is a performance decision ─────────────────────────
  // It carried `.enabled(detailsActive)` for a while, which looks harmless and is not. Rebuilding a
  // gesture gives it a fresh `gestureId`, and RNGH reacts to that by re-serializing EVERY callback
  // closure into its `animatedHandlers` shared value (GestureDetector/updateHandlers.js), on the JS
  // thread, in a microtask right after the commit. A device CPU profile put that at ~67ms of
  // `createSerializable` — and since this gesture is also the context value the rails read, its new
  // identity dragged another ~99ms of `propagateParentContextChanges` through the details subtree
  // behind it. All of it landing on the frame `detailsActive` flips, which is the frame the settle
  // animation starts on. That is the choppy settle: not the spring, the render under it.
  //
  // It doesn't need the gate anyway. This pan lives inside the details card, and that card drops
  // `pointerEvents` while the reader owns the screen — so it is already receiving no touches, by a
  // native mechanism rather than a config flag. The worklets re-check `detailsActiveSV` on top of
  // that. `traceOn` stays a dep because it changes the gesture's SHAPE (see backSwipePan) and only
  // ever flips from a Settings screen, where a re-serialization costs nothing.
  const detailsBackSwipe = useMemo(
    // Tagged with DEPTH. Every instance used to log as plain `series.list`, which is fine until
    // three of them are stacked — and the bugs that most need a trace are exactly the ones where
    // the question is which instance reacted.
    () => (IS_WEB ? null : makeBackSwipePan(`series.list@${depth}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, traceOn, depth],
  );
  const detailsScrollGesture = useMemo(
    () => (detailsBackSwipe ? Gesture.Simultaneous(Gesture.Native(), detailsBackSwipe) : undefined),
    [detailsBackSwipe],
  );
  // iOS pull release, caught ON the UI thread. The commit used to ride onScrollEndDrag alone,
  // which reaches JS a frame or two AFTER the rubber-band bounce starts — and in that window the
  // engaged follow tracked the bounce BACKWARD, so the details visibly jumped against the
  // commit's direction before animating away. This observer never activates (manual activation,
  // no activate() call) — it just watches the touches the details list is scrolling with, and on
  // the release of a committed-depth pull starts the commit animation in the same frame.
  // onScrollEndDrag stays as the fallback for the same commit (see onDetailsScrollEndDrag's
  // detailsActiveSV guard); if iOS ever stops delivering these touches mid-scroll, behavior
  // degrades to exactly the old path.
  const pullReleaseWatch = useMemo(() => {
    return Gesture.Pan()
      .enabled(detailsActive && IS_IOS)
      .manualActivation(true)
      .onTouchesUp(() => {
        if (!detailsActiveSV.value || !pullEngagedSV.value) return;
        if (detailsScrollOffset.value <= -PULL_COMMIT_PX) {
          pullEngagedSV.set(false);
          detailsActiveSV.set(false);
          progress.set(withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }));
          runOnJS(commitReveal)(0);
        }
      });
  }, [detailsActive, detailsActiveSV, pullEngagedSV, detailsScrollOffset, progress, commitReveal]);
  const detailsGestures = useMemo(
    () => (edgePan ? Gesture.Race(edgePan, returnPan, pullReleaseWatch) : Gesture.Race(returnPan, pullReleaseWatch)),
    [edgePan, returnPan, pullReleaseWatch],
  );
  // Geometry: the reader strip's height — the top-of-page band the details content starts below.
  // The details layer itself is full-screen (the strip is page, not chrome). Declared up here
  // because it is also the zoom's DESTINATION BOUND (see zoomGeom).
  const bandH = insets.top + HEADER_BAND;

  // ── The zoom: MASK + CONTENT TRANSFORM ───────────────────────────────────────────────────────
  // A port of react-native-screen-transitions' `navigation.zoom({ target: 'bound' })' (the
  // transition the React Navigation "building custom screen transitions" post demonstrates). Its
  // shape, and the reason both earlier attempts here looked wrong:
  //
  // There is NO flying copy of anything. The DESTINATION SCREEN ITSELF is scaled and translated
  // so that its own hero bound lands exactly on the source rect, and a MASK — a rounded rect
  // growing from the source rect to the full screen — is what you actually see it through. That
  // pairing is the whole trick. Scaling the page with no mask (attempt one) put a page-shaped
  // rectangle over a card-shaped hole; flying a separate thumbnail to a made-up destination
  // (attempt two) had to inflate past anything real and then dissolve down into the strip, which
  // is the pop on expand. With the mask there is nothing to hand over: one object, one motion.
  //
  // WHICH destination, of the three in `ZoomDest`, depends on what is actually on screen.
  //
  // The measured hero cover (`cover`) is the right one only while the DETAILS are up AND still
  // showing it. Out of the expanded READER it is wrong twice over: the details are slid away, so
  // that rect corresponds to nothing visible, and it is a fixed small box, so the copy sat at one
  // static size over a full-screen page instead of shrinking with it. That case takes `page`.
  //
  // Scrolled PAST the cover it is wrong for the first of those reasons alone — and only the
  // POSITION is wrong. The bound follows the scroll (`zoomBoundShift`), so a collapse begun from
  // halfway down the chapter list aimed at a box hundreds of points above the top edge and dragged
  // the whole page up to meet it: the page scrolling itself away under the finger, which is not a
  // zoom of anything. The cover's SIZE is still exactly right, though — it is what the collapse's
  // scale is derived from, and it is the size the picture ought to arrive at. So that case takes
  // `cover-offscreen`, which keeps the size and centres it: the page swipes away and a cover-sized
  // picture shrinks into the card, the same shrink `cover` gives, just not out of a shared element.
  // Aiming at `page` there instead (which is what this did first) kept the shrink but ballooned the
  // copy to full screen width, so the thing that faded in was far bigger than any cover ever is.
  //
  // `detailsActive` is COMMITTED state, so it only flips when a reveal or collapse finishes — never
  // mid-flight, which is what would make swapping the destination visible. The two cover-derived
  // geometries exist together or not at all; `zoomBoundOnScreen` picks between them per collapse.
  const zoomGeomCover = useMemo(
    () => (hero && detailsActive && destBound ? computeZoomGeom(hero, { kind: 'cover', bound: destBound }, width, height) : null),
    [hero, detailsActive, destBound, width, height],
  );
  const zoomGeomOffCover = useMemo(
    () =>
      hero && detailsActive && destBound
        ? computeZoomGeom(hero, { kind: 'cover-offscreen', bound: destBound }, width, height)
        : null,
    [hero, detailsActive, destBound, width, height],
  );
  const zoomGeomPage = useMemo(
    () => (hero ? computeZoomGeom(hero, { kind: 'page' }, width, height) : null),
    [hero, width, height],
  );
  /** For the render rather than for a frame of the transition: whether to mount the flying copy at
   *  all, and the layout rect it starts at. Any geometry answers both, and the animated style
   *  overwrites that rect in the same commit. */
  const zoomGeom = zoomGeomCover ?? zoomGeomPage;

  /**
   * Whether the cover is still on screen — i.e. whether a collapse aims at `cover` or at
   * `cover-offscreen`. LATCHED, because every frame of ONE collapse has to answer it the same way.
   * Written only while the page is at rest (`zoom` at the top); from the first frame of a drag it
   * holds whatever it said when the finger went down. The `detailsActive` note above is the same
   * guard by other means, and a choice read live off the scroll would break it several times a
   * second.
   */
  const zoomBoundOnScreen = useSharedValue(true);
  /** The scroll offset at which the cover is half off the top — past it, it stops being a place
   *  worth flying to and only its size is still worth keeping. Plain JS: the bound and the inset are
   *  both state, so the reaction only ever compares two numbers. */
  const zoomBoundLostAt = destBound ? destBound.y + destBound.height * (1 - ZOOM_BOUND_MIN_VISIBLE) - insets.top : 0;
  useAnimatedReaction(
    () => (zoom.value >= COLLAPSE_ARMED ? detailsScrollOffset.value : null),
    (offset) => {
      if (offset !== null) zoomBoundOnScreen.set(offset <= zoomBoundLostAt);
    },
    [zoomBoundLostAt],
  );

  // THE MASK. Grows from the source rect to the whole screen, carrying the card's corner radius
  // out to 0. In the library this lives INSIDE the transformed content and undoes the content
  // transform to reach absolute coordinates; here it is the content's PARENT, which gets the same
  // result with none of the compensation math — at the cost of the page needing to undo the
  // mask's own offset (see zoomPageStyle).
  const zoomMaskStyle = useAnimatedStyle(() => {
    // Always explicit numbers, never a percentage fallback from the stylesheet — a mask that is
    // sometimes laid out and sometimes transformed is how the two halves get to disagree.
    // No source rect, or not yet armed: the whole screen, so nothing is clipped.
    if (!hero || !zoomArmed.value) {
      return { left: 0, top: 0, width, height, borderRadius: 0, borderCurve: 'continuous' as const };
    }
    // Clamped at the bottom: the close spring is underdamped (damping ratio ~0.85, the library's
    // own figure) and undershoots 0 by a percent or two, which on a raw lerp would mean a mask
    // narrower than the card — and briefly a NEGATIVE width. The top needs no clamp: the open
    // spring is heavily overdamped and never passes 1.
    const q = Math.max(0, zoom.value);
    return {
      // The drag moves the MASK, not the page inside it. Both have to travel together or the page
      // slides out from under its own window — a rectangle of page hanging in the wrong place,
      // which is exactly what a dragged mask-less collapse looked like.
      left: (hero.x + heroShiftX.value) * (1 - q) + dragX.value,
      top: (hero.y + heroShiftY.value) * (1 - q) + dragY.value,
      width: hero.width + (width - hero.width) * q,
      height: hero.height + (height - hero.height) * q,
      borderRadius: hero.radius * (1 - q),
      borderCurve: 'continuous' as const,
    };
  }, [hero, width, height]);

  // THE CONTENT. The whole page, scaled about its own centre (which is the screen centre) and
  // translated onto the source rect, fading in over the first slice of the travel — the library's
  // `ZOOM_FOCUSED_ELEMENT_OPEN_OPACITY_RANGE`, which is what cross-fades it with the real card
  // still sitting underneath the transparent modal.
  //
  // The `- mask` terms are the correction for the mask being an ancestor. The page sits at the
  // mask's origin M, so every point of it is already displaced by M before any transform; since
  // the page is screen-sized its own centre is numerically the screen centre, which makes that
  // displacement a pure translation, and a window-space "scale s about the screen centre, then
  // translate T" is reproduced locally by translating T - M.
  // The back-swipe's drag rides here too: its follow adds to the translate and its shrink
  // multiplies the scale, so a dismissal drag and the collapse it hands into are one motion.
  const zoomPageStyle = useAnimatedStyle(() => {
    const q = Math.max(0, zoom.value); // see zoomMaskStyle
    // Before arming: base layout, so the destination cover measures its true untransformed rect.
    if (!zoomArmed.value) {
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    }
    // Which destination this collapse is aimed at, latched at its first frame — see
    // `zoomBoundOnScreen`. All three are the same shape, so nothing below needs a second path.
    const geom = pickZoomGeom(zoomBoundOnScreen.value, zoomGeomCover, zoomGeomOffCover, zoomGeomPage);
    if (!geom || !hero) {
      // No source rect (deep link, web): no mask, no alignment — just the small centred zoom.
      // Same three transform entries as every other branch: reanimated wants one stable style
      // shape per view, and this branch and the unarmed one above can both run for one instance.
      return {
        transform: [
          { translateX: dragX.value },
          { translateY: dragY.value },
          { scale: NO_ORIGIN_SCALE + (1 - NO_ORIGIN_SCALE) * q },
        ],
      };
    }
    const maskLeft = (hero.x + heroShiftX.value) * (1 - q);
    const maskTop = (hero.y + heroShiftY.value) * (1 - q);
    // Scale: normally the base content scale modulated by the drag's shrink. Once the finger has
    // let go of a dismissal it becomes the finishing Bézier instead — from the scale the page was
    // released at, down to the collapsed scale, biased by the release velocity.
    const scale = geom.s + (1 - geom.s) * q;
    // The vertical alignment is corrected for how far the details have SCROLLED since the bound was
    // measured (see zoomBoundShift). Moving the destination anchor UP by `shift` moves the
    // translation that lands it on the card DOWN by `s * shift` — the anchor is scaled before it is
    // translated, so the correction is scaled too. Nothing else in here changes: `s` is a ratio of
    // sizes, and the mask travels between the card and the screen, neither of which scrolls.
    const shift = zoomBoundShift(geom, detailsScrollOffset.value);
    // NOTE the compensation uses the UNDRAGGED mask origin. The mask sits at `maskLeft + dragX`
    // and the page at `T - maskLeft` inside it, which puts the page at `T + dragX` in window
    // space: mask and content displaced by exactly the same amount, so the window keeps framing
    // the same part of the page however far it is dragged.
    return {
      transform: [
        // heroShift is added to the page's own target as well as the mask's origin. The mask offset
        // cancels out of the page's absolute position, so shifting only the mask moves the window
        // without moving what's behind it.
        { translateX: (geom.tx + heroShiftX.value) * (1 - q) - maskLeft },
        { translateY: (geom.ty + geom.s * shift + heroShiftY.value) * (1 - q) - maskTop },
        { scale },
      ],
    };
  }, [zoomGeomCover, zoomGeomOffCover, zoomGeomPage, hero]);

  // The two halves of the cross-fade. The page's own opacity is separated from its transform so
  // the thumbnail copy can ride that same transform (it is a sibling INSIDE the transformed page,
  // laid out at the destination bound — which means it starts life exactly on the tapped card and
  // arrives exactly on the page's cover, with no geometry of its own to keep in sync).
  const zoomContentFadeStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0 };
    const q = Math.max(0, zoom.value);
    const range = zoomClosing.value ? ZOOM_CONTENT_FADE_CLOSE : ZOOM_CONTENT_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  });
  // See ZOOM_BACKDROP_FADE_CLOSE / _OPEN — same shape as the content fade, its own ranges.
  const zoomBackdropFadeStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0 };
    const q = Math.max(0, zoom.value);
    const range = zoomClosing.value ? ZOOM_BACKDROP_FADE_CLOSE : ZOOM_BACKDROP_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  });
  // Sequence mode only: the copy IS the page's own image (not a series cover standing in for a
  // card), so its rect MORPHS — from the tile-shaped `thumb` rect at q = 0, where cover-fit
  // reproduces the tile's crop exactly, to the image's TRUE fit rect at q = 1, where cover-fit in
  // an image-aspect rect ≡ contain, i.e. pixel-identical to the page rendered beneath it. Without
  // the morph the copy stays tile-shaped for the whole flight, and through the cross-fade window
  // the SAME image is drawn twice a few percent apart (a 2:3 cover-crop over an image-aspect
  // contain) — a double exposure that reads as blur. Chapter-mode zooms keep the fixed rect: their
  // copy is the series cover, deliberately a different picture from the page dissolving off it.
  // fit-width gates the morph off — the page doesn't render at the contain rect there.
  const copyMorphs = !!sequence && settings.pageFit === 'fit-page';
  const zoomThumbStyle = useAnimatedStyle(() => {
    // Which destination this collapse is aimed at, latched at its first frame — see
    // `zoomBoundOnScreen`. All three are the same shape, so nothing below needs a second path.
    const geom = pickZoomGeom(zoomBoundOnScreen.value, zoomGeomCover, zoomGeomOffCover, zoomGeomPage);
    const base = geom?.thumb ?? { x: 0, y: 0, width: 0, height: 0 };
    if (!zoomArmed.value) {
      // Same style SHAPE as the branch below — reanimated wants one per view, and both can run for
      // one instance.
      return {
        left: base.x,
        top: base.y,
        width: base.width,
        height: base.height,
        opacity: 0,
        borderRadius: hero ? hero.radius : 0,
        transform: [{ translateX: 0 }, { translateY: 0 }],
      };
    }
    const q = Math.max(0, zoom.value);
    const closing = geom?.kind === 'cover-offscreen' ? ZOOM_THUMB_FADE_CLOSE_OFFCOVER : ZOOM_THUMB_FADE_CLOSE;
    const range = zoomClosing.value ? closing : ZOOM_THUMB_FADE_OPEN;
    // The copy has to READ as the thumbnail it came off, corner included — 10pt on a grid card, 6
    // on a History/Activity row (see ZoomOrigin). This
    // rect rides the page's transform, so divide that scale out to hold the on-screen radius
    // steady rather than letting it grow with the page. (The library gets this for free: it moves
    // the real source view, which simply keeps its own radius under the tracked scale.)
    const s = geom ? geom.s + (1 - geom.s) * q : 1;
    let rect = base;

    const ia = zoomThumbAspect.value;
    if (copyMorphs && ia > 0) {
      // The image's fit-page rect (contain, centred) — in PAGE coordinates, which for a
      // screen-sized page are screen coordinates.
      const screenAspect = width / height;
      const fw = ia >= screenAspect ? width : height * ia;
      const fh = ia >= screenAspect ? width / ia : height;
      const fx = (width - fw) / 2;
      const fy = (height - fh) / 2;
      rect = {
        x: base.x + (fx - base.x) * q,
        y: base.y + (fy - base.y) * q,
        width: base.width + (fw - base.width) * q,
        height: base.height + (fh - base.height) * q,
      };
    }
    // The entry (see ZOOM_THUMB_ENTRY_CLOSE): the copy's own path, run backwards.
    //
    // `v` is the whole of that path — the window displacement from the copy's resting place at
    // q = 1 (the screen centre, since `end` is centred for this destination and `thumb` with it) to
    // the card at q = 0. So the copy's window centre is `centre + v * (1 - q)`, and `centre + v *
    // (1 - q - k)` is that same line k further back. `dragX/Y` are in none of this on purpose: they
    // displace the mask and the page by the same amount, so they cancel out of anything measured
    // between the two.
    //
    // `k` is the smallest push that separates the copy from the mask, per axis, taking whichever
    // axis clears first — two boxes stop overlapping as soon as EITHER axis does. An axis the path
    // doesn't move along can never separate on its own, hence the Infinity. The cap is a screen's
    // worth of travel, for a path so short that clearing the mask would otherwise need a huge
    // multiple of it; at that point the copy simply starts partly visible, which is better than
    // starting a screen and a half away.
    let entryX = 0;
    let entryY = 0;
    if (geom && hero && geom.kind === 'cover-offscreen') {
      const u = 1 - q;
      const vx = geom.tx + heroShiftX.value;
      const vy = geom.ty + heroShiftY.value;
      const hw = (rect.width * s) / 2;
      const hh = (rect.height * s) / 2;
      const maskLeft = (hero.x + heroShiftX.value) * u;
      const maskTop = (hero.y + heroShiftY.value) * u;
      const maskRight = maskLeft + hero.width + (width - hero.width) * q;
      const maskBottom = maskTop + hero.height + (height - hero.height) * q;
      const kx = vx > 0 ? u - (maskLeft - width / 2 - hw) / vx : vx < 0 ? u - (maskRight - width / 2 + hw) / vx : Infinity;
      const ky = vy > 0 ? u - (maskTop - height / 2 - hh) / vy : vy < 0 ? u - (maskBottom - height / 2 + hh) / vy : Infinity;
      const len = Math.hypot(vx, vy);
      const cap = len > 0.5 ? Math.hypot(width, height) / len : 0;
      const k =
        Math.max(0, Math.min(kx, ky, cap)) * interpolate(q, ZOOM_THUMB_ENTRY_CLOSE, [0, 1], Extrapolation.CLAMP);
      // Back into page coordinates, where the copy's transform lives — the page's own scale is
      // applied over the top of it.
      entryX = (-vx * k) / Math.max(s, 0.01);
      entryY = (-vy * k) / Math.max(s, 0.01);
    }
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: interpolate(q, range, [1, 0], Extrapolation.CLAMP),
      borderRadius: (hero ? hero.radius : 0) / Math.max(s, 0.01),
      // Two translates, and only one of them is ever non-zero.
      //
      // `cover` takes the SCROLL CORRECTION: the copy is laid out on the destination bound, so this
      // is INSIDE the page, in the same coordinates the bound was measured in, where "the cover
      // moved up by `shift`" is exactly `-shift`. Its counterpart in zoomPageStyle carries the same
      // shift the other way, which is what keeps the copy landing on the card at q = 0 and on the
      // real cover at q = 1.
      //
      // `cover-offscreen` takes the ENTRY instead (see ZOOM_THUMB_ENTRY_CLOSE) — a slide down into
      // place from behind the mask's top edge. Deliberately on the COPY alone and not on `end`:
      // moving the destination would move the page with it, which is the drag-the-page-up artifact
      // this destination exists to avoid, just pointing the other way. Nothing has to compensate for
      // it in zoomPageStyle for the same reason, and it decays to 0 before the landing, so the copy
      // still arrives exactly on the card.
      transform: [
        { translateX: entryX },
        { translateY: -zoomBoundShift(geom, detailsScrollOffset.value) + entryY },
      ],
    };
  }, [zoomGeomCover, zoomGeomOffCover, zoomGeomPage, hero, copyMorphs, width, height]);
  // What the flying copy DRAWS. A series open flies the series cover (the route's `cover` param is
  // the tapped card's own URL). A SEQUENCE open grew out of a page TILE, so the copy is that
  // page's image — the MOUNT entry's URI (already latched in sequenceTarget), which is the very
  // URL the tile rendered from the same query cache, so the copy has pixels immediately. Mount,
  // not visible: the collapse lands back on the tile that opened this, and the picture that lands
  // there must be that tile's own.
  const seqMountIndex = sequence && typeof sequenceTarget?.start === 'number' ? sequenceTarget.start : 0;
  const zoomThumbUri = useResolvedAsset(
    sequence ? sequence.uris[seqMountIndex] || sequence.entries[seqMountIndex]?.sourceUrl : cover,
  );

  // Content starts high enough that the series title's center lands on the seam gradient's
  // center — the strip fades into the details THROUGH the title.
  const headerTopInset = bandH - SHEET_FADE_H / 2 - TITLE_MID;

  // ── The details top bar — the SHARED TopBar, crossfaded with scroll ──────────────────────────
  // DETAILS MODE ONLY: transparent over the strip (just a floating back button, matching TopBar's
  // own button position), crossfading to the standard opaque bar as the content scrolls up to
  // meet it, and fading out through an expand. The EXPANDED reader keeps the old reader's own
  // ReaderToolbar untouched — fully transparent chrome, exactly the pre-experiment look; the two
  // occupy the same slot and fade through the transition, so it reads as one bar swapping its
  // content. `barSolid` mirrors the crossfade for pointer routing.
  const topBarHeight = useTopBarHeight();
  const barOnOffset = Math.max(1, headerTopInset - (insets.top + topBarHeight));
  const [barSolid, setBarSolid] = useState(false);
  useAnimatedReaction(
    () => detailsScrollOffset.value > barOnOffset - 4,
    (solid, prev) => {
      if (solid !== prev) runOnJS(setBarSolid)(solid);
    },
    [barOnOffset],
  );
  // Only the SCROLL crossfade lives here — the details⇄reader mode handoff is TopBarSwitch's
  // (the bar slot stays statically stuck on top and dissolves between the two faces).
  const headerBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(detailsScrollOffset.value, [barOnOffset - 24, barOnOffset + 16], [0, 1], Extrapolation.CLAMP),
  }), [barOnOffset]);
  // The PERSISTENT back button (TopBarSwitch's `persistent` slot): the same chevron serves both
  // modes from the same spot — it never fades or moves through the details⇄reader handoff, only
  // its COLOR crossfades (theme text over the details, white over the page). In reader mode it
  // follows the auto-hiding chrome (via the shared-value mirror) and a dismissal's chrome curve.
  const chromeVisibleSV = useSharedValue(1);
  useEffect(() => {
    chromeVisibleSV.set(withTiming(chromeVisible ? 1 : 0, { duration: 200 }));
  }, [chromeVisible, chromeVisibleSV]);
  const backPersistStyle = useAnimatedStyle(() => {
    // Details side is always-on; reader side follows the chrome. max() keeps it solid through
    // the transition instead of dipping.
    const detailsSide = interpolate(progress.value, [0.4, 0.8], [0, 1], Extrapolation.CLAMP);
    return { opacity: Math.max(detailsSide, chromeVisibleSV.value) };
  });
  const backThemeIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [0, 1], Extrapolation.CLAMP),
  }));
  const backWhiteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [1, 0], Extrapolation.CLAMP),
  }));

  // The reader FRAME travels only for the strip centering: while collapsed it rises by half its
  // hidden height so the strip window shows the page's vertical CENTER (not its top edge),
  // sliding back to natural position as it expands. A dismissal does not move it either — the
  // collapse moves the whole page, and the reader's dark surface stays put and fades.
  const readerCardStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: (-(height - bandH) / 2) * progress.value }] }),
    [height, bandH],
  );
  // The details page's motion, three coupled pieces:
  //  - headerLayerStyle: the whole details layer (background sheet + content) slides DOWN and off
  //    the screen as the reader expands — the details scroll down out of visibility.
  //  - headerSheetBgStyle: the opaque page background (whose top edge + gradient seam IS the strip
  //    boundary) rides the list's own scroll offset, so the strip behaves as the top of the page:
  //    scrolling down slides the page up over the strip until the seam parks at the screen top;
  //    pulling past the top (negative offset, the native rubber-band) slides the page down 1:1
  //    with the finger, growing the strip — the gradual reveal.
  //  - headerBandStyle: the strip's touch overlay follows the same occlusion, so it never blocks
  //    content once the seam has scrolled past it.
  const headerLayerStyle = useAnimatedStyle(() => {
    const off = detailsScrollOffset.value;
    // Travel far enough to clear the screen from wherever the page's TOPMOST visible artifact
    // currently sits. At rest that's the seam gradient's upper edge (bandH - SHEET_FADE_H — the
    // title reaches up into the seam, so clearing only the background's top would leave the title
    // and half the gradient peeking at the bottom of the expanded reader); when scrolled, the
    // seam parks at the screen top and the travel saturates at the full height.
    const seamTopRest = bandH - SHEET_FADE_H;
    const travel = height - seamTopRest + Math.min(Math.max(off, 0), seamTopRest);
    // The `min(off, 0)` term cancels the layer's share of an ACTIVE iOS pull: while the native
    // rubber-band is moving the content (and headerSheetBgStyle the seam) down 1:1 already, the
    // pull-driven progress must not ALSO move the layer — only the commit animation (progress
    // moving past the finger-tracked value while the bounce returns to 0) takes it off screen.
    return { transform: [{ translateY: (1 - progress.value) * travel + Math.min(off, 0) }] };
  }, [height, bandH]);
  const headerSheetBgStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: -Math.min(detailsScrollOffset.value, bandH) }] }),
    [bandH],
  );
  const headerBandStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: -Math.min(Math.max(detailsScrollOffset.value, 0), bandH) }] }),
    [bandH],
  );
  // The collapsed reader's heavy fade — "almost like a faded out background image".
  const headerReaderFadeStyle = useAnimatedStyle(() => ({ opacity: 0.55 * progress.value }));
  const readerTintStyle = useAnimatedStyle(() => ({
    opacity: 0.18 * Math.min(1, progress.value / FADE_WINDOW),
  }));
  // The details content's fade/scale, weighted toward the front of a reveal (complete within
  // FADE_WINDOW of the travel), matched by the tint above on the reader.
  const detailsContentStyle = useAnimatedStyle(() => {
    const reveal = Math.min(1, progress.value / FADE_WINDOW);
    return {
      opacity: 0.45 + 0.55 * reveal,
      transform: [{ scale: 0.96 + 0.04 * reveal }],
    };
  });

  // ── The BACKDROP's dim (see lib/series-backdrop.ts) ───────────────────────────────────
  // How much of the screen this page currently covers. All three ways it can be less than fully
  // covering have to count, or the backdrop would sit dimmed while the page is visibly gone: the
  // `zoom` alone, now that BOTH dismiss gestures drive it — the back-swipe and the reader's
  // swipe-away. This used to carry a second term for the swipe-away, which flung the page along
  // its own vector without touching `zoom`; there is no such vector any more.
  // Depth 0 ONLY: a drilled layer sits over its parent series inside this same modal, and the tabs
  // behind the whole modal must not respond twice to what is, to them, one open page.
  useAnimatedReaction(
    () => {
      return zoom.value;
    },
    (covered) => {
      if (depth === 0) seriesReaderDim.set(covered);
    },
    [depth],
  );
  // Belt and braces: nothing may strand the backdrop dimmed if this screen goes away without its
  // exit animation finishing (a deep link replacing the route, a dev reload). The hold's release
  // does that reset, and ALSO tells the watchdog nobody owns the dim any more — the reset above is
  // one JS-thread write against a value the reaction above writes every frame, and on its own it
  // has no way to notice when it loses that race (see lib/pushback-watchdog).
  useEffect(() => {
    if (depth > 0) return;
    return holdSeriesBackdrop();
  }, [depth]);

  // ── Details-card intents, routed back into the in-place reader ───────────
  const paneRef = useRef<ReaderPaneHandle>(null);
  // (`visiblePage` / `visibleSequenceEntry` are declared at the top of the component — the detail
  // identity derives from them.)
  // Verify this chapter's collected pages against the page list we already fetched — repairs the
  // ones the source shifted and seeds the indices the heart reads. See use-chapter-reconcile.
  // Reconcile is chapter machinery — in sequence mode `pages` is the cross-series URI list, which
  // must never be offered as a chapter's page list. (Each entry's chapter was reconciled when it
  // was read normally; the sequence only displays.)
  useChapterReconcile(bridgeId, id, sequence ? undefined : (visiblePage?.chapterId ?? target?.chapterId), pages);
  // Sequence mode: a tap in the revealed details card is a NEW read of the visible entry's
  // series, not a jump within the album — the album's pager runs the sequence and nothing else.
  // It opens as a drilled LAYER (the same slide a related-series card gets), reader-first at the
  // tapped spot, with the album intact underneath; the route push is the fallback for the odd
  // host without a layer stack.
  const drillSeries = useDrillRelatedSeries();
  const openFromSequenceDetails = useCallback(
    (params: Record<string, string>) => {
      if (drillSeries) drillSeries(params);
      else router.push({ pathname: '/series', params });
    },
    [drillSeries, router],
  );
  const openChapterFromDetails = useCallback(
    (v: Chapter) => {
      if (sequence) {
        openFromSequenceDetails({
          id: detailSeriesId ?? '',
          bridgeId: detailBridgeId ?? '',
          title: detailTitle ?? '',
          reader: '1',
          chapterId: v.id,
          ...(v.name ? { chapterName: v.name } : {}),
          start: '0',
        });
        return;
      }
      if (v.id !== targetChapterId) {
        setJumpNonce((n) => n + 1); // explicit jump — remount seeded at the target, even in-window
        setOverride({
          chapterId: v.id,
          chapterName: v.name,
          start: resume?.chapterId === v.id ? (resume.lastPage ?? 0) : 0,
        });
      }
      setRevealed(0);
    },
    [sequence, openFromSequenceDetails, detailSeriesId, detailBridgeId, detailTitle, targetChapterId, resume, setRevealed],
  );
  const openPageFromDetails = useCallback(
    (pageIndex: number) => {
      if (sequence) {
        // Page grids only exist on DIRECT series' details, so this is a direct open by definition.
        openFromSequenceDetails({
          id: detailSeriesId ?? '',
          bridgeId: detailBridgeId ?? '',
          title: detailTitle ?? '',
          reader: '1',
          direct: '1',
          start: String(pageIndex),
        });
        return;
      }
      // Both paths, because the pane is not guaranteed to be mounted: a window still forming (see
      // the run's hold) has no pager to drive, so the target carries the landing page and the pane
      // seeds from it instead. A pane that IS mounted ignores the seed — `start` is read once, at
      // mount — and the direct call is what moves it.
      paneRef.current?.goTo(pageIndex, false);
      setOverride((o) => {
        const from = o ?? derivedTarget;
        return from ? { ...from, start: pageIndex } : { start: pageIndex };
      });
      setRevealed(0);
    },
    [sequence, openFromSequenceDetails, detailSeriesId, detailBridgeId, detailTitle, setRevealed, derivedTarget],
  );
  // The Read button/cover: the pane already sits at the same resume point Read would compute.
  const startReadingFromDetails = useCallback(() => setRevealed(0), [setRevealed]);

  const scheme = useActiveColorScheme();
  // Sequence mode: the visible ENTRY names the series (the fetched detail only exists after a
  // reveal, and it describes the same series by construction — `detailKey`).
  const seriesTitle = sequence
    ? (visibleSequenceEntry?.seriesTitle ?? series?.title ?? 'Reader')
    : (series?.title ?? title ?? id ?? 'Reader');

  // What the toolbar's save button acts on. In sequence mode this is the visible ENTRY — its own
  // series and chapter coordinates, not the instance's (they only match at rest, by the screen's
  // re-keying); in chapter mode it is the visible page of the current chapter.
  const pageAction = sequence
    ? visibleSequenceEntry && {
        bridgeId: visibleSequenceEntry.bridgeId,
        seriesId: visibleSequenceEntry.seriesId,
        seriesTitle: visibleSequenceEntry.seriesTitle,
        chapterId: visibleSequenceEntry.chapterId,
        ...(visibleSequenceEntry.chapterName !== undefined && {
          chapterName: visibleSequenceEntry.chapterName,
        }),
        pageIndex: visibleSequenceEntry.pageIndex,
        ...(visibleSequenceEntry.pageCount !== undefined && {
          pageCount: visibleSequenceEntry.pageCount,
        }),
        ...((pages?.[visiblePage?.pageIndex ?? sequence.index] || visibleSequenceEntry.sourceUrl) !==
          undefined && {
          sourceUrl: pages?.[visiblePage?.pageIndex ?? sequence.index] || visibleSequenceEntry.sourceUrl,
        }),
      }
    : visiblePage && {
        bridgeId,
        seriesId: id,
        seriesTitle,
        chapterId: visiblePage.chapterId,
        ...(target?.chapterName !== undefined && { chapterName: target.chapterName }),
        pageIndex: visiblePage.pageIndex,
        ...(pages && { pageCount: pages.length }),
        ...(pages?.[visiblePage.pageIndex] !== undefined && {
          sourceUrl: pages[visiblePage.pageIndex],
        }),
      };

  // Same "<Bridge> / <Title>" the /series TopBar shows (shared truncation rule). Detail-side
  // identity, so in sequence mode the details top bar names the VISIBLE entry's series.
  const topBarSeries = series?.title ?? detailTitle;
  const topBarBridgeName = series?.bridge ?? detailBridge;
  const headerBarTitle = topBarSeries
    ? topBarBridgeName
      ? `${topBarBridgeName} / ${truncateTopBarTitle(topBarSeries)}`
      : truncateTopBarTitle(topBarSeries)
    : (topBarBridgeName ?? '');

  // The reveal tint + the header strip's heavy fade, over the PAGES but UNDER the bottom chrome —
  // they render inside ReaderPane between the readers and the navigator/pill (or after the
  // error/loading placeholder), so a partial reveal never washes out the scrubber and skip
  // buttons the way it briefly did when these sat above the whole pane.
  const dimOverlays = (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.readerTint, readerTintStyle]} />
      {/* The collapsed strip's heavy fade — toward the THEME background (not black), so the
          strip reads as a faded-out image and the title over the seam stays legible in both
          themes. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, headerReaderFadeStyle]}
      />
    </>
  );

  // ONE statically-stuck top-bar slot serving BOTH modes — TopBarSwitch keeps the details bar
  // (shared TopBar, back-less: transparent over the strip, opaque once scrolled) and the
  // reader's transparent ReaderToolbar (also back-less) mounted together and CROSSFADES between
  // them as the mode flips, while the PERSISTENT back chevron sits above both, in one spot,
  // never fading — only its color dissolves with the mode (the X/Reddit morphing-header
  // treatment). Above the band overlay so its taps win. Rendered in one of two spots below:
  // inside the edge-swipe slide for the modal root, outside it (fading, statically stuck) for a
  // drilled layer.
  const topChrome = (
    <TopBarSwitch
          mode={detailsActive ? 'details' : 'reader'}
          persistent={
            <Animated.View
              pointerEvents={detailsActive || chromeVisible ? 'box-none' : 'none'}
              style={[styles.headerBackWrap, { top: insets.top, height: topBarHeight }, backPersistStyle]}>
              <Pressable
                testID="series-page.header-back"
                // A drilled layer's chevron slides it back out to the parent series; the modal
                // root's pops the route.
                onPress={closeLayer}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.headerBackBtn}>
                <Animated.View style={backWhiteIconStyle}>
                  <ChevronLeftIcon color="#fff" />
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, styles.headerBackBtn, backThemeIconStyle]}>
                  <ChevronLeftIcon color={theme.text} />
                </Animated.View>
              </Pressable>
            </Animated.View>
          }
          bars={{
            details: (
              <Animated.View
                testID="series-page.header-topbar"
                pointerEvents={barSolid ? 'box-none' : 'none'}
                style={[styles.headerBarWrap, headerBarStyle]}>
                {/* left: an empty slot — the persistent chevron above IS the back button. */}
                <TopBar title={headerBarTitle} left={<View />} />
              </Animated.View>
            ),
            reader: (
              // The reader's own fully transparent toolbar (with no back of its own — the
              // persistent chevron above serves both modes); its auto-hide rides `visible`.
              <View pointerEvents="box-none">
                <ReaderToolbar
                  // In sequence mode the chrome describes the VISIBLE entry — which series the
                  // page in front of you belongs to is the one thing this bar must answer there.
                  title={sequence ? (visibleSequenceEntry?.seriesTitle ?? seriesTitle) : seriesTitle}
                  subtitle={
                    sequence ? (visibleSequenceEntry?.chapterName ?? '') : (target?.chapterName ?? '')
                  }
                  visible={chromeVisible}
                  onBack={goBack}
                  hideBack
                  right={
                    <>
                      <CollectPageControl
                        bridgeId={pageAction ? pageAction.bridgeId : bridgeId}
                        seriesId={pageAction ? pageAction.seriesId : id}
                        seriesTitle={pageAction ? pageAction.seriesTitle : seriesTitle}
                        chapterId={pageAction?.chapterId}
                        chapterName={pageAction?.chapterName}
                        pageIndex={pageAction?.pageIndex ?? 0}
                        pageCount={pageAction?.pageCount}
                        sourceUrl={pageAction?.sourceUrl}
                        onPress={showChrome}
                      />
                      <SettingsControl />
                    </>
                  }
                />
              </View>
            ),
          }}
        />
  );

  return (
    // Plain (transparent) root — the route is a contained transparent modal, so a dismissal can
    // fade the layers out over the screen beneath. The details layer supplies the opaque fill.
    <View style={styles.container}>
      <StatusBar
        style={settings.mode === 'paged' || detailsActive ? (scheme === 'dark' ? 'light' : 'dark') : 'light'}
        hidden={settings.mode !== 'paged' && !chromeVisible && !detailsActive}
      />

      {/* THE READER'S BACKDROP, while the reader is what's on screen: full screen, never moving,
          fading IN PLACE as the collapse carries the page over it. Outside the mask on purpose —
          inside it, it travelled and scaled along with everything else, which is a swipe-away
          dragging its own background off with it. Details mode keeps its copy inside the page
          (below), where the job is different: it is the dark backing that the transparent strip
          window shows the reader through, so it has to move with the page it belongs to.
          `detailsActive` is committed state, so this never swaps parents mid-collapse — and at
          rest the two positions render identically (the page transform is identity there). */}
      {!detailsActive && (
        <Animated.View
          pointerEvents="none"
          style={[styles.readerSurface, { width, height }, zoomBackdropFadeStyle]}
        />
      )}

      {/* THE MASK — the rounded window the page is seen through, growing from the tapped card's
          cover box to the whole screen (see zoomMaskStyle). At rest it IS the screen, so it clips
          nothing that was ever visible. */}
      <LeavingMask committing={edgeCommitting} leave={leaveOnce} style={[styles.zoomMask, zoomMaskStyle]}>
      {/* …THE PAGE inside it, scaled and aligned so its own cover lands on that card box (see
          zoomPageStyle). Transform only — the fade lives on the wrapper below, so the thumbnail
          copy further down can ride this same transform without fading with it. */}
      <Animated.View style={[styles.zoomPage, { width, height }, zoomPageStyle]}>
      {/* …and the page's CONTENT, which is the half of the cross-fade that fades IN. `leaving`
          drops touches the instant an exit starts, so a page on its way out can't be tapped and
          can't swallow a tap meant for the grid behind it. */}
      <Animated.View style={[StyleSheet.absoluteFill, zoomContentFadeStyle]}>

      {/* The details PAGE, in front of the (static) reader: a full-screen layer whose opaque
          background starts at the band, so the strip is the top of the page; the whole layer
          slides off as the reader expands — DOWN in paged mode, LEFT in webtoon (see
          horizontalReveal), uncovering the reader that is already full-screen beneath it. When
          the reader is expanded, the (translated-off) layer must not swallow touches meant for
          the reader beneath it. */}
      <GestureDetector gesture={detailsGestures}>
        <Animated.View
          testID="series-page.details-card"
          pointerEvents={detailsActive ? 'auto' : 'none'}
          style={[styles.detailsLayer, { width, height }, styles.headerLayer, headerLayerStyle]}>
          {/* The page's opaque background + gradient seam — the strip boundary. It rides the
              list's scroll offset (see headerSheetBgStyle) so it scrolls away under the content
              like any page header, and grows the strip under a pull past the top. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.headerSheetBg,
              { top: bandH, height, backgroundColor: theme.background },
              headerSheetBgStyle,
            ]}>
            {/* Ease-in stops: a two-stop linear gradient shows a visible edge where it starts
                over the reader — ramp in slowly at the top so the strip melts into the page.
                (theme.background is 6-digit hex, so alpha suffixes compose.) */}
            <LinearGradient
              colors={[`${theme.background}00`, `${theme.background}2E`, `${theme.background}9E`, theme.background]}
              locations={[0, 0.45, 0.78, 1]}
              style={styles.sheetFade}
            />
          </Animated.View>
          {/* The content scrolls over the transparent strip window — SeriesBody itself paints
              no background, so the faded reader shows through above the seam. */}
          <Animated.View style={[styles.detailsContent, detailsContentStyle]}>
            {/* Everything below can yield the back-swipe to a horizontal scroller of its own. */}
            <BackSwipeGestureContext.Provider value={detailsBackSwipe}>
            <SeriesDetailsHost
              // Keyed by the DETAIL series: constant in chapter mode; in sequence mode a series
              // cross remounts just this card (fresh skeleton state for the new series) while the
              // reader around it never blinks — the card is off-screen at progress 0 anyway.
              key={detailKey}
              bridgeId={detailBridgeId}
              id={detailSeriesId}
              title={detailTitle}
              bridge={detailBridge}
              cover={detailCover}
              defer={!seriesWanted}
              isDirect={detailIsDirect}
              width={width}
              topInset={headerTopInset}
              sharedValues={sharedValues}
              onScrollEndDrag={onDetailsScrollEndDrag}
              onStartReading={startReadingFromDetails}
              onOpenChapter={openChapterFromDetails}
              onOpenPage={openPageFromDetails}
              scrollGesture={detailsScrollGesture}
              scrollEnabled={!swipeLocked}
              onHeroCoverRect={onHeroCoverRect}
              coverAspectSeed={heroAspectSeed}
            />
            </BackSwipeGestureContext.Provider>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {/* The reader's dark surface — static: full screen, never moving,
          fading in place while a dismissal carries the page over it. It lives OUTSIDE the
          strip-centering frame below: inside it, the surface rode the frame's translate up with
          the reader and uncovered the screen bottom at low progress — the underlying screen
          showed through the seam gradient as a dark bar whenever a drag held the transition
          near the reader side. */}
      {detailsActive && <Animated.View pointerEvents="none" style={[styles.readerSurface, { width, height }]} />}

      {/* The reader, beneath the details: full screen, in three layers — a static fading surface
          above, the traveling page subtree, and the chrome that fades with it. The collapse/
          dismiss pan wraps the whole cell (the scrubber and a zoomed page disable it). */}
      <GestureDetector gesture={collapsePan}>
        <Animated.View
          testID="series-page.reader-card"
          style={[styles.readerFrame, { top: 0, width, height }, readerCardStyle]}>
          <View style={styles.readerClip}>
          {error ? (
            <>
              <View style={styles.centerFill}>
                <RetryBlock message={error} onRetry={refetch} />
              </View>
              {dimOverlays}
            </>
          ) : !readerReady ? (
            <>
              {/* No "Loading…" while the details are up — the strip is a quiet background there
                  (the per-page % indicator, once pages exist, is ReaderPage's and stays). */}
              {!detailsActive && (
                <View style={styles.centerFill}>
                  <ThemedText style={styles.loadingText}>Loading…</ThemedText>
                </View>
              )}
              {dimOverlays}
            </>
          ) : (
            <ReaderPane
              onVisiblePage={setVisiblePage}
              // Stitched native paged mode is keyed by the RUN (plus the explicit-jump nonce), so
              // a boundary crossing's relabel does NOT remount it — only leaving the run (chapter
              // list tap, skip button, cold-window fallback) does. Web/webtoon stay keyed by
              // chapter (their crossings are the remount path).
              key={stitched ? `run:${runKey}:${jumpNonce}` : `${target.chapterId ?? DIRECT_CHAPTER_ID}:${jumpNonce}`}
              ref={paneRef}
              pages={pages}
              segments={segments}
              onRelabel={relabelFromPager}
              start={target.start}
              width={width}
              height={height}
              bridgeId={bridgeId}
              seriesId={id}
              seriesTitle={seriesTitle}
              seriesCover={series?.cover}
              chapterId={target.chapterId}
              chapterName={target.chapterName}
              // A sequence has no chapter roster: no skip buttons, no cross-chapter paging, and —
              // below — no progress writes (a sequence hop is browsing, not a read position, and
              // recording it would clobber the real one).
              chaptered={!isDirect && !sequence}
              recordProgress={!sequence}
              hasPrevChapter={!sequence && !!prevChapter}
              hasNextChapter={!sequence && !!nextChapter}
              nextChapterName={nextChapter?.name}
              onCrossChapter={goAdjacentChapter}
              onSkipChapter={(delta) => {
                showChrome();
                goAdjacentChapter(delta, 'first');
              }}
              chromeVisible={chromeVisible && !detailsActive}
              onToggleChrome={toggleChrome}
              onShowChrome={showChrome}
              onHoldChrome={holdChrome}
              onZoomChange={setReaderZoomed}
              onScrubActive={onScrubActive}
              overlay={dimOverlays}
              // Details mode: the reader is a decorative background strip — load ONLY the page
              // on screen (no warm-ahead, render window of 1). Expanding flips this (a beat
              // after the transition settles — see detailsSettled) and the normal prefetch
              // pipeline resumes.
              standby={detailsSettled || !entranceSettled}
              entering={!entranceSettled}
              inLibrary={inLibrary}
            />
          )}
            {/* The Details pill — the guaranteed collapse path in both modes (webtoon's expanded
                reader owns vertical drags, and no longer reveals by dragging at all). */}
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <DetailsHint visible={chromeVisible && !detailsActive} onPress={() => setRevealed(1)} />
            </View>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* The reader strip's touch surface — tap to read full screen, or drag the details page
          away under the finger (DOWN in paged, LEFT in webtoon — see horizontalReveal). It rides
          the same occlusion as the strip (headerBandStyle), so it scrolls off with the page and
          never blocks content. */}
      {detailsActive && (
        <GestureDetector gesture={bandPan}>
          {/* Ends where the content starts (the title reaches up into the seam), so it never
              covers anything tappable. */}
          <Animated.View style={[styles.dockBand, { height: headerTopInset }, headerBandStyle]}>
            <Pressable
              testID="series-page.header-band"
              onPress={() => setRevealed(0)}
              accessibilityRole="button"
              accessibilityLabel="Read full screen"
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </GestureDetector>
      )}

      {/* ONE statically-stuck top-bar slot serving BOTH modes (see `topChrome` above) — every
          instance's bar rides its own slide (drill entrance, edge swipe, dismissal alike). */}
      {topChrome}

      </Animated.View>

      {/* THE FLYING THUMBNAIL — the other half of the cross-fade, and the reason the motion reads
          as a picture opening rather than a screen resizing. The library transforms the REAL
          source element on the screen underneath to track this path; from inside a modal that view
          is untouchable, so this is a copy of the same cover.
          Laid out at the DESTINATION bound and left to ride the page's transform, which is what
          keeps it honest: at rest that transform puts this rect exactly on the tapped card, and at
          the end exactly on the page's own cover. No second geometry to drift out of sync — the
          one thing it does carry of its own is the scroll correction (zoomThumbStyle's translate),
          and that is the SAME correction the transform takes, not a separate answer to it. The
          mask supplies the rounded card silhouette, so it needs no radius of its own. */}
      {hero && zoomGeom && zoomThumbUri && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.zoomThumb,
            {
              left: zoomGeom.thumb.x,
              top: zoomGeom.thumb.y,
              width: zoomGeom.thumb.width,
              height: zoomGeom.thumb.height,
            },
            zoomThumbStyle,
          ]}>
          {/* onLoad/onError are what release the source card's blanking — until this view has
              pixels the real card underneath is what stands in for it. See `blankSource`. */}
          <Image
            source={{ uri: zoomThumbUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            onLoad={onZoomThumbPainted}
            onError={onZoomThumbPainted}
          />
        </Animated.View>
      )}

      </Animated.View>
      </LeavingMask>
    </View>
  );
}

/**
 * The zoom mask, plus the one thing that has to know an exit started: it stops taking touches, so a
 * page on its way out can't be tapped, and a half-faded one can't eat a tap meant for the grid
 * behind it.
 *
 * Its OWN component purely so that knowledge costs its own render and not the whole page's. The
 * flag used to be state in SeriesReaderInstance, flipped from inside the commit — which re-rendered
 * everything on the frame the collapse started. Here the reaction runs on the
 * UI thread, the setState lands in a component whose subtree is `children` — stable elements the
 * parent already built — so React re-renders this wrapper and reconciles nothing beneath it.
 */
function LeavingMask({
  committing,
  leave,
  style,
  children,
}: {
  committing: SharedValue<boolean>;
  /** The instance's `leaveOnce`, for the backstop below. */
  leave: () => void;
  /** Whatever `Animated.View` takes — this forwards the zoom's animated mask style untouched. */
  style: ComponentProps<typeof Animated.View>['style'];
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  // `edgeCommitting` is the one-way "this instance is exiting" latch every exit sets — the chevron,
  // hardware back, the reader's dismiss fling and the details back-swipe alike — so watching it here
  // covers all four without any of them having to call anything.
  useAnimatedReaction(
    () => committing.value,
    (exiting, was) => {
      if (exiting && !was) runOnJS(setLeaving)(true);
    },
  );
  // The wall-clock backstop: a collapse that never arrives still leaves. Lives here rather than in
  // the instance because arming it there meant either a re-render (the stutter) or a ref the pan's
  // worklets could reach, which this file rules out for good reasons elsewhere.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(leave, ZOOM_OUT_BACKSTOP_MS);
    return () => clearTimeout(t);
  }, [leaving, leave]);
  return (
    <Animated.View style={style} pointerEvents={leaving ? 'none' : 'auto'}>
      {children}
    </Animated.View>
  );
}

/**
 * The route component: the base series instance for the route's params, plus one LAYER per
 * drilled series (see SeriesReaderInstance's header for why layers, not navigation). The drill
 * itself arrives through the nested layout's context ref — series cards anywhere inside the
 * series page stack call it (popping the nested stack back to this screen first when they're
 * on the search/downloads sub-pages, see useDrillRelatedSeries). Only the topmost instance takes
 * touches; the ones beneath stay live purely as the see-through under its gestures.
 */
type DrillEntry = { key: number } & ({ kind: 'series'; params: SeriesReaderParams } | { kind: 'search' });

// memo: pushing/popping a layer re-renders the wrapper below — without this, every mounted
// instance (each a whole series page) re-renders along with it for nothing.
const MemoSeriesReaderInstance = memo(SeriesReaderInstance);

export default function SeriesReaderScreen() {
  const params = useLocalSearchParams<SeriesReaderParams & ReaderSequenceParams>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [drills, setDrills] = useState<DrillEntry[]>([]);

  // ── Sequence mode (`seq=1`): the reader pages over a COLLECTION's saved pages ──
  // The screen's share is deliberately small: resolve the album (use-reader-sequence) and mount
  // ONE instance for its whole life — never re-keyed, so the pager inside it never remounts and a
  // series cross stays what it physically is: a page turn. Which series the chrome and details
  // describe is the INSTANCE's business — it re-points them to the visible entry, the way a
  // stitched crossing relabels (see ReaderSequenceRun).
  const seq = useReaderSequence(params);
  const seqEntries = seq?.entries;
  const seqUris = seq?.uris;
  const seqStartId = params.seqStart;
  // The tapped tile's entry (a cold deep link whose seqStart no longer exists falls back to the
  // first entry rather than failing). Stable: the album roster is latched for the open's life.
  const seqStartIndex = useMemo(() => {
    if (!seqEntries?.length) return 0;
    const at = seqStartId ? seqEntries.findIndex((e) => e.id === seqStartId) : -1;
    return at >= 0 ? at : 0;
  }, [seqEntries, seqStartId]);
  const seqEntry = seqEntries?.[seqStartIndex];
  const seqRun = useMemo<ReaderSequenceRun | undefined>(
    () =>
      seqUris && seqEntries?.length
        ? { uris: seqUris, entries: seqEntries, index: seqStartIndex }
        : undefined,
    [seqUris, seqEntries, seqStartIndex],
  );
  // The instance's route-level identity: the entry the album OPENED on — an ordinary reader-first
  // open, the same params a History row pushes, minus a chapter seed (the sequence, not a
  // chapter, is the page list). It never changes mid-album; the visible entry drives the rest.
  const seqParams = useMemo<SeriesReaderParams>(
    () =>
      seqEntry
        ? {
            id: seqEntry.seriesId,
            bridgeId: seqEntry.bridgeId,
            title: seqEntry.seriesTitle,
            reader: '1',
            ...(seqEntry.chapterId === DIRECT_CHAPTER_ID && { direct: '1' }),
          }
        : {},
    [seqEntry],
  );
  // A sequence that resolves to nothing (every page un-saved elsewhere, a dead deep link) has
  // nothing to show — leave rather than strand a spinner.
  const seqEmpty = !!seq && seq.resolved && seq.entries.length === 0;
  useEffect(() => {
    if (seqEmpty) router.back();
  }, [seqEmpty, router]);
  const nextKey = useRef(1);
  // The stack's shape, in the trace. A layer bug is by definition about which of several mounted
  // pages is reacting, and a recording had no way to say what was even mounted.
  const drill = useCallback((p: Record<string, string>) => {
    setDrills((d) => {
      traceJS('layer', 'push.series', { depth: d.length + 1 });
      return [...d, { key: nextKey.current++, kind: 'series', params: p as SeriesReaderParams }];
    });
  }, []);
  const openSearch = useCallback(() => {
    setDrills((d) => {
      traceJS('layer', 'push.search', { depth: d.length + 1 });
      return [...d, { key: nextKey.current++, kind: 'search' }];
    });
  }, []);
  const popLayer = useCallback(() => {
    setDrills((d) => {
      traceJS('layer', 'pop', { from: d.length, left: d.length - 1 });
      return d.slice(0, -1);
    });
  }, []);
  useEffect(() => registerDrillSeries(drill), [drill]);
  useEffect(() => registerOpenSearchLayer(openSearch), [openSearch]);
  // The IN-TREE push parallax, now serving the SEARCH layer alone: how much it covers what's under
  // it (0 off-screen, 1 fully arrived). The layer publishes it; everything beneath drifts left
  // against it, the way UIKit moves an outgoing screen. Drilled SERIES layers no longer write it —
  // they zoom out of the card that opened them rather than sliding in, and a parent shoved sideways
  // under something expanding in place read as two contradictory motions (the same reason the tabs
  // behind the whole modal lost their parallax — see lib/series-backdrop.ts). Search still
  // slides in from the edge, so it still gets the push treatment.
  //
  // One value serves any depth even though it only ever describes the top layer: the sole item a
  // reader can see beneath the top one is the item directly beneath it. Deeper items are fully
  // covered, so their reading it is invisible either way.
  const layerCover = useSharedValue(0);
  const layerParallax = useAnimatedStyle(
    () => ({ transform: [{ translateX: -IOS_PARALLAX_FRACTION * width * layerCover.value }] }),
    [width],
  );
  const top = drills.length - 1;
  // …and the push is only ON while the thing on top is the one that pushes. A drilled series zooms
  // out of its card, so everything under it holds still; when it closes, whatever it was covering
  // is exactly where it was left. Without this gate the layers beneath would SNAP sideways the
  // moment a series was drilled from search results, riding a value the search layer had parked
  // at 1 and the series would never move again.
  const pushed = top >= 0 && drills[top].kind === 'search' ? layerParallax : null;
  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.container, pushed]}
        pointerEvents={drills.length === 0 ? 'auto' : 'none'}>
        {seq ? (
          seqRun && seqEntry ? (
            // ONE instance, never re-keyed: the pager inside lives for the whole album, so a
            // series cross is a plain page turn — the instance re-points chrome and details to
            // the visible entry itself.
            <MemoSeriesReaderInstance params={seqParams} depth={0} onPopLayer={popLayer} sequence={seqRun} />
          ) : (
            // Cold deep link: the collection query hasn't answered yet (a warm cache resolves
            // synchronously and never shows this).
            <View style={styles.seqLoading}>
              <ActivityIndicator color="#fff" />
            </View>
          )
        ) : (
          <MemoSeriesReaderInstance params={params} depth={0} onPopLayer={popLayer} />
        )}
      </Animated.View>
      {drills.map((d, i) => (
        <Animated.View
          key={d.key}
          // The top layer is the one moving; it must not also ride the parallax it publishes.
          style={i === top ? StyleSheet.absoluteFill : [StyleSheet.absoluteFill, pushed]}
          pointerEvents={i === top ? 'auto' : 'none'}>
          {d.kind === 'series' ? (
            <MemoSeriesReaderInstance params={d.params} depth={i + 1} onPopLayer={popLayer} />
          ) : (
            <SearchLayer onPopLayer={popLayer} coverSV={layerCover} isTop={i === top} />
          )}
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * The tag/author/type search as a LAYER over the series instances — the same mechanics as a
 * drilled series (slide-in riding edgeX, the edge back-swipe rig, Android hardware back), with
 * the search screen embedded (its back button becomes a spacer) and the shared chevron rendered
 * statically stuck above the slide, fading on edgeX — in the exact spot the series bars beneath
 * keep theirs, so the chevron never moves through the navigation. The search's result cards
 * drill further series layers on top (useDrillRelatedSeries works unchanged inside).
 */
function SearchLayer({
  onPopLayer,
  coverSV,
  isTop,
}: {
  onPopLayer: () => void;
  /** See SeriesReaderInstance's — the parallax this layer drives on the series beneath it. */
  coverSV?: SharedValue<number>;
  isTop?: boolean;
}) {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const edgeX = useSharedValue(width);
  const edgeCommitting = useSharedValue(false);
  // Set the moment the back-swipe activates: the results list stops scrolling for as long as this
  // layer is being dragged out. See the note in the pan's onStart.
  const [swipeLocked, setSwipeLocked] = useState(false);
  useEffect(() => {
    edgeX.set(withSpring(0, IOS_CARD_SPRING));
    // Mount-only entrance — edgeX is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // No swipe-away here (the search has no reader to fling), so coverage is purely the slide.
  useAnimatedReaction(
    () => 1 - Math.min(1, Math.max(0, edgeX.value / width)),
    (cover) => {
      if (isTop && coverSV) coverSV.set(cover);
    },
    [width, isTop, coverSV],
  );
  // Both exits (the chevron/hardware back below, and a committed swipe) run through here, so the
  // button and the gesture leave on the same curve — as they do on a native stack, where the pop
  // animation doesn't know which one asked for it.
  //
  // `edgeCommitting` is the guard, and it is the right one for two jobs at once: it already means
  // "this layer is leaving" and is one-way for the layer's whole life, so checking it here makes a
  // second exit a no-op — the chevron tapped during a committed swipe, say — so exactly one spring
  // exists, hence exactly one pop.
  // `onPopLayer` slices this layer off the stack; a second call would take another layer with it.
  //
  // And the pop fires REGARDLESS of `finished`. A cancelled animation reports finished:false, and
  // a callback that leaves only on true would strand the layer off-screen — mounted, invisible,
  // still in `drills`. That exact shape is what made the series page's release end instantly, in
  // the other direction.
  const slideOut = useCallback(
    (velocity: number) => {
      'worklet';
      trace('search.slideOut', 'commit', { v: velocity, edgeX: edgeX.value, already: edgeCommitting.value });
      if (edgeCommitting.value) return;
      edgeCommitting.set(true);
      edgeX.set(
        withSpring(width, { ...IOS_CARD_SPRING, velocity }, (finished) => {
          trace('search.slideOut', 'done', { finished: !!finished, edgeX: edgeX.value });
          runOnJS(onPopLayer)();
        }),
      );
    },
    [edgeX, edgeCommitting, width, onPopLayer],
  );
  const closeLayer = useCallback(() => {
    runOnUI(slideOut)(0);
  }, [slideOut]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [closeLayer]);
  // The back-swipe. Activation is the shared one (lib/back-swipe) — literally the same code the
  // series instance runs, which is the point: two surfaces that both claim to have a back-swipe
  // must agree on what one is. Everything after it is this layer's own, because here a back-swipe
  // slides a card out rather than collapsing a gallery.
  //
  // One copy per platform, exactly as on the instance: the native one rides the results scroller
  // composed with a Native handler (`Gesture.Simultaneous`, one detector — see there for why the
  // cross-detector relation isn't trusted), the web one sits at screen level. `ranHere` and the
  // one-way `edgeCommitting` come across from there too — the first so a drag that never activated
  // can't settle or unlock anything, the second so nothing can undo a commit and drag the layer
  // back on screen after it has already been sliced off the stack.
  const makeBackSwipePan = useCallback((tag: string) => {
    const updateGate = traceGate();
    const ranHere = makeMutable(false);
    // Where the finger was at ACTIVATION — see the instance's copy for why. RNGH measures
    // translation from touch-down, so without this the card jumps by however far the rule spent
    // deciding, and a late activation leaves the release nothing to animate. Y is tracked only to
    // judge the release: nothing here follows the finger vertically.
    const originX = makeMutable(0);
    const originY = makeMutable(0);
    // The cancel carries the release velocity too — let go while still moving right and the
    // screen eases out of that motion before coming back, rather than reversing on the spot.
    const settle = (velocity: number) => {
      'worklet';
      edgeX.set(withSpring(0, { ...IOS_CARD_SPRING, velocity }));
    };
    // See the instance's copy — a stroke that already qualified stays qualified.
    const qualified = backSwipeShape();
    return backSwipePan(tag)
      .onStart((e) => {
        'worklet';
        trace(tag, 'START', { tx: e.translationX, ty: e.translationY });
        ranHere.set(true);
        originX.set(e.translationX);
        originY.set(e.translationY);
        resetBackSwipeShape(qualified);
        // Activation means this gesture owns the screen — the results list must STOP SCROLLING
        // under it. Without this the page kept scrolling vertically while sliding out sideways,
        // which is the single thing that gave the layer away as not-a-real-push: a card being
        // popped is inert, it doesn't keep responding to a finger that has moved on to dismissing
        // it. The series page's own back-swipe has always done this (`swipeLocked`).
        runOnJS(setSwipeLocked)(true);
      })
      .onUpdate((e) => {
        'worklet';
        const tx = e.translationX - originX.value;
        traceThrottled(updateGate, 60, tag, 'update', { tx, edgeX: edgeX.value });
        trackBackSwipeShape(qualified, tx, e.translationY - originY.value, width * DISMISS_COMMIT_FRACTION);
        edgeX.set(Math.max(0, tx));
      })
      .onEnd((e) => {
        'worklet';
        // Where the swipe was HEADED, not where it stopped — see lib/gesture-release.
        // A card pop IS a dismissal, so it takes the same bar — half the travel, which is also
        // what react-navigation uses for this exact transition.
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        trace(tag, 'END', { tx, ty, vx: e.velocityX, edgeX: edgeX.value, committing: edgeCommitting.value, ran: ranHere.value });
        // Same two questions as the instance's release — a card pop is a back-swipe too, and a
        // drag that wandered off-axis is not one however far across it got.
        if (
          backSwipeStayedHorizontal(tx, ty, qualified) &&
          releaseCommitted(tx, e.velocityX, width * DISMISS_COMMIT_FRACTION)
        )
          slideOut(e.velocityX);
        else settle(e.velocityX);
      })
      .onFinalize((_e, success) => {
        'worklet';
        trace(tag, 'FINALIZE', { ok: !!success, ran: ranHere.value, committing: edgeCommitting.value, edgeX: edgeX.value });
        // Only the copy that was DRIVING settles, and only a drag that never reached onEnd —
        // see the instance's copy for why this asks `success` rather than the commit latch.
        if (ranHere.value && !success) settle(0);
        // …and only that copy may unlock the list, for the same reason.
        if (ranHere.value) runOnJS(setSwipeLocked)(false);
        ranHere.set(false);
      });
  }, [width, edgeX, edgeCommitting, slideOut]);
  // See the series instance's copy for why the trace flag is a rebuild dep.
  const traceOn = useGestureTraceEnabled();
  // Web only, exactly as on the series instance — this layer had the same two-copy arrangement, an
  // ancestor detector and a descendant one both reaching for the same touch with the same criteria
  // and cancelling each other at the activation frame. The results list carries the native copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edgePan = useMemo(() => makeBackSwipePan('search.edge').enabled(IS_WEB), [makeBackSwipePan, traceOn]);
  const scrollGesture = useMemo(
    () => (IS_WEB ? undefined : Gesture.Simultaneous(Gesture.Native(), makeBackSwipePan('search.list'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, traceOn],
  );
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: edgeX.value }] }));
  // `isTop` matters for more than looks: it is how the embedded search knows to ignore an intent
  // meant for a layer above it (see the subscription in search.tsx).
  const embedded = useMemo(
    () => ({ onBack: closeLayer, scrollGesture, isTop: !!isTop, scrollEnabled: !swipeLocked }),
    [closeLayer, scrollGesture, isTop, swipeLocked],
  );
  return (
    <View style={styles.container}>
      <GestureDetector gesture={edgePan}>
        <Animated.View style={[styles.searchSlide, { backgroundColor: theme.background }, slideStyle]}>
          <SearchScreen embedded={embedded} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** The details card's content: series.tsx's SeriesBody, fed exactly the way SeriesScreen feeds it
 *  (same detail query + placeholder seeding, same cover-aspect measurement, same layout inputs) —
 *  minus the TopBar/pull-to-refresh, plus the three intent overrides that route back into the
 *  in-place reader. */
function SeriesDetailsHost({
  bridgeId,
  id,
  title,
  bridge,
  cover,
  defer,
  isDirect,
  width,
  topInset,
  sharedValues,
  onScrollEndDrag,
  onStartReading,
  onOpenChapter,
  onOpenPage,
  scrollGesture,
  scrollEnabled,
  onHeroCoverRect,
  coverAspectSeed,
}: {
  bridgeId?: string;
  id?: string;
  title?: string;
  bridge?: string;
  cover?: string;
  /** True while the instance's series queries are deferred (sequence mode, details not yet
   *  revealed) — the detail fetch waits with them. */
  defer?: boolean;
  isDirect: boolean;
  width: number;
  /** Overrides the default content top inset (safe area + breathing room) — the screen passes
   *  the full strip height, so the content starts below the reader band. */
  topInset?: number;
  sharedValues: Parameters<typeof SeriesBody>[0]['sharedValues'];
  /** Release of a details-list drag — the screen's iOS reveal pull commits on it. */
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onStartReading: () => void;
  onOpenChapter: (version: Chapter) => void;
  onOpenPage: (pageIndex: number) => void;
  /** The tapped card's aspect, so the hero starts the right shape — see the note on `coverAspect`. */
  coverAspectSeed?: number;
  /** Reports the details page's hero cover rect — the zoom's destination bound (see zoomGeom). */
  onHeroCoverRect?: (rect: ZoomRect) => void;
  /** The instance's `detailsScrollGesture` — mounted on SeriesBody's scroller (see makeBackSwipePan). */
  scrollGesture?: ComposedGesture;
  /** False while a horizontal details gesture is active, so the list can't scroll under it. */
  scrollEnabled?: boolean;
}) {
  const ds = useDataSource();
  const mock = useMockActive();
  const insets = useSafeAreaInsets();
  const {
    data: series = null,
    error: queryError,
    isPlaceholderData,
    isFetching,
    refetch,
  } = useQuery({
    ...seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
    // Deferred until the instance's reveal latch flips (sequence mode) — this host mounts with
    // the details layer, which exists from the first frame, but must not fetch on its behalf.
    enabled: !!id && !defer,
  });

  // The hero cover's measured aspect. SEEDED from the card this page grew out of rather than from
  // the flat 2:3 placeholder, because this box is the zoom's DESTINATION BOUND and that bound is
  // latched on its first layout — a bridge whose covers aren't 2:3 therefore had a source rect at
  // the real shape aligning to a destination still sitting at the placeholder's, and a single
  // uniform scale cannot map one rectangle onto a differently-proportioned one. The card already
  // knows the answer (its own cover has loaded; that is how you could see it to tap it), so start
  // where it is. `onCoverLoad` still corrects it if the detail cover genuinely differs.
  const [coverAspect, setCoverAspect] = useState(() => coverAspectSeed ?? DEFAULT_THUMB_ASPECT);
  const onCoverLoad = (e: ImageLoadEventData) => {
    const src = e.source;
    if (!src?.width || !src.height) return;
    const ratio = src.width / src.height;
    const next = !Number.isFinite(ratio) || ratio <= 0 ? DEFAULT_THUMB_ASPECT : Math.min(2.5, Math.max(0.5, ratio));
    setCoverAspect((prev) => (Math.abs(next - prev) > 0.02 ? next : prev));
  };

  const isLarge = width >= LARGE_SCREEN_BREAKPOINT;
  const actionsWidth = Math.round(Math.min(width * 0.4, 220));

  if (queryError) {
    return (
      <View style={styles.centerFill}>
        <RetryBlock message={(queryError as Error).message || 'Failed to load series'} onRetry={refetch} />
      </View>
    );
  }
  if (!series) {
    // No forwarded cover (deep link) and the fetch hasn't resolved — brief, so keep it plain.
    return (
      <View style={styles.centerFill}>
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      </View>
    );
  }
  return (
    <SeriesBody
      series={series}
      bridgeId={bridgeId}
      isLarge={isLarge}
      // position:sticky is a web full-page affordance — inside the card's own scroller it wouldn't
      // resolve against the viewport anyway.
      sticky={false}
      actionsWidth={actionsWidth}
      direct={isDirect}
      width={width}
      initialCover={cover}
      loading={isPlaceholderData}
      detailStarted={isFetching || !isPlaceholderData}
      coverAspect={coverAspect}
      onCoverLoad={onCoverLoad}
      // The screen's own layout clears the notch (the strip band), so only breathing room is
      // added when no explicit inset comes through.
      topInset={topInset ?? insets.top + Spacing.five}
      onStartReading={onStartReading}
      onOpenChapter={onOpenChapter}
      onOpenPage={onOpenPage}
      sharedValues={sharedValues}
      onScrollEndDrag={onScrollEndDrag}
      scrollGesture={scrollGesture}
      scrollEnabled={scrollEnabled}
      onHeroCoverRect={onHeroCoverRect}
    />
  );
}

type ReaderPaneHandle = { goTo: (index: number, animated?: boolean) => void };

/** The reader itself + its bottom chrome, keyed to ONE RUN (the stitched window — native paged)
 *  or one chapter (web/webtoon/direct), and mounted only once its pages are in — so the start
 *  position seeds `useState`/`useRef` directly at mount (the pagers read `initialPage` exactly
 *  once). Stitched crossings relabel in place through `onRelabel`; explicit jumps swap the whole
 *  pane; the unmount flush records the outgoing chapter's final position. */
const ReaderPane = forwardRef<
  ReaderPaneHandle,
  {
    pages: string[];
    /** The stitched window ([prev?, current, next?]) for the NATIVE PAGED reader — empty for
     *  web/webtoon/direct, which read per-chapter. See the screen's run machinery. */
    segments: Segment[];
    /** A stitched crossing settled on a page of a NEIGHBOURING segment: the screen relabels which
     *  chapter is "current" in place (no remount — the pane is keyed by the run). */
    onRelabel: (chapterId: string, chapterName: string | undefined, page: number) => void;
    /** The page currently ON SCREEN, with the chapter it actually belongs to. Reported so the
     *  toolbar (rendered by the parent) can drive its collect-this-page heart — the pane owns the
     *  page index, the parent owns the chrome. Mid-crossing this is the NEIGHBOURING segment, not
     *  `chapterId`; see `shownWithChapter`. (Distinct from the pagers' own `onVisiblePageChange`,
     *  which reports a FLAT window index with no chapter.) */
    onVisiblePage?: (v: { pageIndex: number; chapterId: string }) => void;
    /** First page to show — `'last'` lands on the final page (arriving backward from the next chapter). */
    start: number | 'last';
    width: number;
    height: number;
    bridgeId?: string;
    seriesId?: string;
    seriesTitle: string;
    seriesCover?: string;
    chapterId?: string;
    chapterName?: string;
    /** False for a direct series — drops the navigator's chapter-skip buttons. */
    chaptered: boolean;
    /** False = never write reading progress/history from this pane (sequence mode: a hop through a
     *  collected sequence is browsing, and recording it would clobber the real read position). */
    recordProgress?: boolean;
    hasPrevChapter: boolean;
    hasNextChapter: boolean;
    nextChapterName?: string;
    /** Paging off either end of the chapter (delta −1 lands on the previous chapter's LAST page). */
    onCrossChapter: (delta: 1 | -1) => void;
    /** The navigator's skip buttons — always land on the target chapter's first page. */
    onSkipChapter: (delta: 1 | -1) => void;
    chromeVisible: boolean;
    onToggleChrome: () => void;
    onShowChrome: () => void;
    /** Chrome-hold: suspend auto-hide while a control is in use. */
    onHoldChrome: (hold: boolean) => void;
    onZoomChange: (zoomed: boolean) => void;
    /** A scrub drag started/ended — the screen also freezes its reveal pan for the duration. */
    onScrubActive: (active: boolean) => void;
    /** Rendered between the readers and the bottom chrome — the screen's reveal tint/fade layers
     *  go here, so they dim the PAGES without washing out the navigator/pill. */
    overlay?: ReactNode;
    /** True while the reader is parked as a decorative background (the collapsed strip):
     *  suspends the warm-ahead prefetch and shrinks the pager's render window to the visible
     *  page, so only the single page on screen is requested. */
    standby?: boolean;
    /** True while the instance's ENTRANCE animation is still playing — the initial-position
     *  poster holds for its whole duration (see `posterUp`), because the native scroll offset of
     *  a non-zero `initialScrollIndex` can land frames after the JS side reports parked. */
    entering?: boolean;
    /** Library membership (undefined while still resolving) — picks the progress-recording path.
     *  Queried by the screen, not here: this pane re-renders every page sweep. */
    inLibrary?: boolean;
  }
>(function ReaderPane(
  {
    pages,
    segments,
    onRelabel,
    onVisiblePage,
    start,
    width,
    height,
    bridgeId,
    seriesId,
    seriesTitle,
    seriesCover,
    chapterId,
    chapterName,
    chaptered,
    recordProgress = true,
    hasPrevChapter,
    hasNextChapter,
    nextChapterName,
    onCrossChapter,
    onSkipChapter,
    chromeVisible,
    onToggleChrome,
    onShowChrome,
    onHoldChrome,
    onZoomChange,
    onScrubActive,
    overlay,
    standby,
    entering = false,
    inLibrary,
  },
  ref,
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [settings] = useReaderSettings();

  const startIndex = Math.max(0, Math.min(pages.length - 1, start === 'last' ? pages.length - 1 : start));
  const [currentPage, setCurrentPage] = useState(startIndex);
  const currentRef = useRef(startIndex);
  // Whether the mounted list has REPORTED a position yet. A recording answered how much this
  // signal is worth: it lands within ~10ms of mount — it is the list's JS-side position map
  // speaking, NOT the native scroll view. For a non-zero `initialScrollIndex` the NATIVE
  // contentOffset applies asynchronously, and until it does the viewport sits over index 0's
  // empty slot (cells are laid out at `index × width`; nothing is rendered down there) — frames
  // that are invisible to JS and to the frame trace alike, which is why every earlier recording
  // of the blank looked perfectly clean. So the POSTER below outlives this report: it stands in
  // for the target page through the whole ENTRANCE (`entering`), which comfortably covers the
  // native offset landing, and only then defers to the report. Index 0 needs no offset — the
  // exact reason "the first tile opens smoothly" was the isolating observation.
  const [parked, setParked] = useState(false);
  const setCurrent = useCallback((i: number) => {
    currentRef.current = i;
    setCurrentPage(i);
    setParked(true);
  }, []);
  useEffect(() => {
    if (parked) traceJS('pager', 'parked', { at: currentRef.current });
  }, [parked]);
  // The backstop: nothing may strand a static image over a live pager — not a list that never
  // reports, and not an entrance whose settle signal is lost.
  const [posterExpired, setPosterExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPosterExpired(true), POSTER_BACKSTOP_MS);
    return () => clearTimeout(t);
  }, []);
  // The poster's whole life, in one place: down the moment the user actually pages away from the
  // start (a swipe mid-entrance must not freeze under a static image), else up until BOTH the
  // entrance has finished and the list has reported — or the backstop calls time.
  const posterUp = currentPage === startIndex && !posterExpired && (entering || !parked);

  const pagedRef = useRef<PagedReaderHandle>(null);
  const webtoonRef = useRef<WebtoonReaderHandle>(null);
  const items: ReaderPageItem[] = useMemo(
    () => pages.map((uri, i) => ({ uri, key: `${chapterId ?? DIRECT_CHAPTER_ID}:${i}`, pageNumber: i + 1 })),
    [pages, chapterId],
  );

  // ── Stitched flat pager (native paged, chaptered) ──────────────────────────
  // Declared early (a noop until the record section below fills it) so the flat handlers can
  // flush the outgoing chapter's progress at a crossing.
  const recordRef = useRef<() => void>(() => {});
  const stitched = !IS_WEB && segments.length > 0;
  const flatItems: ReaderPageItem[] = useMemo(
    () => segments.flatMap((s) => s.pages.map((uri, i) => ({ uri, key: `${s.id}:${i}`, pageNumber: i + 1 }))),
    [segments],
  );
  // Flat index of the current chapter's page 0 (how many stitched pages precede it).
  const prefixLen = useMemo(() => {
    const currentId = chapterId ?? DIRECT_CHAPTER_ID;
    let acc = 0;
    for (const s of segments) {
      if (s.id === currentId) break;
      acc += s.pages.length;
    }
    return acc;
  }, [segments, chapterId]);
  // Where the chapter being scrubbed STARTS, latched for the duration of the drag — the reader's
  // half of the navigator's latched frame. A drag is resolved against the window it began in, and
  // `prefixLen` is not that: it moves when a neighbouring chapter joins at the head, and again on
  // every relabel. A ref rather than state because reading it must not wait for a render, and
  // nothing renders off it. Declared HERE, above every callback that reads it — the React Compiler
  // will not accept a ref being modified when its binding is used before this point.
  const scrubPrefixRef = useRef<number | null>(null);
  // The write in its own `[]` callback: the shape `setCurrent` uses, and the one the compiler
  // accepts a ref being modified in.
  const setScrubFrame = useCallback((prefix: number | null) => {
    scrubPrefixRef.current = prefix;
  }, []);

  // Which stitched segment a flat pager index falls in, and the page within it.
  const locateFlat = useCallback(
    (flat: number) => {
      let acc = 0;
      for (const s of segments) {
        if (flat < acc + s.pages.length) return { segment: s, page: flat - acc };
        acc += s.pages.length;
      }
      return null;
    },
    [segments],
  );
  // The page merely *scrolling past* (viewability), carried with its own segment so the counter
  // reads against the right chapter mid-crossing — display only, nothing writes off it.
  const [visibleSeg, setVisibleSeg] = useState<{ id: string; page: number; total: number } | null>(null);
  // The settled page. Same chapter: plain bookkeeping. A NEIGHBOURING segment: flush the old
  // chapter's progress, then relabel in place — the swipe that carried the user across stays
  // seamless (no remount; the pane is keyed by the run).
  const handleFlatPageChange = useCallback(
    (flat: number) => {
      const loc = locateFlat(flat);
      if (!loc) return;
      if (loc.segment.id === (chapterId ?? DIRECT_CHAPTER_ID)) {
        setCurrent(loc.page);
        return;
      }
      // NOT WHILE A SCRUB IS IN PROGRESS. A relabel changes which chapter is current, and with it
      // `prefixLen`, `pages` and the run's window — the frame the drag is being resolved in. Landing
      // one mid-drag doesn't just move the target: the shifted frame moves the pager, which crosses
      // another boundary, which relabels again. A recording of the bug shows ten of them and the
      // window growing from four segments to thirteen while a single finger was down.
      //
      // Nothing is lost by waiting. The track spans only the current chapter (see `scrubTotal`), so
      // a scrub has no business crossing a boundary at all, and the release commits explicitly
      // through `seekTo`; anything genuinely across one is reported again by the settle after it.
      if (scrubPrefixRef.current !== null) return;
      recordRef.current(); // the outgoing chapter's final settled position
      setCurrent(loc.page);
      onRelabel(loc.segment.id, loc.segment.name, loc.page);
    },
    [locateFlat, chapterId, setCurrent, onRelabel],
  );
  const handleFlatVisiblePage = useCallback(
    (flat: number) => {
      const loc = locateFlat(flat);
      if (!loc) return;
      setVisibleSeg({ id: loc.segment.id, page: loc.page, total: loc.segment.pages.length });
      if (loc.segment.id === (chapterId ?? DIRECT_CHAPTER_ID)) setCurrent(loc.page);
    },
    [locateFlat, chapterId, setCurrent],
  );
  // What the bottom chrome shows: the committed page, or — while a swipe carries a neighbouring
  // segment's page across the screen — that page against ITS chapter's length.
  const shown = useMemo(() => {
    const v = stitched && visibleSeg && segments.some((s) => s.id === visibleSeg.id) ? visibleSeg : null;
    return { page: v?.page ?? currentPage, total: v?.total ?? pages.length };
  }, [stitched, visibleSeg, segments, currentPage, pages]);

  // The same resolution as `shown`, but carrying the CHAPTER the visible page belongs to — what a
  // per-page action (the toolbar's collect heart) has to key off. Taking `chapterId` unconditionally
  // is the trap: mid-crossing in stitched paged mode the page on screen belongs to a neighbouring
  // segment, so a page collected there would be filed under the wrong chapter and reopen on the
  // wrong page later.
  const shownWithChapter = useMemo(() => {
    const v = stitched && visibleSeg && segments.some((s) => s.id === visibleSeg.id) ? visibleSeg : null;
    return {
      pageIndex: v?.page ?? currentPage,
      chapterId: v?.id ?? chapterId ?? DIRECT_CHAPTER_ID,
    };
  }, [stitched, visibleSeg, segments, currentPage, chapterId]);

  useEffect(() => {
    onVisiblePage?.(shownWithChapter);
  }, [onVisiblePage, shownWithChapter]);

  // Move to a FLAT index — an index into the window, whichever reader is mounted. Both take the
  // same coordinate now that both are stitched.
  const goFlat = useCallback(
    (flat: number, animated: boolean) => {
      if (settings.mode === 'paged') pagedRef.current?.goToPage(flat, animated);
      else webtoonRef.current?.goToPage(flat, animated);
    },
    [settings.mode],
  );
  // Chapter-local page index in; the stitched readers take the flat one.
  const goTo = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      setCurrent(clamped);
      goFlat(stitched ? prefixLen + clamped : clamped, animated);
    },
    [pages, setCurrent, stitched, prefixLen, goFlat],
  );
  // The details card's page-thumbnail taps jump the mounted pane directly (see openPageFromDetails).
  useImperativeHandle(ref, () => ({ goTo }), [goTo]);
  // Where a scrub release lands: name the landing page immediately (viewability is suppressed
  // during the drag), so the chrome is correct in the same commit.
  const seekTo = useCallback(
    (index: number) => {
      // Resolved in the frame the DRAG began in, not whatever the window has become since — see
      // `scrubPrefixRef`. `handleScrubbing(false)` runs after this (the gesture emits the seek
      // first), so the latch is still held here.
      const base = scrubPrefixRef.current ?? prefixLen;
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      // Where the release actually lands, in the reader's own coordinates — the other half of the
      // navigator's `scrub release` line. `local` past `of` means the track was calibrated to a
      // different chapter than the one being committed to; `base` against the grab's `offset` says
      // whether the frame held for the length of the drag.
      traceJS('seek', 'commit', { local: index, of: pages.length, base, flat: stitched ? base + clamped : clamped });
      setCurrent(clamped);
      goFlat(stitched ? base + clamped : clamped, true);
      if (stitched) handleFlatVisiblePage(base + clamped);
    },
    [stitched, prefixLen, pages.length, setCurrent, goFlat, handleFlatVisiblePage],
  );
  // Boundary page-turns: prefer stepping within the stitched flat list (the same seamless relabel
  // path a swipe crossing takes); the explicit-jump fallback only covers a cold window (adjacent
  // pages not loaded yet) — or web/webtoon, whose readers aren't stitched.
  const turnPrev = useCallback(() => {
    if (currentRef.current > 0) {
      goTo(currentRef.current - 1, false);
      return;
    }
    if (stitched && prefixLen > 0) {
      handleFlatPageChange(prefixLen - 1);
      goFlat(prefixLen - 1, false);
      return;
    }
    if (chaptered && hasPrevChapter) onCrossChapter(-1);
  }, [goTo, stitched, prefixLen, handleFlatPageChange, goFlat, chaptered, hasPrevChapter, onCrossChapter]);
  const turnNext = useCallback(() => {
    if (currentRef.current < pages.length - 1) {
      goTo(currentRef.current + 1, false);
      return;
    }
    const nextFlat = prefixLen + pages.length;
    if (stitched && nextFlat < flatItems.length) {
      handleFlatPageChange(nextFlat);
      goFlat(nextFlat, false);
      return;
    }
    if (chaptered && hasNextChapter) onCrossChapter(1);
  }, [
    goTo,
    stitched,
    prefixLen,
    pages,
    flatItems.length,
    handleFlatPageChange,
    goFlat,
    chaptered,
    hasNextChapter,
    onCrossChapter,
  ]);
  const atLastPage = useCallback(() => currentRef.current >= pages.length - 1, [pages]);
  // Is the chapter on either side already IN the window? That is what decides whether a boundary is
  // something to scroll across or something to ask for.
  const prevStitched = stitched && prefixLen > 0;
  const nextStitched = stitched && prefixLen + pages.length < flatItems.length;

  // ── Scrubber (UI-thread throughout; offset 0 — nothing stitched) ───────────
  const scrubFlat = useSharedValue(-1);
  const [scrubbing, setScrubbing] = useState(false);
  const handleScrubbing = useCallback(
    (active: boolean) => {
      // Latched here rather than in an effect because THIS is the moment: the navigator reports the
      // hold exactly once per drag, at touch-down, which is the last instant `prefixLen` still
      // describes the chapter the drag is aimed at. An effect would latch a commit later, by which
      // point the window may already have moved — and moving is precisely what it does.
      setScrubFrame(active ? prefixLen : null);
      setScrubbing(active);
      onScrubActive(active);
    },
    [onScrubActive, prefixLen, setScrubFrame],
  );
  const scrubTo = useCallback(
    (position: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, position));
      // The frame the drag began in — see `scrubPrefixRef`.
      const base = scrubPrefixRef.current ?? prefixLen;
      if (settings.mode === 'paged') pagedRef.current?.scrubTo(stitched ? base + clamped : clamped);
      else goFlat(stitched ? base + Math.round(clamped) : Math.round(clamped), false);
    },
    [pages, settings.mode, stitched, prefixLen, goFlat],
  );

  // ── Warm-ahead ──
  // Over the whole STITCHED window, not just this chapter. The pages either side of a boundary
  // belong to two different chapters, so a chapter-local warm window stops dead at page 1 — and
  // the page immediately behind page 1, the previous chapter's last, is precisely the one a
  // backward swipe lands on. Warming the flat strip is what makes that turn arrive on an image
  // instead of on a placeholder, the same as any other page turn.
  const warmAround = useCallback(
    (index: number) => {
      const at = stitched ? prefixLen + index : index;
      const from = Math.max(0, at - WARM_BEHIND);
      const to = at + 1 + settings.prefetchAhead;
      warmPageImages(stitched ? flatItems.slice(from, to).map((item) => item.uri) : pages.slice(from, to));
    },
    [pages, stitched, flatItems, prefixLen, settings.prefetchAhead],
  );
  // Warm where the reader COMES TO REST — see WARM_IDLE_MS. Both callers go through this: the page
  // the reader has settled on, and the scrubber's live position as it is dragged.
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmSoon = useCallback(
    (index: number) => {
      if (warmTimer.current) clearTimeout(warmTimer.current);
      warmTimer.current = setTimeout(() => warmAround(index), WARM_IDLE_MS);
    },
    [warmAround],
  );
  useEffect(
    () => () => {
      if (warmTimer.current) clearTimeout(warmTimer.current);
    },
    [],
  );

  useEffect(() => {
    // Standby (the collapsed strip) loads nothing beyond the visible page; the flip back to
    // active re-runs this and warms the neighbourhood.
    if (!standby && pages.length) warmSoon(currentPage);
  }, [standby, pages, currentPage, warmSoon]);

  // ── Progress recording: a library series (inLibrary, queried by the screen) records chapter
  // progress; anything else (including a direct series) goes to the reading log under the
  // DIRECT_CHAPTER_ID sentinel. ──
  const record = useCallback(() => {
    if (!recordProgress) return;
    if (!bridgeId || !seriesId || !pages.length || inLibrary === undefined) return;
    const lastPage = currentRef.current;
    const pageCount = pages.length;
    const invalidateHistory = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.history(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapterProgress(mock, bridgeId, seriesId) });
    };
    if (chapterId && inLibrary) {
      void ds
        .recordChapterProgress(bridgeId, seriesId, chapterId, {
          lastPage,
          pageCount,
          ...(chapterName ? { chapterName } : {}),
        })
        .then(invalidateHistory)
        .catch(() => {});
      return;
    }
    void ds
      .recordReadingHistory({
        bridgeId,
        seriesId,
        title: seriesTitle,
        ...(seriesCover ? { thumbnailUrl: seriesCover } : {}),
        chapterId: chapterId ?? DIRECT_CHAPTER_ID,
        ...(chapterName ? { chapterName } : {}),
        lastPage,
        pageCount,
      })
      .then(invalidateHistory)
      .catch(() => {});
  }, [recordProgress, bridgeId, seriesId, pages, inLibrary, chapterId, chapterName, seriesTitle, seriesCover, ds, mock, queryClient]);
  // recordRef itself is declared up with the stitched mappings (the flat crossing flushes through
  // it); this keeps it pointing at the latest closure.
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  // Debounced on page settle + flushed on teardown (leaving the screen AND chapter swaps — the pane
  // is keyed by chapter).
  useEffect(() => {
    const t = setTimeout(() => recordRef.current(), 1500);
    return () => clearTimeout(t);
  }, [currentPage]);
  useEffect(() => () => recordRef.current(), []);

  // ── Web keyboard nav (single-step; no held-key repeat) ─────────────────────
  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === 'Escape') {
        router.back();
        e.preventDefault();
        return;
      }
      const isRight = e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';
      const isLeft = e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
      if (!isRight && !isLeft) return;
      e.preventDefault();
      if (e.repeat) return;
      const forward = isRight !== (settings.direction === 'rtl');
      (forward ? turnNext : turnPrev)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, turnNext, turnPrev, settings.direction]);

  return (
    <>
      {/* The page subtree. */}
      <Animated.View testID="series-page.page-wrap" style={styles.pageWrap}>
      {settings.mode === 'paged' ? (
        <PagedReader
          ref={pagedRef}
          // Stitched: the whole window as ONE flat pager, so a boundary swipe is an ordinary page
          // turn (position reports come back flat and get located/relabeled above). Web keeps
          // per-chapter pages (its pager hands boundary turns to onPrev/onNext itself).
          pages={stitched ? flatItems : items}
          width={width}
          height={height}
          rtl={settings.direction === 'rtl'}
          pageFit={settings.pageFit}
          initialPage={stitched ? prefixLen + startIndex : startIndex}
          onPageChange={stitched ? handleFlatPageChange : setCurrent}
          // Keep the counter live during fast flicks — against the segment the page belongs to
          // when stitched (a crossing must count against the chapter being entered).
          onVisiblePageChange={IS_WEB ? undefined : stitched ? handleFlatVisiblePage : setCurrent}
          scrubTarget={scrubFlat}
          scrubbing={scrubbing}
          standby={standby}
          onPrev={turnPrev}
          onNext={turnNext}
          onToggleChrome={onToggleChrome}
          onZoomChange={onZoomChange}
        />
      ) : (
        <WebtoonReader
          ref={webtoonRef}
          // The same stitched window the pager gets: scrolling off either end of a chapter simply
          // continues into the next one, with the page you are heading for already under the
          // scroll rather than arriving after a jump.
          pages={stitched ? flatItems : items}
          width={width}
          height={height}
          pageFit={settings.pageFit}
          initialPage={stitched ? prefixLen + startIndex : startIndex}
          onPageChange={stitched ? handleFlatPageChange : setCurrent}
          // The live half, the same one the pager has always had: the chrome counts along with the
          // page going past instead of waiting for the scroll to come to rest.
          onVisiblePageChange={stitched ? handleFlatVisiblePage : setCurrent}
          onToggleChrome={onToggleChrome}
          onZoomChange={onZoomChange}
          standby={standby}
          // Every one of these is a FALLBACK for a window that came up short, and each stands down
          // where the window already reaches the chapter in question — a sentinel to tap, an
          // auto-advance and a backward pull are all ways of asking for a chapter you cannot simply
          // scroll to, and scrolling to it is strictly better.
          nextChapterName={chaptered && !nextStitched ? nextChapterName : undefined}
          onGoBack={chaptered && hasPrevChapter && !prevStitched ? () => onCrossChapter(-1) : undefined}
          onAdvance={chaptered && hasNextChapter && !nextStitched ? () => onCrossChapter(1) : undefined}
          onEndReached={
            chaptered && hasNextChapter && !nextStitched
              ? () => {
                  if (atLastPage()) onCrossChapter(1);
                }
              : undefined
          }
        />
      )}
      {/* THE INITIAL-POSITION POSTER — the target page, full frame, over the list for the whole
          entrance (see `posterUp` above). It renders the very URI the pager will show at that
          index, from cache, so its appearance and its removal are both invisible; what it papers
          over is the NATIVE offset transient of a non-zero initialScrollIndex, which an entrance
          animation would otherwise expose as a blank. */}
      {posterUp &&
        (() => {
          const list = stitched ? flatItems : items;
          const at = stitched ? prefixLen + startIndex : startIndex;
          const uri = list[Math.max(0, Math.min(list.length - 1, at))]?.uri;
          if (!uri) return null;
          return (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                // Same mapping ZoomablePage applies (fit-page → contain), so the poster and the
                // page draw alike.
                contentFit={settings.pageFit === 'fit-page' ? 'contain' : 'cover'}
                cachePolicy="memory-disk"
              />
            </View>
          );
        })()}
      </Animated.View>

      {/* Tint/fade layers over the pages, under the chrome below. */}
      {overlay}

      {/* Bottom chrome — sits still while the page travels. */}
      <Animated.View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {IS_WEB ? (
        <ProgressPill
          current={currentPage}
          total={pages.length}
          visible={chromeVisible}
          onJump={(i) => {
            goTo(i);
            onShowChrome();
          }}
          onEditingChange={onHoldChrome}
        />
      ) : (
        <ChapterNavigator
          // `shown`, not the committed page: mid-crossing the counter reads the entering
          // chapter's page/length, turning over WITH the swipe.
          page={shown.page}
          total={shown.total}
          rtl={settings.mode === 'paged' && settings.direction === 'rtl'}
          visible={chromeVisible}
          chaptered={chaptered}
          hasPrevChapter={hasPrevChapter}
          hasNextChapter={hasNextChapter}
          onPrevChapter={() => onSkipChapter(-1)}
          onNextChapter={() => onSkipChapter(1)}
          onScrub={scrubTo}
          scrubTarget={settings.mode === 'paged' ? scrubFlat : undefined}
          offset={stitched ? prefixLen : 0}
          // The chapter being READ — the same one `offset` and `onSeek` speak. `total` above is
          // whatever the pill is counting, which mid-crossing is the neighbour. See `scrubTotal`.
          scrubTotal={pages.length}
          onSeek={seekTo}
          onScrubbingChange={handleScrubbing}
          onScrubPage={warmSoon}
        />
      )}
      </Animated.View>
    </>
  );
});

/** The chrome's "Details" pill — the guaranteed, non-gesture way into the details card. Sits above
 *  the bottom chrome and fades with it. Needed because the cross-axis swipe can't always win:
 *  the web pager owns its whole touch surface, and an overflowing fit-width page's content-pan
 *  (rightly) takes vertical drags in paged mode. */
function DetailsHint({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
  }));
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.detailsHintWrap, { bottom: insets.bottom + Spacing.two + 48 }, style]}>
      <Pressable
        testID="series-page.details"
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Show series details"
        style={styles.detailsHintPill}>
        {/* The chevron points where the READER goes — up and away, in both modes now. Webtoon
            pointed RIGHT back when its reveal was horizontal; the reveal is vertical everywhere
            since the drag-reveal was removed there, so the arrow was the last thing still
            describing the old motion. */}
        <ChevronUpIcon color="#fff" size={16} />
        <ThemedText type="small" style={styles.detailsHintLabel}>
          Details
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sequence resolving on a cold deep link — the reader's black, so the instance that replaces it
  // doesn't flash a background change.
  seqLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    // Transparent: the route is a contained transparent modal — the details layer is the opaque
    // fill, and a dismissal fades it out over the screen beneath (see dismissFadeStyle).
    backgroundColor: 'transparent',
  },
  // The zoom's window (see zoomMaskStyle). Absolutely positioned because its whole box is
  // animated; `overflow: hidden` is what makes it a mask rather than just a rounded outline.
  zoomMask: {
    // Box comes entirely from zoomMaskStyle (always explicit numbers) — nothing here, so a
    // percentage base can never race the animated one.
    position: 'absolute',
    overflow: 'hidden',
  },
  // The page inside that window — pinned to the SCREEN's size at the call site, never the mask's,
  // so a shrinking window crops it instead of reflowing it.
  zoomPage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // The flying copy of the tapped cover — positioned at the destination bound INSIDE the page, so
  // the page's own transform carries it from the card to that bound (see the render).
  zoomThumb: {
    position: 'absolute',
    overflow: 'hidden',
    // The card's own cover backing (series-card.tsx `coverBoxClip`), so a cover that hasn't
    // decoded yet reads as the same grey plate rather than a hole onto the page underneath.
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  // The SEARCH layer's slide-in ride — the one layer that still arrives as a push (see SearchLayer).
  searchSlide: {
    flex: 1,
    // The pushed-card shadow, and the opaque fill it needs — see lib/ios-card-pop.
    ...IOS_CARD_SHADOW,
  },
  // The reader's frame + clip. No background on either: the dark reader surface is a SEPARATE
  // static full-screen layer BEHIND the frame (readerSurface), so it keeps covering the screen
  // while the strip-centering translate moves the frame, and a dismissal can dissolve it in
  // place while only the page travels.
  readerFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  readerClip: {
    flex: 1,
    overflow: 'hidden',
  },
  readerSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: READER_BACKDROP,
  },
  pageWrap: {
    flex: 1,
  },
  // The top-bar crossfade layers (see headerBarStyle/headerBackStyle): above the band overlay
  // (zIndex 3) so whichever is visible takes the taps.
  headerBarWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
  },
  headerBackWrap: {
    position: 'absolute',
    left: Spacing.three,
    zIndex: 4,
    justifyContent: 'center',
  },
  headerBackBtn: {
    justifyContent: 'center',
  },
  // The seam: hangs above the details page background's top edge, fading the reader strip down
  // into the page — tall enough that the series title sits at its center.
  sheetFade: {
    position: 'absolute',
    top: -SHEET_FADE_H,
    left: 0,
    right: 0,
    height: SHEET_FADE_H,
  },
  readerTint: {
    backgroundColor: '#000',
  },
  // Touch surface over the reader strip (details mode).
  dockBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
  },
  detailsLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // The details layer sits in FRONT of the (static) reader backdrop, transparent above its page
  // background so the reader strip shows through.
  headerLayer: {
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  // The details page's opaque fill — its animated top edge (plus the seam gradient hanging above
  // it) IS the strip boundary.
  headerSheetBg: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  detailsContent: {
    flex: 1,
  },
  // The two halves of the exiting card's shadow (see the render). Both hang off the OPAQUE
  // fill's right edge — `left: '100%'` inside headerSheetBg, which clips nothing (the seam
  // gradient already hangs above it the same way).
  detailsHintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  detailsHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  detailsHintLabel: {
    color: '#fff',
  },
});
