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

import { ReaderPage } from '@/components/reader/reader-page';

export type PagedReaderHandle = { goToPage: (logical: number) => void };

type Props = {
  pages: string[];
  width: number;
  height: number;
  rtl: boolean;
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
 *   - swipe  (1 finger, not zoomed)  → track follows the finger, settles on release
 *   - tap    (1 finger, no movement) → instant page turn / chrome toggle, no animation
 *   - pinch  (2 fingers)             → scales only the current page; chrome stays put
 *   - pan    (1 finger, zoomed)      → moves the zoomed image within bounds
 *
 * Pages live in an absolutely-positioned flex row translated via a CSS
 * transform; zoom is a transform on the current page's inner wrapper, so the
 * toolbar / progress pill / settings (siblings in reader.tsx) never move.
 *
 * RTL: the data array is reversed and logical↔physical mapping keeps "next" =
 * reading order +1. Physical navigation is direction-agnostic (left tap zone =
 * physical −1, right = physical +1; dragging content left = physical +1); only
 * the reported page number goes back through `toLogical`.
 */

const MAX_SCALE = 4;
// Below this we treat the page as "not zoomed" and snap back to a clean 1×.
const ZOOM_EPSILON = 1.01;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type Point = { x: number; y: number };
function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

type Mode = 'idle' | 'swipe' | 'pan' | 'pinch';

export const PagedReader = forwardRef<PagedReaderHandle, Props>(function PagedReader(
  { pages, width, height, rtl, initialPage, onPageChange, onToggleChrome },
  ref,
) {
  const n = pages.length;
  const clampIndex = useCallback((i: number) => Math.max(0, Math.min(n - 1, i)), [n]);
  const toPhysical = useCallback((logical: number) => (rtl ? n - 1 - logical : logical), [rtl, n]);
  const toLogical = useCallback((physical: number) => (rtl ? n - 1 - physical : physical), [rtl, n]);
  const data = useMemo(() => (rtl ? [...pages].reverse() : pages), [pages, rtl]);

  const [index, setIndex] = useState(() => toPhysical(clampIndex(initialPage)));
  const [zoomed, setZoomed] = useState(false);

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
    // pan (zoomed)
    panStartX: 0,
    panStartY: 0,
    panBaseTx: 0,
    panBaseTy: 0,
    // pinch
    startDist: 0,
    focalStartX: 0,
    focalStartY: 0,
    baseScale: 1,
    basePinchTx: 0,
    basePinchTy: 0,
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

  const resetZoom = useCallback(
    (animate: boolean) => {
      zoom.current = { scale: 1, tx: 0, ty: 0 };
      writeZoom(animate);
      if (zoomedRef.current) {
        zoomedRef.current = false;
        setZoomed(false);
      }
    },
    [writeZoom, zoom],
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
      goToPage(logical: number) {
        settleTo(toPhysical(clampIndex(logical)), true);
      },
    }),
    [settleTo, toPhysical, clampIndex],
  );

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
    gesture.basePinchTx = zoom.current.tx;
    gesture.basePinchTy = zoom.current.ty;
    // We're zooming, not turning — drop any in-progress swipe offset.
    writeTrack(0, false);
  }, [firstTwo, gesture, writeTrack, zoom]);

  const beginPan = useCallback(
    (p: Point) => {
      gesture.mode = 'pan';
      gesture.panStartX = p.x;
      gesture.panStartY = p.y;
      gesture.panBaseTx = zoom.current.tx;
      gesture.panBaseTy = zoom.current.ty;
    },
    [gesture, zoom],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = posOf(e);
      gesture.pointers.set(e.pointerId, p);

      if (gesture.pointers.size >= 2) {
        beginPinch();
        return;
      }
      // First finger down: remember it for tap detection.
      gesture.downX = p.x;
      gesture.downY = p.y;
      gesture.downT = performance.now();
      gesture.moved = false;
      if (zoomedRef.current) {
        beginPan(p);
      } else {
        gesture.mode = 'swipe';
        gesture.startX = p.x;
        gesture.dx = 0;
        gesture.lastX = p.x;
        gesture.lastT = performance.now();
        gesture.velocity = 0;
      }
    },
    [beginPan, beginPinch, gesture, posOf],
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
        writeZoom(false);
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
    [firstTwo, gesture, height, n, posOf, width, writeTrack, writeZoom, zoom],
  );

  const finalizePinch = useCallback(() => {
    if (zoom.current.scale <= ZOOM_EPSILON) {
      resetZoom(true);
    } else if (!zoomedRef.current) {
      zoomedRef.current = true;
      setZoomed(true);
    }
  }, [resetZoom, zoom]);

  const handleTap = useCallback(
    (x: number) => {
      if (zoomedRef.current) return; // no tap zones while zoomed (mirrors native)
      if (x < width * 0.4) settleTo(indexRef.current - 1, false);
      else if (x > width * 0.6) settleTo(indexRef.current + 1, false);
      else onToggleChrome();
    },
    [onToggleChrome, settleTo, width],
  );

  const finalizeSwipe = useCallback(() => {
    const dur = performance.now() - gesture.downT;
    if (!gesture.moved && dur <= TAP_MAX_MS) {
      writeTrack(0, false); // undo any sub-threshold drift, then act as a tap
      handleTap(gesture.downX);
      return;
    }
    const passed =
      Math.abs(gesture.dx) > width * SWIPE_DISTANCE_RATIO || Math.abs(gesture.velocity) > SWIPE_VELOCITY;
    if (passed) {
      // Drag/fling left (dx < 0) advances one physical page; right goes back.
      const dir = gesture.dx !== 0 ? -Math.sign(gesture.dx) : -Math.sign(gesture.velocity);
      settleTo(indexRef.current + dir, true);
    } else {
      settleTo(indexRef.current, true); // spring back
    }
  }, [gesture, handleTap, settleTo, width, writeTrack]);

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
          // One finger left after a pinch: pan with it if still zoomed.
          const [p] = [...gesture.pointers.values()];
          if (zoomedRef.current) beginPan(p);
          else gesture.mode = 'idle';
        } else if (gesture.pointers.size === 0) {
          gesture.mode = 'idle';
        }
        return;
      }

      if (gesture.pointers.size > 0) return; // still mid-gesture

      if (wasMode === 'swipe') finalizeSwipe();
      gesture.mode = 'idle';
    },
    [beginPan, finalizePinch, finalizeSwipe, gesture],
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
        {data.map((uri, i) => (
          <div key={`${uri}:${i}`} style={cellStyle(width, height)}>
            <div ref={i === index ? zoomRef : undefined} style={zoomWrapperStyle(width, height)}>
              <ReaderPage uri={uri} page={toLogical(i) + 1} fit="contain" width={width} height={height} />
            </div>
          </div>
        ))}
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
    backgroundColor: '#000',
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
function zoomWrapperStyle(width: number, height: number): React.CSSProperties {
  return { width, height, transformOrigin: 'center center', willChange: 'transform' };
}
