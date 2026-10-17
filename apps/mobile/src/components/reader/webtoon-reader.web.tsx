import { forwardRef, useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react';

import {
  isDesktopPointer,
  keepZoomLevel,
  keptZoomLevel,
  registerZoomTarget,
  showZoomToast,
  WEBTOON_MIN_LEVEL,
  wheelZoomFactor,
  zoomLevel$,
} from '@/components/reader/desktop-zoom';
import { freePanReach } from '@/components/reader/page-geometry';
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
import { webtoonFit } from '@/components/reader/settings-panel';
import type { PageFit } from '@/hooks/use-reader-settings';
import { createKeyHold, isTypingTarget, keyDirection } from '@/lib/key-hold';

export type WebtoonReaderHandle = { goToPage: (index: number) => void };

type Props = {
  /** Item shape shared with native (see paged-reader's ReaderPageItem). Web is never stitched, so
   *  this is always one chapter's worth — but the shape is common so the pane has one thing to
   *  pass. */
  pages: ReaderPageItem[];
  width: number;
  /** Viewport height — only used by the `'fit-page'` paginated variant, to
   *  size each row to exactly one screen. */
  height: number;
  pageFit: PageFit;
  /** Whether a double-tap magnifies. Off, a click toggles chrome at once instead of waiting out a
   *  second one. */
  doubleTapZoom: boolean;
  initialPage: number;
  onPageChange: (index: number) => void;
  onToggleChrome: () => void;
  /** See the native variant: the series page's strip cross-fades its standing page in. */
  standby?: boolean;
};

/**
 * Vertical continuous (webtoon) reader — WEB ONLY (`.web.tsx`; native keeps the
 * FlatList variant in `webtoon-reader.tsx`).
 *
 * Like the paged web reader, the browser's native pinch-zoom fights this on iOS
 * WebKit, so we own the pinch ourselves. But unlike the pager we KEEP the
 * browser's native scroll for everything else:
 *   - `touch-action: pan-y` lets one finger scroll natively AND disables the
 *     browser's pinch-zoom (the `pan-*` family excludes pinch).
 *   - A custom 2-finger pinch scales the content via the `zoom` property, which
 *     grows the element's layout (and therefore the scroll range), so the native
 *     scroll keeps working on the enlarged strip. When zoomed we switch to
 *     `touch-action: pan-x pan-y` + `overflow-x: auto` so one finger pans both
 *     axes natively. The pinch anchors on the focal point via scrollLeft/Top.
 * Chrome (toolbar / pill / settings) are siblings on the series page, outside this
 * scroller, so zooming never moves them.
 *
 * Pages load lazily by viewport proximity (IntersectionObserver) so only a few
 * full-res images are ever in memory — every slot still renders (with an
 * estimated height) to keep scroll offsets and `goToPage` stable.
 *
 * `pageFit === 'fit-page'` switches to a paginated mode instead: each slot is
 * fixed to exactly one viewport height (`scroll-snap-align: start` + the
 * scroller's `scroll-snap-type: y mandatory`), so native scroll snaps one
 * page at a time — the browser's own scroll-snap does the "paging," no custom
 * JS needed. The custom pinch is skipped in this mode (its CSS-`zoom`-based
 * scaling would fight fixed-size snap slots); IntersectionObserver lazy
 * loading, `goToPage`, and the entry-page correction below are unaffected.
 */

// Comics are taller than wide; matches ReaderPage's DEFAULT_ASPECT (2/3 w:h),
// so an unloaded slot reserves ≈ 1.5 × width of height as a starting guess —
// refined at runtime by `aspectRef` below as real pages load.
const ESTIMATED_ASPECT = 3 / 2;
// Keep images mounted within this many viewport-heights of the visible area.
const PRELOAD_VIEWPORTS = 1.5;
// A mouse drag of the strip: how far the button moves before it is a drag rather than a click, the
// glide's per-16ms decay after release, and the speed (px/ms) it stops at.
const DRAG_SLOP = 5;
const DRAG_FRICTION = 0.94;
const DRAG_MIN_V = 0.02;

function seedWindow(center: number, n: number): Set<number> {
  const s = new Set<number>();
  for (let i = Math.max(0, center - 2); i <= Math.min(n - 1, center + 2); i++) s.add(i);
  return s;
}

function rel(touch: Touch, rect: DOMRect): Point {
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

// On a mouse+keyboard session (`isDesktopPointer`), `fit-page`'s CSS scroll-snap
// exists so a touch swipe pages one screen at a time via the browser's own
// gesture handling, with no custom JS. On desktop that same mandatory snap
// fights direct `scrollTop` writes — a released Up/Down hold-scroll was
// observed snapping straight to the nearest page, which isn't something a
// keyboard/mouse user has an equivalent "swipe" gesture for and shouldn't
// happen — so it's skipped entirely there in favor of free scroll plus the
// explicit instant jump `goToPage` already does for Left/Right/A/D.

export const WebtoonReader = forwardRef<WebtoonReaderHandle, Props>(function WebtoonReader(
  { pages, width, height, pageFit, doubleTapZoom, initialPage, onPageChange, onToggleChrome, standby },
  ref,
) {
  const n = pages.length;
  const paged = webtoonFit(pageFit) === 'fit-page';
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<(HTMLDivElement | null)[]>([]);

  // Which slots currently mount a real image (lazy; viewport-driven).
  const [loaded, setLoaded] = useState<Set<number>>(() => seedWindow(initialPage, n));

  // Running estimate (height/width) for slots that haven't loaded a real image
  // yet, refined from every slot that does. `bump` forces a re-render when it
  // changes enough to matter, so still-unloaded slots pick up the new guess.
  const aspectRef = useRef(ESTIMATED_ASPECT);
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const onSlotLoadDims = useCallback((w: number, h: number) => {
    if (w <= 0) return;
    const prev = aspectRef.current;
    const next = prev * 0.8 + (h / w) * 0.2;
    aspectRef.current = next;
    if (Math.abs(next - prev) / prev > 0.03) bump();
  }, []);

  // True once the user has touched/wheeled the scroller — after that, the
  // entry-page correction passes below back off instead of fighting a scroll
  // the user is already mid-way through.
  const userScrolledRef = useRef(false);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const mark = () => {
      userScrolledRef.current = true;
    };
    el.addEventListener('wheel', mark, { passive: true });
    el.addEventListener('touchstart', mark, { passive: true });
    return () => {
      el.removeEventListener('wheel', mark);
      el.removeEventListener('touchstart', mark);
    };
  }, []);

  // Live zoom, kept in a ref so pinch frames don't re-render.
  const zoom = useRef(1);
  const pinch = useRef({
    active: false,
    startDist: 0,
    z0: 1,
    cpX: 0,
    cpY: 0,
    // Latest finger positions, applied once per frame (see onMove).
    latest: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
  });

  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  // Where the strip's left edge sits in the scrolled content, in screen pixels. Below 1× (the
  // desktop zoom's way of narrowing a window-wide strip) it is centred in the room it leaves. Above
  // it, under a mouse, the strip gets room either side — up to half the window — so either edge of
  // it can be scrolled to the middle, as a zoomed page can (see `freePanLimits`).
  const marginAt = useCallback((z: number) => {
    const w = scrollerRef.current?.clientWidth ?? 0;
    if (z < 1) return (w * (1 - z)) / 2;
    // Not below ZOOM_EPSILON, where the strip can't be scrolled sideways and would just sit off-centre.
    return z > ZOOM_EPSILON && isDesktopPointer() ? (w / 2) * freePanReach(z) : 0;
  }, []);
  const standbyRef = useRef(standby);
  useEffect(() => {
    standbyRef.current = standby;
  }, [standby]);
  const applyZoom = useCallback(
    (z: number) => {
      const content = contentRef.current;
      if (!content) return;
      content.style.setProperty('zoom', String(z));
      const m = marginAt(z) / z;
      content.style.marginLeft = z < 1 ? `${m}px` : '0px';
      // Padding, not margin: the scroll range has to grow by it on BOTH sides, and an end margin
      // doesn't count toward a scroller's overflow. The width is pinned in the content's own zoomed
      // pixels so the box is as wide as the pictures it holds — `100%` resolves to the window's
      // width AFTER zoom, leaving the pictures to overflow it and the right padding inside them.
      content.style.paddingLeft = content.style.paddingRight = z > 1 ? `${m}px` : '0px';
      content.style.width = z > 1 ? `${scrollerRef.current?.clientWidth ?? 0}px` : '100%';
      if (!standbyRef.current) zoomLevel$.set(z);
    },
    [marginAt],
  );

  // Zoom to `target` keeping the content point under the viewport point (fx, fy) in place — the
  // double-tap, the wheel and the stepper all land here (the touch pinch keeps its own frame loop).
  const zoomAt = (target: number, fx: number, fy: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const z0 = zoom.current;
    const z = clamp(target, WEBTOON_MIN_LEVEL, MAX_SCALE);
    const cpX = (el.scrollLeft + fx - marginAt(z0)) / z0;
    const cpY = (el.scrollTop + fy) / z0;
    zoom.current = z;
    applyZoom(z);
    const magnified = z > ZOOM_EPSILON;
    el.style.overflowX = magnified ? 'auto' : 'hidden';
    el.style.touchAction = magnified ? 'pan-x pan-y' : 'pan-y';
    el.scrollLeft = magnified ? clamp(cpX * z + marginAt(z) - fx, 0, Math.max(0, el.scrollWidth - el.clientWidth)) : 0;
    el.scrollTop = clamp(cpY * z - fy, 0, Math.max(0, el.scrollHeight - el.clientHeight));
  };

  // Double-tap tracking: a click is deferred by DOUBLE_TAP_MS so a second click
  // can turn it into a zoom instead of a chrome toggle.
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const pendingTapRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double-tap toggles between 1× and a fixed zoom, anchored on the tap point via
  // scrollLeft/Top (same model the pinch uses). Skipped in fit-page mode, where
  // CSS-`zoom` would fight the scroll-snap slots (the pinch is skipped there too).
  const doubleTapZoomTo = useCallback(
    (clientX: number, clientY: number) => {
      const el = scrollerRef.current;
      if (!el || paged) return;
      const rect = el.getBoundingClientRect();
      const fx = clientX - rect.left;
      const fy = clientY - rect.top;
      // Anywhere but 1× goes back to it — keeping the vertical reading position, and putting down
      // any level the desktop zoom was keeping.
      if (zoom.current > ZOOM_EPSILON || zoom.current < 1 / ZOOM_EPSILON) {
        keepZoomLevel(1);
        zoomAt(1, fx, 0);
      } else {
        zoomAt(DOUBLE_TAP_SCALE, fx, fy);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paged],
  );

  // Click handler: a lone click toggles chrome after DOUBLE_TAP_MS; a qualifying
  // second click cancels that and zooms. In fit-page mode there's no custom zoom,
  // and with the double-tap switched off there's nothing to wait for, so the
  // click toggles chrome immediately.
  const onSurfaceClick = useCallback(
    (e: React.MouseEvent) => {
      if (paged || !doubleTapZoom) {
        onToggleChrome();
        return;
      }
      const x = e.clientX;
      const y = e.clientY;
      const now = performance.now();
      const last = lastTapRef.current;
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_DIST) {
        if (pendingTapRef.current != null) {
          clearTimeout(pendingTapRef.current);
          pendingTapRef.current = null;
        }
        lastTapRef.current = null;
        doubleTapZoomTo(x, y);
        return;
      }
      lastTapRef.current = { t: now, x, y };
      if (pendingTapRef.current != null) clearTimeout(pendingTapRef.current);
      pendingTapRef.current = setTimeout(() => {
        pendingTapRef.current = null;
        lastTapRef.current = null;
        onToggleChrome();
      }, DOUBLE_TAP_MS);
    },
    [paged, doubleTapZoom, onToggleChrome, doubleTapZoomTo],
  );

  useEffect(() => {
    return () => {
      if (pendingTapRef.current != null) clearTimeout(pendingTapRef.current);
    };
  }, []);

  // Report the page that owns the top half of the viewport. Re-runs on every
  // scroll frame while a hold-scroll is in flight (see `onScroll` below), so
  // it has to stay cheap: the old version rescanned from slot 0 every time,
  // calling `getBoundingClientRect` on every slot up to the current one —
  // fine near the start of a chapter but increasingly expensive (and janky
  // to hold-scroll through) the deeper into it you are, since the scan grows
  // with your position. `lastCurrentRef` lets it pick up from where it left
  // off instead of restarting each time.
  const lastCurrentRef = useRef(initialPage);
  const updateCurrent = useCallback(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const slots = slotsRef.current;
    const count = slots.length;
    if (count === 0) return;
    if (paged && height > 0) {
      // Fixed-height slots in this mode — direct arithmetic, no DOM reads.
      const idx = clamp(Math.floor((root.scrollTop + root.clientHeight * 0.5) / height), 0, count - 1);
      lastCurrentRef.current = idx;
      onPageChangeRef.current(idx);
      return;
    }
    const rootTop = root.getBoundingClientRect().top;
    const half = root.clientHeight * 0.5;
    const topOf = (i: number) => {
      const el = slots[i];
      return el ? el.getBoundingClientRect().top - rootTop : null;
    };
    let i = clamp(lastCurrentRef.current, 0, count - 1);
    // Scrolled up: walk back while the current slot hasn't reached halfway yet.
    while (i > 0 && (topOf(i) ?? 0) > half) i--;
    // Scrolled down: walk forward while the next slot has already passed halfway.
    while (i < count - 1 && (topOf(i + 1) ?? half + 1) <= half) i++;
    lastCurrentRef.current = i;
    onPageChangeRef.current(i);
  }, [paged, height]);

  const ticking = useRef(false);
  const onScroll = useCallback(() => {
    // Ignore the scrollTop/scrollLeft writes a pinch makes to anchor its focal
    // point — otherwise the reported page thrashes while zooming.
    if (pinch.current.active || ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      if (!pinch.current.active) updateCurrent();
    });
  }, [updateCurrent]);

  // Lazy-load images near the viewport; unmount far ones to bound memory.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const margin = Math.round((root.clientHeight || window.innerHeight) * PRELOAD_VIEWPORTS);
    const io = new IntersectionObserver(
      (entries) => {
        // Don't touch the mounted set mid-pinch: scaling moves every slot's box,
        // which re-fires this observer, and mounting/unmounting images while
        // zooming is what made the screen flash black and stutter.
        if (pinch.current.active) return;
        setLoaded((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const e of entries) {
            const idx = Number((e.target as HTMLElement).dataset.index);
            if (e.isIntersecting && !next.has(idx)) {
              next.add(idx);
              changed = true;
            } else if (!e.isIntersecting && next.has(idx)) {
              next.delete(idx);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: `${margin}px 0px`, threshold: 0.01 },
    );
    slotsRef.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [n]);

  // Custom 2-finger pinch via non-passive listeners (React's onTouch* are passive
  // and can't preventDefault). One finger is left to the browser's native scroll.
  // Skipped entirely in fit-page mode — its CSS-`zoom`-based scaling would
  // fight the fixed-size scroll-snap slots that mode relies on.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || paged) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      const rect = el.getBoundingClientRect();
      const a = rel(e.touches[0], rect);
      const b = rel(e.touches[1], rect);
      const f = midpoint(a, b);
      const z0 = zoom.current;
      pinch.current = {
        active: true,
        startDist: distance(a, b) || 1,
        z0,
        // The content-space point currently under the focal (stays put as we zoom).
        cpX: (el.scrollLeft + f.x - marginAt(z0)) / z0,
        cpY: (el.scrollTop + f.y) / z0,
        latest: { a, b },
      };
      el.style.overflowX = 'auto'; // allow horizontal scroll while we anchor the focal
    };

    // Apply the latest pinch frame. `zoom` triggers a layout, so coalesce many
    // touchmoves into a single write per animation frame.
    let rafPending = false;
    const applyFrame = () => {
      rafPending = false;
      if (!pinch.current.active) return;
      const { a, b } = pinch.current.latest;
      const f = midpoint(a, b);
      const z = clamp(pinch.current.z0 * (distance(a, b) / pinch.current.startDist), 1, MAX_SCALE);
      zoom.current = z;
      applyZoom(z);
      el.scrollLeft = clamp(pinch.current.cpX * z + marginAt(z) - f.x, 0, Math.max(0, el.scrollWidth - el.clientWidth));
      el.scrollTop = clamp(pinch.current.cpY * z - f.y, 0, Math.max(0, el.scrollHeight - el.clientHeight));
    };

    const onMove = (e: TouchEvent) => {
      if (!pinch.current.active || e.touches.length < 2) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      pinch.current.latest = { a: rel(e.touches[0], rect), b: rel(e.touches[1], rect) };
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(applyFrame);
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!pinch.current.active || e.touches.length >= 2) return;
      pinch.current.active = false;
      if (zoom.current <= ZOOM_EPSILON) {
        // Snap back to 1×, keeping the vertical reading position (content shrinks).
        const prevTop = el.scrollTop;
        const z = zoom.current;
        zoom.current = 1;
        applyZoom(1);
        el.style.overflowX = 'hidden';
        el.style.touchAction = 'pan-y';
        el.scrollLeft = 0;
        el.scrollTop = z > 0 ? prevTop / z : prevTop;
      } else {
        // Stay zoomed: let one finger pan both axes natively.
        el.style.overflowX = 'auto';
        el.style.touchAction = 'pan-x pan-y';
      }
    };

    // iOS WebKit pinches the whole PAGE (visual viewport) on a 2-finger gesture, and
    // `touch-action: pan-y` alone doesn't stop it — the reliable lever is preventing
    // the Safari-only `gesture*` events (same fix the paged reader uses). Without
    // this the custom CSS-`zoom` pinch never got a look-in on iOS: the browser's own
    // page-zoom swallowed the gesture. One finger (plain scroll) never fires these.
    const preventGesture = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('gesturestart', preventGesture as EventListener, { passive: false });
    el.addEventListener('gesturechange', preventGesture as EventListener, { passive: false });
    el.addEventListener('gestureend', preventGesture as EventListener, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', preventGesture as EventListener);
      el.removeEventListener('gesturechange', preventGesture as EventListener);
      el.removeEventListener('gestureend', preventGesture as EventListener);
    };
  }, [paged, applyZoom, marginAt]);

  // The desktop zoom (see desktop-zoom): Ctrl/⌘+wheel — or a trackpad pinch, which arrives as one
  // (Safari's as a gesture event) — about the pointer, claimed so the browser doesn't zoom the whole
  // app; the stepper and +/-/0 keys about the middle. Whatever level it leaves is kept, and a strip
  // mounting (the next chapter) picks it up. A plain wheel stays the browser's own scroll.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || standby) return;
    // Fit-page mode doesn't zoom (its slots are the screen), so a strip switched into it lets go.
    if (paged) {
      if (zoom.current !== 1) zoomAt(1, 0, 0);
      return;
    }
    const kept = keptZoomLevel();
    if (kept !== 1 && zoom.current === 1) zoomAt(kept, el.clientWidth / 2, 0);
    // Re-applied for a resize, which re-centres a narrowed strip, and to report the level.
    else applyZoom(zoom.current);
    const zoomAtClient = (target: number, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      zoomAt(target, clientX - rect.left, clientY - rect.top);
      keepZoomLevel(zoom.current);
      showZoomToast(zoom.current);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAtClient(zoom.current * wheelZoomFactor(e, height), e.clientX, e.clientY);
    };
    let gestureFrom = 1;
    const onGestureStart = () => {
      gestureFrom = zoom.current;
    };
    const onGestureChange = (e: Event) => {
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomAtClient(gestureFrom * g.scale, g.clientX, g.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const desktop = isDesktopPointer();
    if (desktop) {
      el.addEventListener('gesturestart', onGestureStart);
      el.addEventListener('gesturechange', onGestureChange);
    }
    const unregister = registerZoomTarget({
      zoomTo(level) {
        zoomAt(level, el.clientWidth / 2, el.clientHeight / 2);
        keepZoomLevel(zoom.current);
      },
      reset() {
        keepZoomLevel(1);
        zoomAt(1, el.clientWidth / 2, el.clientHeight / 2);
      },
    });
    return () => {
      unregister();
      el.removeEventListener('wheel', onWheel);
      if (desktop) {
        el.removeEventListener('gesturestart', onGestureStart);
        el.removeEventListener('gesturechange', onGestureChange);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged, standby, width, height]);

  // Smooth continuous scroll while an arrow or WASD is held (see lib/key-hold) — this div
  // isn't natively keyboard-scrollable. Only on a desktop (mouse+keyboard) session — see
  // `isDesktopPointer` for why `fit-page`'s CSS scroll-snap is skipped there entirely, which is what
  // makes direct `scrollTop` writes work here in the first place. Claimed in the capture phase, so
  // the app-wide W/S scroll (lib/keyboard-scroll) doesn't scroll the strip a second time; a strip
  // parked behind the details leaves the keys to the details.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || standby || !isDesktopPointer()) return;
    const hold = createKeyHold((dx, dy) => {
      if (pinch.current.active) return;
      el.scrollLeft = clamp(el.scrollLeft + dx, 0, el.scrollWidth - el.clientWidth);
      el.scrollTop = clamp(el.scrollTop + dy, 0, el.scrollHeight - el.clientHeight);
      if (dy !== 0) userScrolledRef.current = true;
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      const dir = keyDirection(e.key);
      // Sideways only pans a strip zoomed wider than the screen; otherwise it's the screen's page turn.
      if (!dir || (dir.x !== 0 && el.scrollWidth <= el.clientWidth + 1)) return;
      e.preventDefault();
      e.stopPropagation();
      hold.press(e.key, dir);
    };
    const onKeyUp = (e: KeyboardEvent) => hold.release(e.key);
    const onBlur = () => hold.clear();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      hold.dispose();
    };
  }, [standby]);

  // A mouse drags the strip, both axes, with a glide on release — the hand's own scroll, which a
  // strip zoomed wider than the window otherwise only has as Shift+wheel. The press is kept from the
  // series screen's collapse pan, which would read the sideways part of any drag as a dismiss. A drag
  // swallows the click that ends it, or letting go would toggle the chrome.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || standby || !isDesktopPointer()) return;
    type Drag = { id: number; x: number; y: number; left: number; top: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number; moved: boolean };
    let drag: Drag | null = null;
    let glide: number | null = null;
    let swallowClick = false;
    const stopGlide = () => {
      if (glide != null) cancelAnimationFrame(glide);
      glide = null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      e.stopPropagation();
      stopGlide();
      swallowClick = false;
      const now = performance.now();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, lastX: e.clientX, lastY: e.clientY, lastT: now, vx: 0, vy: 0, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id || pinch.current.active) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        drag.moved = true;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
      }
      el.scrollLeft = drag.left - dx;
      el.scrollTop = drag.top - dy;
      userScrolledRef.current = true;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastT);
      drag.vx = (e.clientX - drag.lastX) / dt;
      drag.vy = (e.clientY - drag.lastY) / dt;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.lastT = now;
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      swallowClick = true;
      el.style.cursor = '';
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      // A drag that stopped before letting go doesn't coast.
      if (performance.now() - d.lastT > 50) return;
      let { vx, vy } = d;
      let last = performance.now();
      const step = () => {
        const now = performance.now();
        const dt = Math.min(32, now - last);
        last = now;
        el.scrollLeft -= vx * dt;
        el.scrollTop -= vy * dt;
        const decay = Math.pow(DRAG_FRICTION, dt / 16);
        vx *= decay;
        vy *= decay;
        glide = Math.abs(vx) > DRAG_MIN_V || Math.abs(vy) > DRAG_MIN_V ? requestAnimationFrame(step) : null;
      };
      glide = requestAnimationFrame(step);
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    };
    const noDrag = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    el.addEventListener('dragstart', noDrag);
    el.addEventListener('wheel', stopGlide, { passive: true });
    return () => {
      stopGlide();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dragstart', noDrag);
      el.removeEventListener('wheel', stopGlide);
    };
  }, [standby]);

  // Jump to the entry page once mounted, then correct twice more shortly after:
  // the first jump only has the generic estimate to go on for most slots (real
  // heights are unknown until each image loads), so as the seeded window around
  // the target loads and refines `aspectRef`, re-running scrollIntoView tightens
  // the landing spot instead of leaving it wherever the initial guess put it.
  // Skipped once the user starts scrolling on their own.
  //
  // Reacts to `initialPage` changing (not just mount): the screen's own
  // `currentPage` briefly starts at 0 before its pages-loaded effect corrects
  // it to the real requested start index, and this component can mount in
  // that window (gated behind `!pages`) — so the very first `initialPage` it
  // sees may already be stale. `lastTargetRef` de-dupes so this only re-runs
  // for an actual change (that one correction, or an imperative `goToPage`'s
  // own prop echo), not on every ordinary scroll-driven update.
  const lastTargetRef = useRef<number | null>(null);
  useEffect(() => {
    if (initialPage === lastTargetRef.current) return;
    lastTargetRef.current = initialPage;
    if (initialPage <= 0) return;
    const target = Math.min(n - 1, initialPage);
    const jump = () => {
      if (!userScrolledRef.current) slotsRef.current[target]?.scrollIntoView({ block: 'start' });
    };
    const id = requestAnimationFrame(jump);
    const t1 = setTimeout(jump, 250);
    const t2 = setTimeout(jump, 800);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [initialPage, n]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(index: number) {
        const clamped = Math.max(0, Math.min(n - 1, index));
        setLoaded((prev) => {
          const next = new Set(prev);
          for (let i = clamped - 2; i <= clamped + 2; i++) if (i >= 0 && i < n) next.add(i);
          return next;
        });
        // Left/Right/A/D jump straight to the target page — a direct `scrollTop`
        // write, not `scrollIntoView`, so nothing can animate it (no ambient
        // `scroll-behavior: smooth`, no scroll-snap easing on the transition).
        requestAnimationFrame(() => {
          const el = scrollerRef.current;
          const target = slotsRef.current[clamped];
          // Measured on screen rather than by offsetTop, which a zoomed strip doesn't scale.
          if (el && target) el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top;
        });
      },
    }),
    [n],
  );

  // See `isDesktopPointer` — CSS scroll-snap only applies on touch sessions.
  const snapEnabled = paged && !isDesktopPointer();

  return (
    <div ref={scrollerRef} onScroll={onScroll} onClick={onSurfaceClick} style={scrollerStyle(paged, snapEnabled)}>
      <div ref={contentRef} style={contentStyle}>
        {pages.map((item, i) => {
          const isLoaded = loaded.has(i);
          const slotStyle = paged
            ? pagedSlotStyle(height)
            : isLoaded
              ? loadedSlotStyle
              : { width: '100%', height: width * aspectRef.current };
          return (
            <div
              key={item.key}
              data-index={i}
              ref={(el) => {
                slotsRef.current[i] = el;
              }}
              style={slotStyle}
            >
              {isLoaded ? (
                <ReaderPage
                  fadeMs={standby ? STANDBY_FADE_MS : undefined}
                  uri={item.uri}
                  page={item.pageNumber}
                  fit={paged ? 'contain' : 'width'}
                  width={width}
                  height={paged ? height : undefined}
                  onLoadDims={paged ? undefined : onSlotLoadDims}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function scrollerStyle(paged: boolean, snapEnabled: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    touchAction: 'pan-y',
    userSelect: 'none',
    WebkitOverflowScrolling: 'touch',
    scrollSnapType: snapEnabled ? 'y mandatory' : undefined,
    // Pure black, matching the app's own background and native's `READER_BACKDROP`.
    backgroundColor: '#000000',
  };
}
function pagedSlotStyle(height: number): React.CSSProperties {
  return { width: '100%', height, scrollSnapAlign: 'start' };
}
const contentStyle: React.CSSProperties = { width: '100%', boxSizing: 'content-box' };
const loadedSlotStyle: React.CSSProperties = { width: '100%' };
