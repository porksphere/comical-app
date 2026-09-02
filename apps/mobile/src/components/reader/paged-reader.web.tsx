import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  edgeOffset,
  pageGeometry,
  panLimits,
  TAP_PAN_FRACTION,
  WIDE_ZOOM_HEADROOM,
  ZOOMED_EDGE_TURN_FRACTION,
  type Size,
} from '@/components/reader/page-geometry';
import type { ReaderPageItem } from '@/components/reader/paged-reader';
import { ReaderPage, STANDBY_FADE_MS } from '@/components/reader/reader-page';
import {
  clamp,
  distance,
  DOUBLE_TAP_DIST,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  midpoint,
  type Point,
  ZOOM_EPSILON,
} from '@/components/reader/reader-zoom';
import type { PageFit } from '@/hooks/use-reader-settings';
import { releaseCommitted } from '@/lib/gesture-release';

export type PagedReaderHandle = {
  goToPage: (logical: number, animated?: boolean) => void;
  /** Web has no continuous scrubber (it keeps the tap-to-jump progress pill), so this is just the
   *  nearest-page jump — present only to satisfy the shared handle shape. */
  scrubTo: (logical: number) => void;
};

type Props = {
  /** Per-chapter on web (nothing is stitched here): this pager hands a swipe
   *  past the last/first page to onNext/onPrev (see finalizeSwipe), so chapter
   *  transitions stay the screen's business. Item shape shared with native. */
  pages: ReaderPageItem[];
  width: number;
  height: number;
  rtl: boolean;
  pageFit: PageFit;
  /** Rest a spread at the viewport's height — see page-geometry's `pageGeometry`. */
  zoomWidePages: boolean;
  initialPage: number;
  onPageChange: (logical: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleChrome: () => void;
  /** True while the pager is parked as a DECORATIVE background (the series page's collapsed
   *  strip): shrinks the mounted-image radius to the visible page only, so neighbouring pages
   *  aren't requested until the reader becomes primary again. (Mirrors the native prop.) */
  standby?: boolean;
};

/**
 * Horizontal paged reader — WEB ONLY (`.web.tsx`; native uses the FlatList
 * variant in `paged-reader.tsx`).
 *
 * The native pager leans on a `pagingEnabled` FlatList for swiping and lets the
 * browser do pinch-zoom on web. That combination is a dead end on iOS WebKit
 * (which is what *every* iOS browser, including Chrome, runs): you can't
 * suppress the browser's native pinch while still relying on native touch-scroll
 * for the swipe — `touch-action` is all-or-nothing, so allowing `pan-x` for the
 * swipe is exactly what re-enables the pinch.
 *
 * So on web we own every gesture ourselves. The surface gets `touch-action:
 * none` (+ a non-passive `touchmove`/`gesturestart` preventDefault for iOS) and
 * a single Pointer Events controller drives:
 *   - swipe       (1 finger, not zoomed)        → track follows the finger, settles on release
 *   - tap         (1 finger, no movement)       → instant page turn / chrome toggle, no animation
 *   - pinch       (2 fingers)                   → scales only the current page; chrome stays put
 *   - pan         (1 finger, zoomed)            → moves the zoomed image within bounds
 *   - content-pan (1 finger, fit-width overflow) → scrolls the overflowing page vertically instead
 *                                                  of turning it (see the direction-disambiguation
 *                                                  logic in `onPointerMove`'s 'swipe' branch)
 *
 * Pages live in an absolutely-positioned flex row translated via a CSS
 * transform; zoom is a transform on the current page's inner wrapper, so the
 * toolbar / progress pill / settings (siblings on the series page) never move.
 *
 * RTL: the data array is reversed and logical↔physical mapping keeps "next" =
 * reading order +1. Gestures move the track in PHYSICAL terms regardless of
 * direction (left tap zone = physical −1, right = physical +1; dragging content
 * left = physical +1) — which under RTL already reads correctly, since the
 * reversed track puts the next page to the left. Only two things translate back
 * to logical: the reported page number (`toLogical`) and, at either end of the
 * track, which chapter a hand-off goes to — physical n−1 is the LAST page in
 * reading order in LTR but the FIRST in RTL.
 */

// Fraction of the width a swipe must cover (or the fling velocity it must beat)
// to commit a page turn instead of springing back.
const SWIPE_DISTANCE_RATIO = 0.2;
const SWIPE_VELOCITY = 0.35; // px/ms
// A press that stays within this many px for under this long is a tap, not a drag.
const TAP_MAX_MOVE = 10; // px
const TAP_MAX_MS = 250;
const SETTLE_MS = 260;
const ZOOM_SNAP_MS = 200;
const SETTLE_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
// How many pages on each side of the current one keep a mounted image. Pages
// outside this window render as empty (fixed-size) cells, so the flex track keeps
// its full width and the translateX math stays exact, but only ~(2R+1) images
// are ever in memory. Rendering all N at once OOM-crashes the tab on iOS Chrome.
const RENDER_RADIUS = 2;
// A 'swipe' drag under this many px hasn't committed to a direction yet — past
// it, a vertical-dominant drag becomes 'content-pan' (fit-width overflow only),
// a horizontal-dominant one stays 'swipe'.
const DIR_DEADZONE = 8; // px
// Pan-fling friction: velocity is multiplied by this each 16ms frame, and the
// glide stops once it drops below MIN_FLING_V (px/ms). (Double-tap tuning lives
// in reader-zoom.ts — shared with the webtoon reader.)
const FLING_FRICTION = 0.94;
const MIN_FLING_V = 0.02;
// A pinch that reached at least this scale counts as a deliberate zoom-in, so a
// final frame that dips back under ZOOM_EPSILON on lift (common on a fast pinch)
// commits the zoom instead of rubber-banding to 1×.
const PINCH_COMMIT = 1.2;

type Mode = 'idle' | 'swipe' | 'pan' | 'pinch' | 'content-pan';

export const PagedReader = forwardRef<PagedReaderHandle, Props>(function PagedReader(
  { pages, width, height, rtl, pageFit, zoomWidePages, initialPage, onPageChange, onPrev, onNext, onToggleChrome, standby },
  ref,
) {
  const n = pages.length;
  const clampIndex = useCallback((i: number) => Math.max(0, Math.min(n - 1, i)), [n]);
  const toPhysical = useCallback((logical: number) => (rtl ? n - 1 - logical : logical), [rtl, n]);
  const toLogical = useCallback((physical: number) => (rtl ? n - 1 - physical : physical), [rtl, n]);
  const data = useMemo(() => (rtl ? [...pages].reverse() : pages), [pages, rtl]);

  const [index, setIndex] = useState(() => toPhysical(clampIndex(initialPage)));
  const [zoomed, setZoomed] = useState(false);
  // Whether the CURRENT page is showing its failed/Retry state. When true, the
  // pointer handlers below back off entirely (no capture, no swipe/tap
  // handling) so a tap reaches the page's own Retry button via the browser's
  // normal click dispatch — `setPointerCapture` below would otherwise redirect
  // every subsequent pointer event to this surface, and the nested Retry
  // Pressable would never see a matching pointerup to fire its own onPress.
  const [currentFailed, setCurrentFailed] = useState(false);
  const currentFailedRef = useRef(false);
  currentFailedRef.current = currentFailed;
  useEffect(() => setCurrentFailed(false), [index]);

  // Every mounted page's real picture dimensions, by key. Kept for ALL of them, not just the
  // current page: neighbours are mounted (and loaded) ahead of being read, and an image that
  // finished loading while it was a neighbour never fires `onLoad` again on becoming current — so
  // the shape of a page has to be remembered from whenever it arrived, or a preloaded spread
  // would turn up letterboxed and a preloaded tall fit-width page would refuse to scroll.
  const [dims, setDims] = useState<ReadonlyMap<string, Size>>(() => new Map());
  const recordDims = useCallback((key: string, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    setDims((prev) => {
      const had = prev.get(key);
      if (had && had.width === w && had.height === h) return prev;
      return new Map(prev).set(key, { width: w, height: h });
    });
  }, []);
  const image = dims.get(data[index]?.key ?? '') ?? null;

  // fit-width content that's taller than the viewport: a one-finger vertical drag scrolls it (see
  // the 'content-pan' mode below). Derived from the current page's own dims, so a page whose
  // shape isn't known yet never inherits the previous page's "overflows".
  const contentAspectRef = useRef(1); // current image's width/height ratio
  contentAspectRef.current = image ? image.width / image.height : 1;
  const contentOverflows = pageFit === 'fit-width' && image != null && width * (image.height / image.width) > height + 1;
  const contentOverflowsRef = useRef(false);
  contentOverflowsRef.current = contentOverflows;

  // Where the current page RESTS — 1× for most pages, fit-height at the reading edge for a spread
  // — and the box its pan is clamped to (see page-geometry). Only a fit-page picture is centred
  // in the viewport, which is what that clamp assumes; a fit-width one is top-aligned and keeps
  // the viewport clamp it always had.
  const geometry = useMemo(
    () => pageGeometry(pageFit === 'fit-page' ? image : null, { width, height }, zoomWidePages, rtl),
    [pageFit, image, width, height, zoomWidePages, rtl],
  );
  const box: Size = pageFit === 'fit-page' ? geometry.content : { width, height };
  const { restScale, restEdge } = geometry;
  const maxScale = Math.max(MAX_SCALE, restScale * WIDE_ZOOM_HEADROOM);
  const restTx = edgeOffset(restEdge, panLimits(restScale, box, { width, height }).x);
  const restZoomed = restScale > ZOOM_EPSILON;
  const restRef = useRef({ box, restScale, restTx, restZoomed, maxScale });
  restRef.current = { box, restScale, restTx, restZoomed, maxScale };

  // DOM handles for imperative transform writes (gesture frames bypass React).
  const surfaceRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null); // wrapper of the current page

  // Mirrors of state read inside event handlers, kept current every render.
  const indexRef = useRef(index);
  indexRef.current = index;
  const zoomedRef = useRef(zoomed);
  zoomedRef.current = zoomed;

  // Live zoom transform for the current page (scale + pan), written to the DOM.
  const zoom = useRef({ scale: 1, tx: 0, ty: 0 });

  // rAF handle for the in-flight pan-momentum glide (null when idle).
  const inertiaRef = useRef<number | null>(null);
  // Last committed tap (time + position), for double-tap detection, plus the
  // deferred single-tap timer (a single tap waits DOUBLE_TAP_MS to rule out a double).
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const pendingTapRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gesture = useRef({
    mode: 'idle' as Mode,
    pointers: new Map<number, Point>(),
    // swipe
    startX: 0,
    dx: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    // tap
    downX: 0,
    downY: 0,
    downT: 0,
    moved: false,
    // direction disambiguation ('swipe' vs 'content-pan')
    dirDecided: false,
    // pan (zoomed, or content-pan when fit-width overflows)
    panStartX: 0,
    panStartY: 0,
    panBaseTx: 0,
    panBaseTy: 0,
    panFromLeftEdge: false,
    panFromRightEdge: false,
    // pan velocity, for the momentum fling on release
    panLastX: 0,
    panLastY: 0,
    panLastT: 0,
    panVX: 0,
    panVY: 0,
    // Whether this pan may fling on release. Only a STANDALONE pan (one finger on an
    // already-zoomed page) coasts; a pan spun up from a pinch's leftover finger must
    // not, so releasing a pinch never drifts the image.
    momentumOk: false,
    // pinch
    startDist: 0,
    focalStartX: 0,
    focalStartY: 0,
    baseScale: 1,
    basePinchTx: 0,
    basePinchTy: 0,
    // Largest scale reached during the current pinch — lets the release tell a
    // real zoom-in (whose last frame may dip on lift) from a tiny/settled pinch.
    pinchMaxScale: 1,
  }).current;

  const writeTrack = useCallback(
    (dx: number, animate: boolean) => {
      const el = trackRef.current;
      if (!el) return;
      el.style.transition = animate ? `transform ${SETTLE_MS}ms ${SETTLE_EASING}` : 'none';
      el.style.transform = `translate3d(${-indexRef.current * width + dx}px, 0, 0)`;
    },
    [width],
  );

  const writeZoom = useCallback((animate: boolean) => {
    const el = zoomRef.current;
    if (!el) return;
    const { scale, tx, ty } = zoom.current;
    el.style.transition = animate ? `transform ${ZOOM_SNAP_MS}ms ease-out` : 'none';
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  }, [zoom]);

  const cancelInertia = useCallback(() => {
    if (inertiaRef.current != null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  }, []);

  const setZoomedNow = useCallback((next: boolean) => {
    if (zoomedRef.current === next) return;
    zoomedRef.current = next;
    setZoomed(next);
  }, []);

  // Put the current page at rest (see `restRef`): 1× for most pages, fit-height for a spread.
  const goToRest = useCallback(
    (animate: boolean) => {
      cancelInertia();
      const { restScale: s, restTx: tx, restZoomed: z } = restRef.current;
      zoom.current = { scale: s, tx, ty: 0 };
      writeZoom(animate);
      setZoomedNow(z);
    },
    [cancelInertia, setZoomedNow, writeZoom, zoom],
  );
  // A page ARRIVING starts from rest, instantly — the native pager rests a neighbour before it is
  // ever seen, and this is the closest a single transform slot can get: `zoomRef` only points at
  // the new page's wrapper once this render has committed, so `settleTo` can't have placed it. A
  // rest that MOVES under the current page (its picture's dimensions arriving, the spread setting
  // flipped, a rotation) takes the page there animated, the way a spread that loads under your
  // eyes grows into place. Keyed on the rest and the page, never on anything the reader's own
  // zooming moves: a page whose rest hasn't moved keeps whatever zoom the reader gave it.
  const restedIndexRef = useRef(-1);
  useEffect(() => {
    const arriving = restedIndexRef.current !== index;
    restedIndexRef.current = index;
    const { scale, tx, ty } = zoom.current;
    if (Math.abs(scale - restScale) < 0.001 && Math.abs(tx - restTx) < 0.5 && Math.abs(ty) < 0.5) return;
    goToRest(!arriving);
  }, [index, restScale, restTx, goToRest, zoom]);

  // Momentum after a pan release: keep gliding from the last pan velocity,
  // decelerating each frame and stopping dead at the pan bounds. Grabbing again
  // (onPointerDown → cancelInertia) halts it immediately.
  const startPanInertia = useCallback(() => {
    cancelInertia();
    const s = zoom.current.scale;
    if (s <= 1) return;
    const { x: limitX, y: limitY } = panLimits(s, restRef.current.box, { width, height });
    let vx = gesture.panVX;
    let vy = gesture.panVY;
    if (Math.abs(vx) < MIN_FLING_V && Math.abs(vy) < MIN_FLING_V) return;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(32, now - last);
      last = now;
      let { tx, ty } = zoom.current;
      tx += vx * dt;
      ty += vy * dt;
      if (tx <= -limitX) { tx = -limitX; vx = 0; }
      else if (tx >= limitX) { tx = limitX; vx = 0; }
      if (ty <= -limitY) { ty = -limitY; vy = 0; }
      else if (ty >= limitY) { ty = limitY; vy = 0; }
      const decay = Math.pow(FLING_FRICTION, dt / 16);
      vx *= decay;
      vy *= decay;
      zoom.current = { scale: s, tx, ty };
      writeZoom(false);
      if (Math.abs(vx) > MIN_FLING_V || Math.abs(vy) > MIN_FLING_V) {
        inertiaRef.current = requestAnimationFrame(step);
      } else {
        inertiaRef.current = null;
      }
    };
    inertiaRef.current = requestAnimationFrame(step);
  }, [cancelInertia, gesture, width, height, writeZoom, zoom]);

  // Double-tap toggles between the page's rest and a fixed magnification centred on the tap point
  // (clamped into bounds). Unavailable when pinch is (fit-width overflow), matching the native
  // reader.
  const doubleTapZoom = useCallback(
    (x: number, y: number) => {
      cancelInertia();
      const { box: b, restScale: rest, maxScale: max } = restRef.current;
      const { scale: s0, tx: tx0, ty: ty0 } = zoom.current;
      // Anywhere but at rest — magnified, or pinched out below a spread's rest — goes back to rest.
      if (s0 > rest * ZOOM_EPSILON || s0 < rest / ZOOM_EPSILON) {
        goToRest(true);
        return;
      }
      const cx = width / 2;
      const cy = height / 2;
      const target = Math.min(DOUBLE_TAP_SCALE * rest, max);
      const limit = panLimits(target, b, { width, height });
      // Keep the tapped content point under the finger. From 1× at the origin this is the familiar
      // tx = (p − centre)(1 − scale); from a spread's rest the point has to be read back through
      // the rest transform first.
      const anchorX = (x - cx - tx0) / s0;
      const anchorY = (y - cy - ty0) / s0;
      const tx = clamp(x - cx - target * anchorX, -limit.x, limit.x);
      const ty = clamp(y - cy - target * anchorY, -limit.y, limit.y);
      zoom.current = { scale: target, tx, ty };
      writeZoom(true);
      setZoomedNow(true);
    },
    [cancelInertia, goToRest, setZoomedNow, width, height, writeZoom, zoom],
  );

  // Commit to a page. `animate` slides (swipe settle / pill jump); otherwise the
  // turn is instant (taps), per "don't animate the turn when tapping".
  const settleTo = useCallback(
    (nextIndex: number, animate: boolean) => {
      const clamped = clampIndex(nextIndex);
      const changed = clamped !== indexRef.current;
      indexRef.current = clamped;
      if (changed) {
        // Leaving a page drops its zoom, like the native reader. The page arriving is rested by
        // the effect on its own rest, once its shape is known; until then it stands at 1×.
        cancelInertia();
        zoom.current = { scale: 1, tx: 0, ty: 0 };
        writeZoom(false);
        setZoomedNow(false);
        setIndex(clamped);
        onPageChange(toLogical(clamped));
      }
      writeTrack(0, animate);
    },
    [clampIndex, cancelInertia, setZoomedNow, writeZoom, zoom, onPageChange, toLogical, writeTrack],
  );

  useImperativeHandle(
    ref,
    () => ({
      goToPage(logical: number, animated = true) {
        settleTo(toPhysical(clampIndex(logical)), animated);
      },
      scrubTo(logical: number) {
        settleTo(toPhysical(clampIndex(Math.round(logical))), false);
      },
    }),
    [settleTo, toPhysical, clampIndex],
  );

  // `initialPage` only seeds `index`'s initial state (read once, at mount) —
  // but the screen's own `currentPage` briefly starts at 0 before its
  // pages-loaded effect corrects it to the real requested start index, and
  // this component mounts in that same
  // window (gated behind `!pages`). Re-sync whenever `initialPage` changes and
  // no longer matches our own index — a mismatch only really happens from that
  // external correction (or an imperative `goToPage`, which already keeps
  // `indexRef` current itself), since ordinary in-component navigation updates
  // `indexRef.current` before reporting back up via `onPageChange`, so this is
  // a no-op once the two are in sync and won't fight normal page turns.
  useEffect(() => {
    const target = toPhysical(clampIndex(initialPage));
    if (target === indexRef.current) return;
    indexRef.current = target;
    setIndex(target);
    writeTrack(0, false);
  }, [initialPage, toPhysical, clampIndex, writeTrack]);

  // Position the track on mount and whenever the viewport (width) changes.
  useEffect(() => {
    writeTrack(0, false);
  }, [width, writeTrack]);

  // Suppress iOS WebKit's native pinch / double-tap zoom on the reader surface
  // only (scoped here, not globally, so the rest of the app scrolls normally).
  // touch-action: none stops most of it; the non-passive listeners cover the
  // bits iOS honours via JS (gesture events fire in Safari; touchmove is the
  // reliable lever in iOS Chrome).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', prevent, { passive: false });
    el.addEventListener('gesturestart', prevent as EventListener, { passive: false });
    el.addEventListener('gesturechange', prevent as EventListener, { passive: false });
    return () => {
      el.removeEventListener('touchmove', prevent);
      el.removeEventListener('gesturestart', prevent as EventListener);
      el.removeEventListener('gesturechange', prevent as EventListener);
    };
  }, []);

  // Stop any in-flight momentum glide / pending single-tap timer when unmounting
  // (e.g. switching reader modes or leaving the reader).
  useEffect(() => {
    return () => {
      if (inertiaRef.current != null) cancelAnimationFrame(inertiaRef.current);
      if (pendingTapRef.current != null) clearTimeout(pendingTapRef.current);
    };
  }, []);

  const posOf = useCallback((e: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const firstTwo = useCallback(
    () => [...gesture.pointers.values()].slice(0, 2) as [Point, Point],
    [gesture],
  );

  const beginPinch = useCallback(() => {
    const [a, b] = firstTwo();
    const mid = midpoint(a, b);
    gesture.mode = 'pinch';
    gesture.startDist = distance(a, b) || 1;
    gesture.focalStartX = mid.x;
    gesture.focalStartY = mid.y;
    gesture.baseScale = zoom.current.scale;
    gesture.pinchMaxScale = zoom.current.scale;
    gesture.basePinchTx = zoom.current.tx;
    gesture.basePinchTy = zoom.current.ty;
    // We're zooming, not turning — drop any in-progress swipe offset.
    writeTrack(0, false);
  }, [firstTwo, gesture, writeTrack, zoom]);

  const beginPan = useCallback(
    (p: Point, momentumOk: boolean) => {
      gesture.mode = 'pan';
      // Only a standalone pan (one finger on an already-zoomed page) may fling.
      gesture.momentumOk = momentumOk;
      gesture.panStartX = p.x;
      gesture.panStartY = p.y;
      gesture.panBaseTx = zoom.current.tx;
      gesture.panBaseTy = zoom.current.ty;
      // Whether the content already shows its left / right edge — a release heading further past
      // one is a page turn (see `endPointer`), judged from where the finger LANDED.
      const limitX = panLimits(zoom.current.scale, restRef.current.box, { width, height }).x;
      gesture.panFromLeftEdge = zoom.current.tx >= limitX - 1;
      gesture.panFromRightEdge = zoom.current.tx <= 1 - limitX;
      gesture.panLastX = p.x;
      gesture.panLastY = p.y;
      gesture.panLastT = performance.now();
      gesture.panVX = 0;
      gesture.panVY = 0;
      // Treat this finger's contact as a fresh interaction: judge tap-vs-fling on
      // ITS own movement, not anything inherited from a preceding pinch. Without
      // this, a leftover finger after a pinch counted as "already moved" and flung
      // the image on release (the "jumps after releasing pinch" bug).
      gesture.downX = p.x;
      gesture.downY = p.y;
      gesture.downT = performance.now();
      gesture.moved = false;
    },
    [gesture, zoom, width, height],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (currentFailedRef.current) return;
      // Grabbing the page halts any in-flight momentum glide.
      cancelInertia();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A stray capture failure (e.g. pointer already gone) must not throw out
        // of the handler and break the gesture.
      }
      const p = posOf(e);
      gesture.pointers.set(e.pointerId, p);

      if (gesture.pointers.size >= 2) {
        // No pinch while an overflowing fit-width page is content-pannable —
        // mirrors the native reader's mutual-exclusion rule (see zoomable-page.tsx).
        if (!(pageFit === 'fit-width' && contentOverflowsRef.current)) beginPinch();
        return;
      }
      // First finger down: remember it for tap detection.
      gesture.downX = p.x;
      gesture.downY = p.y;
      gesture.downT = performance.now();
      gesture.moved = false;
      gesture.dirDecided = false;
      if (zoomedRef.current) {
        beginPan(p, true); // standalone pan on a zoomed page — momentum allowed
      } else {
        gesture.mode = 'swipe';
        gesture.startX = p.x;
        gesture.dx = 0;
        gesture.lastX = p.x;
        gesture.lastT = performance.now();
        gesture.velocity = 0;
      }
    },
    [beginPan, beginPinch, cancelInertia, gesture, pageFit, posOf],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!gesture.pointers.has(e.pointerId)) return;
      const p = posOf(e);
      gesture.pointers.set(e.pointerId, p);
      const now = performance.now();
      const cx = width / 2;
      const cy = height / 2;

      if (gesture.mode === 'pinch' && gesture.pointers.size >= 2) {
        const [a, b] = firstTwo();
        const mid = midpoint(a, b);
        const factor = distance(a, b) / gesture.startDist;
        const nextScale = clamp(gesture.baseScale * factor, 1, restRef.current.maxScale);
        if (nextScale > gesture.pinchMaxScale) gesture.pinchMaxScale = nextScale;
        const anchorX = (gesture.focalStartX - cx - gesture.basePinchTx) / gesture.baseScale;
        const anchorY = (gesture.focalStartY - cy - gesture.basePinchTy) / gesture.baseScale;
        const limit = panLimits(nextScale, restRef.current.box, { width, height });
        zoom.current = {
          scale: nextScale,
          tx: clamp(mid.x - cx - nextScale * anchorX, -limit.x, limit.x),
          ty: clamp(mid.y - cy - nextScale * anchorY, -limit.y, limit.y),
        };
        writeZoom(false);
        return;
      }

      if (gesture.mode === 'pan') {
        const s = zoom.current.scale;
        const limit = panLimits(s, restRef.current.box, { width, height });
        zoom.current = {
          scale: s,
          tx: clamp(gesture.panBaseTx + (p.x - gesture.panStartX), -limit.x, limit.x),
          ty: clamp(gesture.panBaseTy + (p.y - gesture.panStartY), -limit.y, limit.y),
        };
        // Track a short-window velocity so release can fling with momentum.
        const dt = Math.max(1, now - gesture.panLastT);
        gesture.panVX = (p.x - gesture.panLastX) / dt;
        gesture.panVY = (p.y - gesture.panLastY) / dt;
        gesture.panLastX = p.x;
        gesture.panLastY = p.y;
        gesture.panLastT = now;
        if (Math.abs(p.x - gesture.downX) > TAP_MAX_MOVE || Math.abs(p.y - gesture.downY) > TAP_MAX_MOVE) {
          gesture.moved = true;
        }
        writeZoom(false);
        return;
      }

      if (gesture.mode === 'swipe' && !gesture.dirDecided) {
        const moved = Math.hypot(p.x - gesture.downX, p.y - gesture.downY);
        if (moved > DIR_DEADZONE) {
          gesture.dirDecided = true;
          const vertical = Math.abs(p.y - gesture.downY) > Math.abs(p.x - gesture.downX) * 1.2;
          if (vertical && pageFit === 'fit-width' && contentOverflowsRef.current && !zoomedRef.current) {
            gesture.mode = 'content-pan';
            gesture.panStartY = p.y;
            gesture.panBaseTy = zoom.current.ty;
            writeTrack(0, false); // undo any stray horizontal nudge picked up during the deadzone
          }
        }
      }

      if (gesture.mode === 'content-pan') {
        const contentHeight = width * (1 / contentAspectRef.current);
        const maxNeg = -Math.max(0, contentHeight - height);
        zoom.current = { scale: 1, tx: 0, ty: clamp(gesture.panBaseTy + (p.y - gesture.panStartY), maxNeg, 0) };
        writeZoom(false);
        gesture.moved = true;
        return;
      }

      if (gesture.mode === 'swipe') {
        let dx = p.x - gesture.startX;
        // Rubber-band against the ends so there's nowhere past the first/last page.
        if ((indexRef.current === 0 && dx > 0) || (indexRef.current === n - 1 && dx < 0)) {
          dx *= 0.35;
        }
        gesture.dx = dx;
        const dt = Math.max(1, now - gesture.lastT);
        gesture.velocity = (p.x - gesture.lastX) / dt;
        gesture.lastX = p.x;
        gesture.lastT = now;
        if (Math.abs(p.x - gesture.downX) > TAP_MAX_MOVE || Math.abs(p.y - gesture.downY) > TAP_MAX_MOVE) {
          gesture.moved = true;
        }
        writeTrack(dx, false);
      }
    },
    [firstTwo, gesture, height, n, pageFit, posOf, width, writeTrack, writeZoom, zoom],
  );

  const finalizePinch = useCallback(() => {
    if (zoom.current.scale > ZOOM_EPSILON) {
      // Ended clearly zoomed — keep it.
      setZoomedNow(true);
      return;
    }
    // Ended at ~1×. A deliberate zoom-in whose LAST frame dipped on lift (fingers
    // converging as they leave the glass) would rubber-band to 1× here — so if the
    // pinch STARTED from ~1× and actually reached a real zoom (pinchMaxScale), commit
    // at that peak instead. A pinch that started already-zoomed (a deliberate pinch
    // back down) still honours the return to 1×.
    if (gesture.baseScale <= ZOOM_EPSILON && gesture.pinchMaxScale > PINCH_COMMIT) {
      const target = clamp(gesture.pinchMaxScale, 1, restRef.current.maxScale);
      const limit = panLimits(target, restRef.current.box, { width, height });
      zoom.current = {
        scale: target,
        tx: clamp(zoom.current.tx, -limit.x, limit.x),
        ty: clamp(zoom.current.ty, -limit.y, limit.y),
      };
      writeZoom(true);
      setZoomedNow(true);
      return;
    }
    // Pinched all the way out. On a spread that is BELOW rest, and stays there — a look at the
    // whole thing — until the next double-tap or page turn; the page is simply unzoomed meanwhile.
    cancelInertia();
    zoom.current = { scale: 1, tx: 0, ty: 0 };
    writeZoom(true);
    setZoomedNow(false);
  }, [cancelInertia, setZoomedNow, zoom, gesture, width, height, writeZoom]);

  // One page over, physically: -1 is whatever sits to the LEFT of this page, 1 to the right.
  const turn = useCallback(
    (dir: -1 | 1) => {
      if (dir < 0) {
        // Nothing left physically to the left: hand off to the reader for chapter
        // navigation instead of a silent clamp. WHICH chapter depends on direction —
        // `data` is pre-reversed for RTL, so physical 0 is the last page in reading
        // order there (and the first in LTR).
        if (indexRef.current <= 0) (rtl ? onNext : onPrev)?.();
        else settleTo(indexRef.current - 1, false);
      } else {
        // Mirror image: physical n-1 is the last page in reading order in LTR, the
        // FIRST one in RTL — so the end of the track means auto-advance one way and
        // previous-chapter the other.
        if (indexRef.current >= n - 1) (rtl ? onPrev : onNext)?.();
        else settleTo(indexRef.current + 1, false);
      }
    },
    [onPrev, onNext, settleTo, n, rtl],
  );

  const handleTap = useCallback(
    (x: number) => {
      const dir: -1 | 0 | 1 = x < width * 0.3 ? -1 : x > width * 0.7 ? 1 : 0;
      if (zoomedRef.current) {
        // No tap zones while zoomed (mirrors native) — except on a page that RESTS zoomed, a
        // spread, where a side zone pans a step across it and only turns once there is nothing
        // left that way. The left zone asks for what lies to the LEFT: the content moving right.
        if (!restRef.current.restZoomed || dir === 0) return;
        const limitX = panLimits(zoom.current.scale, restRef.current.box, { width, height }).x;
        const target = clamp(zoom.current.tx - dir * width * TAP_PAN_FRACTION, -limitX, limitX);
        if (Math.abs(target - zoom.current.tx) > 1) {
          cancelInertia();
          zoom.current = { ...zoom.current, tx: target };
          writeZoom(true);
          return;
        }
        turn(dir);
        return;
      }
      if (dir === 0) onToggleChrome();
      else turn(dir);
    },
    [cancelInertia, onToggleChrome, turn, width, height, writeZoom, zoom],
  );

  // A completed one-finger tap. Double-tap-to-zoom means we can't act on a tap
  // until we know a second one isn't coming, so a lone tap's action is deferred by
  // DOUBLE_TAP_MS; a qualifying second tap cancels that and zooms instead.
  const handleTapGesture = useCallback(
    (x: number, y: number) => {
      // Double-tap zoom is off exactly where pinch is (an overflowing fit-width
      // page, which content-pans instead) — there, taps stay immediate.
      const canZoom = !(pageFit === 'fit-width' && contentOverflowsRef.current);
      const now = performance.now();
      const last = lastTapRef.current;
      if (
        canZoom &&
        last &&
        now - last.t < DOUBLE_TAP_MS &&
        Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_DIST
      ) {
        if (pendingTapRef.current != null) {
          clearTimeout(pendingTapRef.current);
          pendingTapRef.current = null;
        }
        lastTapRef.current = null;
        doubleTapZoom(x, y);
        return;
      }
      if (!canZoom) {
        handleTap(x);
        return;
      }
      lastTapRef.current = { t: now, x, y };
      if (pendingTapRef.current != null) clearTimeout(pendingTapRef.current);
      pendingTapRef.current = setTimeout(() => {
        pendingTapRef.current = null;
        lastTapRef.current = null;
        handleTap(x);
      }, DOUBLE_TAP_MS);
    },
    [pageFit, doubleTapZoom, handleTap],
  );

  const finalizeSwipe = useCallback(() => {
    const dur = performance.now() - gesture.downT;
    if (!gesture.moved && dur <= TAP_MAX_MS) {
      writeTrack(0, false); // undo any sub-threshold drift, then act as a tap
      handleTapGesture(gesture.downX, gesture.downY);
      return;
    }
    const passed =
      Math.abs(gesture.dx) > width * SWIPE_DISTANCE_RATIO || Math.abs(gesture.velocity) > SWIPE_VELOCITY;
    if (passed) {
      // Drag/fling left (dx < 0) advances one physical page; right goes back.
      const dir = gesture.dx !== 0 ? -Math.sign(gesture.dx) : -Math.sign(gesture.velocity);
      // Off the end of the track: hand the swipe to the reader for chapter nav
      // rather than rubber-banding into nothing. Physical ±1 is NOT reading order
      // ±1 under RTL (`data` is pre-reversed), so which chapter we hand off to is
      // decided in logical terms — otherwise swiping off the end of an RTL chapter
      // goes to the one you just came from.
      if (dir > 0 ? indexRef.current >= n - 1 : indexRef.current <= 0) {
        const forward = rtl ? dir < 0 : dir > 0;
        writeTrack(0, false);
        (forward ? onNext : onPrev)?.();
        return;
      }
      settleTo(indexRef.current + dir, true);
    } else {
      settleTo(indexRef.current, true); // spring back
    }
  }, [gesture, handleTapGesture, settleTo, width, writeTrack, onPrev, onNext, n, rtl]);

  const endPointer = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const wasMode = gesture.mode;
      gesture.pointers.delete(e.pointerId);

      if (wasMode === 'pinch') {
        finalizePinch();
        if (gesture.pointers.size === 1) {
          // One finger left after a pinch: pan with it if still zoomed — but NOT with
          // momentum (this pan is a pinch side-effect, not a standalone fling).
          const [p] = [...gesture.pointers.values()];
          if (zoomedRef.current) beginPan(p, false);
          else gesture.mode = 'idle';
        } else if (gesture.pointers.size === 0) {
          gesture.mode = 'idle';
        }
        return;
      }

      if (gesture.pointers.size > 0) return; // still mid-gesture

      if (wasMode === 'swipe') {
        finalizeSwipe();
      } else if (wasMode === 'pan') {
        // A zoomed one-finger interaction: a stationary press is a tap (→ double-tap
        // zoom-out); a genuine standalone drag flings on with momentum. Only a
        // momentum-eligible drag that actually `moved` flings — a pinch's leftover
        // finger (momentumOk=false) never coasts, so releasing a pinch can't drift.
        const dur = performance.now() - gesture.downT;
        if (!gesture.moved && dur <= TAP_MAX_MS) handleTapGesture(gesture.downX, gesture.downY);
        else if (gesture.moved && gesture.momentumOk) {
          // A drag that BEGAN at an edge and was let go heading further past it is the swipe a
          // zoomed page can't take: turn, the way a nested scroller hands off. Judged on where it
          // is headed (see lib/gesture-release), so a flick back at the last moment still cancels.
          const dx = gesture.panLastX - gesture.panStartX;
          const vx = gesture.panVX * 1000; // px/ms → px/s
          const threshold = width * ZOOMED_EDGE_TURN_FRACTION;
          if (gesture.panFromLeftEdge && releaseCommitted(dx, vx, threshold)) turn(-1);
          else if (gesture.panFromRightEdge && releaseCommitted(-dx, -vx, threshold)) turn(1);
          else startPanInertia();
        }
      }
      gesture.mode = 'idle';
    },
    [beginPan, finalizePinch, finalizeSwipe, handleTapGesture, startPanInertia, turn, width, gesture],
  );

  return (
    <div ref={surfaceRef} style={surfaceStyle(width, height)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={trackRef} style={trackStyle(n, width, height)}>
        {data.map((item, i) => {
          // Only pages within the window mount an image (lazy fetch + bounded
          // memory); the rest are empty placeholders that still hold the slot.
          // Standby (a decorative background strip) keeps only the page ON screen.
          const near = Math.abs(i - index) <= (standby ? 0 : RENDER_RADIUS);
          return (
            <div key={item.key} style={cellStyle(width, height)}>
              <div
                ref={i === index ? zoomRef : undefined}
                style={zoomWrapperStyle(width, height, i === index && pageFit === 'fit-width' && contentOverflows)}>
                {near ? (
                  <ReaderPage
                    fadeMs={standby ? STANDBY_FADE_MS : undefined}
                    uri={item.uri}
                    page={item.pageNumber}
                    fit={pageFit === 'fit-width' ? 'width' : 'contain'}
                    width={width}
                    height={height}
                    onLoadDims={(w, h) => recordDims(item.key, w, h)}
                    onFailedChange={i === index ? setCurrentFailed : undefined}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function surfaceStyle(width: number, height: number): React.CSSProperties {
  return {
    position: 'relative',
    width,
    height,
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    // Pure black, matching the app's own background and native's `READER_BACKDROP`.
    backgroundColor: '#000000',
  };
}
function trackStyle(n: number, width: number, height: number): React.CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    height,
    width: n * width,
    display: 'flex',
    flexDirection: 'row',
    willChange: 'transform',
  };
}
function cellStyle(width: number, height: number): React.CSSProperties {
  return { width, height, overflow: 'hidden', flexShrink: 0 };
}
function zoomWrapperStyle(width: number, height: number, tall: boolean): React.CSSProperties {
  // `tall`: an overflowing fit-width page — drop the fixed height so the
  // child's own aspectRatio box can be taller than the viewport; the ancestor
  // `cellStyle`'s `overflow:hidden` still clips it, and content-pan's
  // `translateY` (written via `writeZoom`) shifts which part is visible.
  // Pinch never runs while this is true (mutually exclusive, see
  // `contentOverflowsRef` usage above), so `transformOrigin` is moot here.
  return tall
    ? { width, willChange: 'transform' }
    : { width, height, transformOrigin: 'center center', willChange: 'transform' };
}
