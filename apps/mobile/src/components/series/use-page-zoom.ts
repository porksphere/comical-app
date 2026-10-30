import type { ImageLoadEventData } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { trace, traceJS } from '@/lib/gesture-trace';
import {
  holdZoomingSeries,
  onZoomSurfaceChange,
  resolveZoomTarget,
  takeZoomOrigin,
  zoomSourceHolds,
} from '@/lib/series-zoom';
import {
  COLLAPSE_ARMED,
  COLLAPSE_STARTED,
  LEAVE_AT_ZOOM,
  ZOOM_IN_SPRING,
  ZOOM_OUT_SPRING,
  ZOOM_RADIUS_CURVE_SWAP_AT,
  ZOOM_RADIUS_ROUNDED_BY_CLOSE,
  ZOOM_RADIUS_ROUNDED_BY_OPEN,
  ZOOM_THUMB_PAINT_WAIT_MS,
  computeZoomGeom,
  zoomDetach,
  zoomHoming,
  zoomMaskBox,
} from '@/components/series/page-motion';

const IS_WEB = Platform.OS === 'web';

/**
 * The ZOOM a series page arrives and leaves by: grown out of the card that was tapped, and
 * collapsed back into it by the chevron, hardware back or a drag. Shared by the details and the
 * reader page, which each add their own destination (the details' hero cover, the reader's page)
 * and their own gestures on top of the values this returns.
 *
 * `handedOff`: a split page handed the move by the page it covers (see SplitHandoff), which starts
 * open and draws its own entrance.
 */
export function usePageZoom({
  id,
  depth,
  width,
  height,
  nativePush,
  handedOff,
  markEntranceSettled,
  leaveOnce,
  routeBackHeld,
  hasLeft,
}: {
  id: string | undefined;
  depth: number;
  width: number;
  height: number;
  nativePush: boolean;
  handedOff: boolean;
  markEntranceSettled: () => void;
  leaveOnce: () => void;
  routeBackHeld: () => boolean;
  hasLeft: () => boolean;
}) {
  // NOTE: nothing here tracks "this page is leaving". It used to — `const [leaving, setLeaving] =
  // useState(false)`, flipped from inside the commit — and that re-rendered the whole series page
  // on the frame the collapse animation started. Profiles measured that render at 40–114ms, and on
  // iOS the UI thread IS the main thread, so the native commits behind it land on the one thread
  // the animation needs. A stutter on every single exit, unreachable by any amount of animation
  // tuning because the animation was never the problem. The two things that flag bought — dropping
  // touches on a page on its way out, and the wall-clock backstop — both live in `LeavingMask` now,
  // which reads `edgeCommitting` itself and re-renders nothing but itself.
  const edgeCommitting = useSharedValue(false);

  // 0 = the thumbnail is sitting on its card and the page is invisible, 1 = the page is up and
  // the thumbnail is gone. A split page handed the move starts up: that move is `progress`'s.
  const zoom = useSharedValue(handedOff ? 1 : 0);
  // The page stays at IDENTITY (invisible, opacity 0) until the entrance starts; only then do the
  // transform and the mask engage.
  const zoomArmed = useSharedValue(false);
  // Which set of cross-fade ranges is in play (see the constants) — an exit uses different ones.
  const zoomClosing = useSharedValue(false);
  /** Which corner curve the window is on. Set by every closing path alongside `zoomClosing`, but
   *  NOT cleared with it — see the reaction below, and `ZOOM_RADIUS_ROUNDED_BY_CLOSE`. */
  const zoomRadiusClosing = useSharedValue(false);
  // A drag's resisted follow (the details' back-swipe, the reader's dismiss), added to the page's
  // transform and faded out by the collapse, so a page released well off to the side still lands
  // exactly on its card. `zoom` itself is what the finger moves — 1 open, 0 collapsed onto the card.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  /** See `zoomHoming`. Every path that drives `zoom` sets this first — there is no default that is
   *  right for all of them, and a stale one is a page that converges on the wrong thing. */
  const homeAt = useSharedValue(0);
  // The flying copy's IMAGE aspect (w/h), captured from its own onLoad. 0 = not yet known. What
  // the reader's sequence-mode copy morph needs: the copy's rect interpolates toward the image's
  // true fit rect, and only the image itself knows its shape.
  const zoomThumbAspect = useSharedValue(0);

  /**
   * THE leave trigger: the page having actually reached the card. One reaction for every exit —
   * the chevron, hardware back, the reader's dismiss fling, and the details back-swipe.
   *
   * All four used to leave from their own spring's completion callback, deliberately ignoring
   * `finished` on the grounds that an interrupted collapse is still a collapse and a page that
   * animates out without leaving is stranded. That reasoning holds for a curve interrupted AT its
   * end state. It is exactly wrong for one interrupted at the START — and something opening the
   * page can still be writing `zoom` a moment later (the entrance spring, a late `startZoom` once
   * the details' hero cover measures — see ZOOM_BOUND_WAIT_MS). Any such write cancels the
   * collapse, the callback fires regardless, and the page vanishes on the frame the finger lifted.
   * Which is precisely the report: close soon after opening and the animation "finishes as soon as
   * I let go".
   *
   * Asking the VALUE instead of the curve removes the whole class. It cannot fire early, because
   * zoom at the card is what leaving means; and it cannot strand the page, because a collapse that
   * gets cancelled before arriving is still covered by the wall-clock backstop in LeavingMask.
   */
  /**
   * Retire the closing corner curve only once the page has actually got back to the top.
   *
   * `zoomClosing` cannot do this job: `settle` clears it on the frame a cancelled swipe releases,
   * which is mid-springback, where the two curves disagree by most of a corner. Waiting for zoom
   * itself puts the flip at q = 1, where both curves give 0 and the swap is invisible.
   */
  useAnimatedReaction(
    () => zoom.value >= ZOOM_RADIUS_CURVE_SWAP_AT,
    (home) => {
      if (home) zoomRadiusClosing.set(false);
    },
  );
  useAnimatedReaction(
    () => edgeCommitting.value && zoom.value <= LEAVE_AT_ZOOM,
    (arrived, was) => {
      if (arrived && !was) runOnJS(leaveOnce)();
    },
  );

  // Where the page came FROM: the cover box of the card that was tapped, in window coordinates
  // (lib/series-zoom). EVERY instance takes one — a drilled layer is opened from a card in a
  // related rail (or a nested search result), and that is just as much an "open this series" as a
  // tap on the browse grid, so it gets the same entrance rather than a push.
  //
  // Consumed in a state initializer so it's known on the FIRST render — a frame later would start
  // the grow from the wrong geometry. The ENTRANCE keeps this rect; the exit re-aims off it via
  // `heroShift`, because on a last-read list the card has moved by then. Don't freeze the exit to it.
  // A pushed card takes none either: its entrance is the system's slide (useNativePush). Nor a split
  // page handed the move, which draws its own.
  const [zoomSource] = useState(() => (IS_WEB || nativePush || handedOff ? null : takeZoomOrigin(id)));
  /**
   * How far the source card has moved since capture, applied only at the collapsed end (scaled by
   * `1 - q`). Kept out of `hero` so `zoomGeom` and its styles never recompute mid-flight; sprung, so
   * a row that moves during a collapse curves the transition to it rather than snapping. Only x/y —
   * a reorder moves a row without resizing it, which keeps `zoomGeom` valid throughout.
   */
  const heroShiftX = useSharedValue(0);
  const heroShiftY = useSharedValue(0);
  // The source rect the page aligns itself to. The page is its own transition subject (see
  // zoomMaskStyle); the flying copy only stands in for the card at the collapsed end.
  const hero = zoomSource?.origin ?? null;
  const zoomStartedRef = useRef(false);
  // Blanking the source card is tied to ARMING, not to mount: a wait for the destination before
  // the entrance happens with everything here invisible, and a card blanked during it would just
  // be a hole in the grid. From arming on it stays blanked for this page's whole life — the copy
  // stands in for it, and the collapse spends most of its length with a half-transparent page over
  // the live grid, which is where showing both would be obvious.
  //
  // …and it also waits for the COPY TO HAVE PIXELS, which is the rest of the same thought. The
  // copy's <Image> mounts no earlier than the arm — with the page on the reader, in the very commit
  // that arms it on the details, where both hang off the hero cover's measurement — so the copy is
  // a brand new image view at the moment the animation starts, and a brand new image view has
  // nothing to draw for at least a frame even when the bitmap is already in memory. Blanking the
  // card on that frame left a hole exactly where the eye was: the card gone, the copy not yet
  // there, the page still at opacity 0. That is the flash on tapping a card.
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
   *  carries the image's intrinsic size, which feeds the reader's sequence-mode copy morph. */
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
    // Nothing was dragged: the classic collapse, in the card's coordinates from the first frame.
    homeAt.set(0);
    // WEB has no entrance to play. `zoomSource` is null there (see its declaration), so there is no
    // card for the page to grow out of and the spring was a page scaling up from the middle of
    // nothing — which is what read as a laggy fade rather than as an opening. Land on the open state
    // in one frame instead. The COLLAPSE is untouched: that one follows a finger, so it is a
    // response rather than a flourish, and it still needs `zoom` to travel.
    // A pushed card likewise: the slide in is the system's (useNativePush). And a split page handed
    // the move.
    if (IS_WEB || nativePush || handedOff) {
      zoom.set(1);
      traceJS('open', 'entered', { finished: true, instant: true });
      return;
    }
    zoom.set(
      withSpring(1, ZOOM_IN_SPRING, (finished) => {
        // Closes the bracket opened at mount (usePageLeave). The span between them is the OPEN:
        // mounting the page and playing the entrance, which is the cost any scheme for reusing this
        // page instead of rebuilding it would be buying back.
        trace('open', 'entered', { finished: !!finished });
        // Fires on cancellation too (finished: false) — an interrupted entrance must still open
        // the pane's window, or a dismissal begun mid-entrance would strand it at standby.
        runOnJS(markEntranceSettled)();
      }),
    );
  }, [zoom, zoomArmed, homeAt, blankSource, markEntranceSettled, nativePush, handedOff]);
  /** Whether the entrance has begun: a destination reported after it is too late to aim at. */
  const isZoomStarted = useCallback(() => zoomStartedRef.current, []);

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
  // card we came from, then leave (usePageLeave pops the layer, or the route when depth 0). The
  // route's `animation: 'none'` means this IS the exit animation — without it a tapped back would
  // just blink the screen away.
  const closeLayer = useCallback(() => {
    if (hasLeft() || routeBackHeld()) return;
    // A pushed card has nothing to shrink into — the pop is the exit (useNativePush).
    if (nativePush) {
      leaveOnce();
      return;
    }
    zoomClosing.set(true);
    zoomRadiusClosing.set(true);
    edgeCommitting.set(true);
    homeAt.set(0);
    // WEB closes in one frame, the mirror of the entrance: with no source card the collapse has
    // nothing to shrink INTO, so it was a page scaling down toward the middle of a grid it never
    // came from. A gesture's release is different and still springs (see the details back-swipe's
    // onEnd and the reader dismiss's): there the finger has already moved the page, and cutting the
    // rest would strand it mid-drag. This one is a click, and a click has no motion to finish.
    zoom.set(IS_WEB ? 0 : withSpring(0, ZOOM_OUT_SPRING));
    // No completion callback: leaving is driven by `zoom` reaching the card (see the leave reaction
    // above), with LeavingMask's backstop as the safety net.
  }, [
    hasLeft,
    edgeCommitting,
    homeAt,
    zoom,
    zoomClosing,
    zoomRadiusClosing,
    nativePush,
    leaveOnce,
    routeBackHeld,
  ]);

  const [collapsing, setCollapsing] = useState(false);
  /**
   * Ask the source card where it is, once per collapse. Hung off `zoom` leaving the top rather than
   * off the gestures — the pans, the back-swipe, the chevron and Android back all move it, and a new
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

  /**
   * THE substituted hero, for a source that has gone: the card's own size at the screen's centre.
   *
   * Its size is kept and only its POSITION replaced: the size is what the collapse's scale is
   * derived from, so keeping it keeps the same shrink, and the card's size is still the honest thing
   * for a page that came out of that card to shrink back to. What is not honest is any position on
   * this screen, so it takes the only neutral one there is.
   *
   * It has to be read by EVERY consumer of `hero` on the converging path, not just by the geometry.
   * That was the bug in the first cut: `computeZoomGeom` took the centred rect while `zoomMaskStyle`
   * and `zoomPageStyle` went on calling `zoomMaskBox(hero, …)` with the real one, so the window
   * converged on the card's old slot while the page inside it converged on the middle. Centre-ish
   * cards hid it — the two answers nearly coincide there — and a card down the left edge showed it
   * as a page clipped by a window somewhere else, with its left corners square because that window
   * had run into the screen edge.
   *
   * `zoomDetach` is the reason the centre is exactly right rather than merely neutral: its offset is
   * `span/2 − start − size/2`, which for a centred box is 0 at every `home`. So a no-source collapse
   * sits still under a drag instead of being pulled toward a card, with no special case anywhere.
   */
  const heroCentred = useMemo(
    () => (hero ? { ...hero, x: (width - hero.width) / 2, y: (height - hero.height) / 2 } : null),
    [hero, width, height],
  );
  const zoomGeomNoSource = useMemo(
    () => (heroCentred ? computeZoomGeom(heroCentred, { kind: 'no-source' }, width, height) : null),
    [heroCentred, width, height],
  );
  /**
   * Whether the card this page came out of is still in its list. LATCHED, because every frame of
   * ONE collapse has to answer it the same way, and the fact itself arrives asynchronously: a
   * surface reports a removal whenever its items change, which can be mid-collapse, and that is
   * precisely when a destination may not be swapped.
   *
   * So it is read while the page is at REST (`zoom` at the top), and the collapse only ever consults
   * what was already settled before it started. Subscribing at rest is what makes that possible, and
   * it is nearly free: `notifyZoomSurfaceChanged` no-ops when nobody is listening, and this is the
   * only listener a page keeps outside a collapse.
   *
   * `undefined` — a surface that cannot say, or has unmounted — deliberately leaves the latch alone
   * rather than reading as gone. See `zoomSourceHolds`.
   *
   * Two guards keep it off the latch mid-flight. The subscription is not held AT ALL while
   * `collapsing` (the same shape as the exit-origin subscription above, and the reason a reorder can
   * re-aim but never re-destine), and since `collapsing` only turns on once `zoom` has fallen past
   * COLLAPSE_STARTED, the frames between a drag beginning and that threshold are covered by reading
   * `zoom` directly.
   *
   * That read is done ON THE UI THREAD, which is the point of the hop below rather than an
   * indulgence: `zoom` is driven by springs in the UI runtime, so it is the only runtime whose read
   * of it is authoritative for the current frame. Membership is JS-side data and stays here; only
   * the guard and the write cross over.
   */
  const zoomSourceAlive = useSharedValue(true);
  useEffect(() => {
    if (collapsing || !zoomSource || !id) return;
    const check = () => {
      const holds = zoomSourceHolds(zoomSource.source, id);
      traceJS('zoom', 'holds', { holds: holds ?? false, known: holds !== undefined });
      // `undefined` is a surface that cannot say — never read as gone. See `zoomSourceHolds`.
      if (holds === undefined) return;
      runOnUI((h: boolean) => {
        'worklet';
        if (zoom.value >= COLLAPSE_ARMED) zoomSourceAlive.set(h);
      })(holds);
    };
    // Also on (re-)subscribe: a cancelled collapse re-arms the page, and this is where it re-reads.
    check();
    return onZoomSurfaceChange(zoomSource.source, check);
  }, [collapsing, id, zoom, zoomSource, zoomSourceAlive]);

  // THE MASK. Grows from the source rect to the whole screen, carrying the card's corner radius
  // out to 0. In the library this lives INSIDE the transformed content and undoes the content
  // transform to reach absolute coordinates; here it is the content's PARENT, which gets the same
  // result with none of the compensation math — at the cost of the page needing to undo the
  // mask's own offset (see each page's zoomPageStyle).
  const zoomMaskStyle = useAnimatedStyle(() => {
    // Always explicit numbers, never a percentage fallback from the stylesheet — a mask that is
    // sometimes laid out and sometimes transformed is how the two halves get to disagree.
    // No source rect, or not yet armed: the whole screen, so nothing is clipped.
    // The rect this collapse actually converges on — the card's, or its stand-in once the card has
    // gone. Every reader of it below must pick the same one, or the window and its contents shrink
    // toward different places. See `heroCentred`.
    const h = (zoomSourceAlive.value ? hero : heroCentred) ?? hero;
    if (!h || !zoomArmed.value) {
      return { left: 0, top: 0, width, height, borderRadius: 0, borderCurve: 'continuous' as const };
    }
    // Clamped at the bottom: the close spring is underdamped (damping ratio ~0.85, the library's
    // own figure) and undershoots 0 by a percent or two, which on a raw lerp would mean a mask
    // narrower than the card — and briefly a NEGATIVE width. The top needs no clamp: the open
    // spring is heavily overdamped and never passes 1.
    const q = Math.max(0, zoom.value);
    const home = zoomHoming(homeAt.value, q);
    const box = zoomMaskBox(h, heroShiftX.value, heroShiftY.value, q, width, height);
    return {
      // The drag moves the MASK, not the page inside it. Both have to travel together or the page
      // slides out from under its own window — a rectangle of page hanging in the wrong place,
      // which is exactly what a dragged mask-less collapse looked like. Which is also why the
      // DETACH rides here and only here: everything in the window is placed relative to this
      // origin, so moving it carries the page, the cover and the flying copy along untouched.
      //
      // Both fade out with `home` rather than springing back on release, and that is what makes the
      // landing exact: at q = 0 the homing is 1, so neither contributes anything whatever the finger
      // was doing, and the window is the card's box. The drag's own value is simply left where the
      // release froze it — nothing has to animate it away, so nothing can still be animating it when
      // the page leaves.
      left: box.left + zoomDetach(box.left, box.width, home, width) + dragX.value * (1 - home),
      top: box.top + zoomDetach(box.top, box.height, home, height) + dragY.value * (1 - home),
      width: box.width,
      height: box.height,
      borderRadius:
        h.radius *
        interpolate(
          q,
          [zoomRadiusClosing.value ? ZOOM_RADIUS_ROUNDED_BY_CLOSE : ZOOM_RADIUS_ROUNDED_BY_OPEN, 1],
          [1, 0],
          Extrapolation.CLAMP,
        ),
      borderCurve: 'continuous' as const,
    };
  }, [hero, heroCentred, width, height]);

  return {
    edgeCommitting,
    zoom,
    zoomArmed,
    zoomClosing,
    zoomRadiusClosing,
    dragX,
    dragY,
    homeAt,
    zoomThumbAspect,
    zoomSource,
    hero,
    heroShiftX,
    heroShiftY,
    onZoomThumbPainted,
    startZoom,
    isZoomStarted,
    closeLayer,
    collapsing,
    heroCentred,
    zoomGeomNoSource,
    zoomSourceAlive,
    zoomMaskStyle,
  };
}
