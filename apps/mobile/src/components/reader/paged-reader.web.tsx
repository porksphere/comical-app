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

import type { ReaderPageItem } from '@/components/reader/paged-reader';
import { ReaderPage } from '@/components/reader/reader-page';
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

export type PagedReaderHandle = { goToPage: (logical: number, animated?: boolean) => void };

type Props = {
  /** Per-chapter on web (reader.tsx doesn't stitch here): this pager hands a
   *  swipe past the last/first page to onNext/onPrev (see finalizeSwipe), so
   *  chapter transitions stay route-level. Item shape shared with native. */
  pages: ReaderPageItem[];
  width: number;
  height: number;
  rtl: boolean;
  pageFit: PageFit;
  initialPage: number;
  onPageChange: (logical: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleChrome: () => void;
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
 * toolbar / progress pill / settings (siblings in reader.tsx) never move.
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
  { pages, width, height, rtl, pageFit, initialPage, onPageChange, onPrev, onNext, onToggleChrome },
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

  // fit-width content that's taller than the viewport: a one-finger vertical
  // drag scrolls it (see the 'content-pan' mode below). Only meaningful for the
  // current page — `contentAspectRef` is only updated by that page's own
  // `onLoadDims`. Reset on page change so a stale "overflows" from the
  // previous page never lingers before the new one reports its own real dims.
  const contentAspectRef = useRef(1); // loaded image's width/height ratio
  const [contentOverflows, setContentOverflows] = useState(false);
  const contentOverflowsRef = useRef(false);
  contentOverflowsRef.current = contentOverflows;
  useEffect(() => setContentOverflows(false), [index]);
  const onLoadDims = useCallback(
    (w: number, h: number) => {
      if (w <= 0) return;
      contentAspectRef.current = w / h;
      const contentHeight = width * (h / w);
      setContentOverflows(contentHeight > height + 1);
    },
    [width, height],
  );

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

  const resetZoom = useCallback(
    (animate: boolean) => {
      cancelInertia();
      zoom.current = { scale: 1, tx: 0, ty: 0 };
      writeZoom(animate);
      if (zoomedRef.current) {
        zoomedRef.current = false;
        setZoomed(false);
      }
    },
    [cancelInertia, writeZoom, zoom],
  );

  // Momentum after a pan release: keep gliding from the last pan velocity,
  // decelerating each frame and stopping dead at the pan bounds. Grabbing again
  // (onPointerDown → cancelInertia) halts it immediately.
  const startPanInertia = useCallback(() => {
    cancelInertia();
    const s = zoom.current.scale;
    if (s <= 1) return;
    const limitX = ((s - 1) * width) / 2;
    const limitY = ((s - 1) * height) / 2;
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

  // Double-tap toggles between fit-to-screen and a fixed zoom centred on the tap
  // point (clamped into bounds). Unavailable when pinch is (fit-width overflow),
  // matching the native reader.
  const doubleTapZoom = useCallback(
    (x: number, y: number) => {
      cancelInertia();
      if (zoomedRef.current) {
        resetZoom(true);
        return;
      }
      const cx = width / 2;
      const cy = height / 2;
      const limitX = ((DOUBLE_TAP_SCALE - 1) * width) / 2;
      const limitY = ((DOUBLE_TAP_SCALE - 1) * height) / 2;
      // Keep the tapped point under the finger: tx = (p − centre)(1 − scale).
      const tx = clamp((x - cx) * (1 - DOUBLE_TAP_SCALE), -limitX, limitX);
      const ty = clamp((y - cy) * (1 - DOUBLE_TAP_SCALE), -limitY, limitY);
      zoom.current = { scale: DOUBLE_TAP_SCALE, tx, ty };
      writeZoom(true);
      zoomedRef.current = true;
      setZoomed(true);
    },
    [cancelInertia, resetZoom, width, height, writeZoom, zoom],
  );

  // Commit to a page. `animate` slides (swipe settle / pill jump); otherwise the
  // turn is instant (taps), per "don't animate the turn when tapping".
  const settleTo = useCallback(
    (nextIndex: number, animate: boolean) => {
      const clamped = clampIndex(nextIndex);
      const changed = clamped !== indexRef.current;
      indexRef.current = clamped;
      if (changed) {
        resetZoom(false); // leaving a page drops its zoom, like the native reader
        setIndex(clamped);
        onPageChange(toLogical(clamped));
      }
      writeTrack(0, animate);
    },
    [clampIndex, resetZoom, onPageChange, toLogical, writeTrack],
  );

  useImperativeHandle(
    ref,
    () => ({
      goToPage(logical: number, animated = true) {
        settleTo(toPhysical(clampIndex(logical)), animated);
      },
    }),
    [settleTo, toPhysical, clampIndex],
  );

  // `initialPage` only seeds `index`'s initial state (read once, at mount) —
  // but reader.tsx's own `currentPage` briefly starts at 0 before its
  // pages-loaded effect corrects it to the real requested start index (see
  // reader.tsx's `startIndex` effect), and this component mounts in that same
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
    [gesture, zoom],
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
        const nextScale = clamp(gesture.baseScale * factor, 1, MAX_SCALE);
        if (nextScale > gesture.pinchMaxScale) gesture.pinchMaxScale = nextScale;
        const anchorX = (gesture.focalStartX - cx - gesture.basePinchTx) / gesture.baseScale;
        const anchorY = (gesture.focalStartY - cy - gesture.basePinchTy) / gesture.baseScale;
        const limitX = ((nextScale - 1) * width) / 2;
        const limitY = ((nextScale - 1) * height) / 2;
        zoom.current = {
          scale: nextScale,
          tx: clamp(mid.x - cx - nextScale * anchorX, -limitX, limitX),
          ty: clamp(mid.y - cy - nextScale * anchorY, -limitY, limitY),
        };
        writeZoom(false);
        return;
      }

      if (gesture.mode === 'pan') {
        const s = zoom.current.scale;
        const limitX = ((s - 1) * width) / 2;
        const limitY = ((s - 1) * height) / 2;
        zoom.current = {
          scale: s,
          tx: clamp(gesture.panBaseTx + (p.x - gesture.panStartX), -limitX, limitX),
          ty: clamp(gesture.panBaseTy + (p.y - gesture.panStartY), -limitY, limitY),
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
      if (!zoomedRef.current) {
        zoomedRef.current = true;
        setZoomed(true);
      }
      return;
    }
    // Ended at ~1×. A deliberate zoom-in whose LAST frame dipped on lift (fingers
    // converging as they leave the glass) would rubber-band to 1× here — so if the
    // pinch STARTED from ~1× and actually reached a real zoom (pinchMaxScale), commit
    // at that peak instead. A pinch that started already-zoomed (a deliberate pinch
    // back down) still honours the return to 1×.
    if (gesture.baseScale <= ZOOM_EPSILON && gesture.pinchMaxScale > PINCH_COMMIT) {
      const target = clamp(gesture.pinchMaxScale, 1, MAX_SCALE);
      const limitX = ((target - 1) * width) / 2;
      const limitY = ((target - 1) * height) / 2;
      zoom.current = {
        scale: target,
        tx: clamp(zoom.current.tx, -limitX, limitX),
        ty: clamp(zoom.current.ty, -limitY, limitY),
      };
      writeZoom(true);
      zoomedRef.current = true;
      setZoomed(true);
      return;
    }
    resetZoom(true);
  }, [resetZoom, zoom, gesture, width, height, writeZoom]);

  const handleTap = useCallback(
    (x: number) => {
      if (zoomedRef.current) return; // no tap zones while zoomed (mirrors native)
      if (x < width * 0.3) {
        // Nothing left physically to the left: hand off to the reader for chapter
        // navigation instead of a silent clamp. WHICH chapter depends on direction —
        // `data` is pre-reversed for RTL, so physical 0 is the last page in reading
        // order there (and the first in LTR).
        if (indexRef.current <= 0) (rtl ? onNext : onPrev)?.();
        else settleTo(indexRef.current - 1, false);
      } else if (x > width * 0.7) {
        // Mirror image: physical n-1 is the last page in reading order in LTR, the
        // FIRST one in RTL — so the end of the track means auto-advance one way and
        // previous-chapter the other.
        if (indexRef.current >= n - 1) (rtl ? onPrev : onNext)?.();
        else settleTo(indexRef.current + 1, false);
      } else onToggleChrome();
    },
    [onToggleChrome, onPrev, onNext, settleTo, width, n, rtl],
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
        else if (gesture.moved && gesture.momentumOk) startPanInertia();
      }
      gesture.mode = 'idle';
    },
    [beginPan, finalizePinch, finalizeSwipe, handleTapGesture, startPanInertia, gesture],
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
          const near = Math.abs(i - index) <= RENDER_RADIUS;
          return (
            <div key={item.key} style={cellStyle(width, height)}>
              <div
                ref={i === index ? zoomRef : undefined}
                style={zoomWrapperStyle(width, height, i === index && pageFit === 'fit-width' && contentOverflows)}>
                {near ? (
                  <ReaderPage
                    uri={item.uri}
                    page={item.pageNumber}
                    fit={pageFit === 'fit-width' ? 'width' : 'contain'}
                    width={width}
                    height={height}
                    onLoadDims={i === index ? onLoadDims : undefined}
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
    // Reference: `#reader-view { background: #0f0f0f }` — not pure black.
    backgroundColor: '#0f0f0f',
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
