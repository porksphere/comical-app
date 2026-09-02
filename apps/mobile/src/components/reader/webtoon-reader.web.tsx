import { forwardRef, useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react';

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

function seedWindow(center: number, n: number): Set<number> {
  const s = new Set<number>();
  for (let i = Math.max(0, center - 2); i <= Math.min(n - 1, center + 2); i++) s.add(i);
  return s;
}

function rel(touch: Touch, rect: DOMRect): Point {
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

// A mouse+keyboard session, not a touch one: `fit-page`'s CSS scroll-snap
// exists so a touch swipe pages one screen at a time via the browser's own
// gesture handling, with no custom JS. On desktop that same mandatory snap
// fights direct `scrollTop` writes — a released Up/Down hold-scroll was
// observed snapping straight to the nearest page, which isn't something a
// keyboard/mouse user has an equivalent "swipe" gesture for and shouldn't
// happen — so it's skipped entirely there in favor of free scroll plus the
// explicit instant jump `goToPage` already does for Left/Right/A/D.
function isDesktopPointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
}

export const WebtoonReader = forwardRef<WebtoonReaderHandle, Props>(function WebtoonReader(
  { pages, width, height, pageFit, doubleTapZoom, initialPage, onPageChange, onToggleChrome, standby },
  ref,
) {
  const n = pages.length;
  const paged = pageFit === 'fit-page';
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

  const applyZoom = (z: number) => contentRef.current?.style.setProperty('zoom', String(z));

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
      if (zoom.current > ZOOM_EPSILON) {
        // Zoom out, keeping the vertical reading position (content shrinks).
        const prevTop = el.scrollTop;
        const z0 = zoom.current;
        zoom.current = 1;
        applyZoom(1);
        el.style.overflowX = 'hidden';
        el.style.touchAction = 'pan-y';
        el.scrollLeft = 0;
        el.scrollTop = z0 > 0 ? prevTop / z0 : prevTop;
      } else {
        const z0 = zoom.current;
        const cpX = (el.scrollLeft + fx) / z0;
        const cpY = (el.scrollTop + fy) / z0;
        const z = DOUBLE_TAP_SCALE;
        zoom.current = z;
        applyZoom(z);
        el.style.overflowX = 'auto';
        el.style.touchAction = 'pan-x pan-y';
        el.scrollLeft = clamp(cpX * z - fx, 0, Math.max(0, el.scrollWidth - el.clientWidth));
        el.scrollTop = clamp(cpY * z - fy, 0, Math.max(0, el.scrollHeight - el.clientHeight));
      }
    },
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
    if (!el || pageFit === 'fit-page') return;

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
        cpX: (el.scrollLeft + f.x) / z0,
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
      el.scrollLeft = clamp(pinch.current.cpX * z - f.x, 0, Math.max(0, el.scrollWidth - el.clientWidth));
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
  }, [pageFit]);

  // Smooth continuous vertical scroll while Up/Down (or W/S) is held. The
  // browser's own key-repeat doesn't drive scrollTop at all here (this div
  // isn't natively keyboard-scrollable), so this owns movement directly via
  // a per-frame, delta-time-based velocity instead of stepping once per
  // keydown — constant speed regardless of frame rate, and no OS-repeat
  // unevenness to stutter on. Only wired up on a desktop (mouse+keyboard)
  // session — see `isDesktopPointer` for why `fit-page`'s CSS scroll-snap is
  // skipped there entirely, which is what makes direct `scrollTop` writes
  // work here in the first place.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !isDesktopPointer()) return;
    const held = { up: false, down: false };
    const SCROLL_SPEED = 900; // px/sec
    let rafId: number | null = null;
    let lastT = 0;

    const tick = (t: number) => {
      if (!held.up && !held.down) {
        rafId = null;
        return;
      }
      const dt = lastT ? (t - lastT) / 1000 : 0;
      lastT = t;
      if (!pinch.current.active) {
        const dir = held.down ? 1 : -1;
        el.scrollTop = clamp(el.scrollTop + SCROLL_SPEED * dt * dir, 0, el.scrollHeight - el.clientHeight);
        userScrolledRef.current = true;
      }
      rafId = requestAnimationFrame(tick);
    };
    const start = () => {
      if (rafId == null) {
        lastT = 0;
        rafId = requestAnimationFrame(tick);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        held.up = true;
        e.preventDefault();
        start();
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        held.down = true;
        e.preventDefault();
        start();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') held.up = false;
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') held.down = false;
    };
    const onBlur = () => {
      held.up = false;
      held.down = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

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
          if (el && target) el.scrollTop = target.offsetTop;
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
    WebkitOverflowScrolling: 'touch',
    scrollSnapType: snapEnabled ? 'y mandatory' : undefined,
    // Pure black, matching the app's own background and native's `READER_BACKDROP`.
    backgroundColor: '#000000',
  };
}
function pagedSlotStyle(height: number): React.CSSProperties {
  return { width: '100%', height, scrollSnapAlign: 'start' };
}
const contentStyle: React.CSSProperties = { width: '100%' };
const loadedSlotStyle: React.CSSProperties = { width: '100%' };
