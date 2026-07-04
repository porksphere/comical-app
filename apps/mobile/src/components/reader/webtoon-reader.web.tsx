import { forwardRef, useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react';

import { ReaderPage } from '@/components/reader/reader-page';
import { clamp, distance, MAX_SCALE, midpoint, type Point, ZOOM_EPSILON } from '@/components/reader/reader-zoom';
import type { PageFit } from '@/hooks/use-reader-settings';

export type WebtoonReaderHandle = { goToPage: (index: number) => void };

type Props = {
  pages: string[];
  width: number;
  /** Viewport height — only used by the `'fit-page'` paginated variant, to
   *  size each row to exactly one screen. */
  height: number;
  pageFit: PageFit;
  initialPage: number;
  onPageChange: (index: number) => void;
  onToggleChrome: () => void;
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
 * Chrome (toolbar / pill / settings) are siblings in reader.tsx, outside this
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

export const WebtoonReader = forwardRef<WebtoonReaderHandle, Props>(function WebtoonReader(
  { pages, width, height, pageFit, initialPage, onPageChange, onToggleChrome },
  ref,
) {
  const n = pages.length;
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

  // Report the page that owns the top half of the viewport.
  const updateCurrent = useCallback(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const slots = slotsRef.current;
    let current = 0;
    for (let i = 0; i < slots.length; i++) {
      const el = slots[i];
      if (!el) continue;
      const top = el.getBoundingClientRect().top - rootTop;
      if (top <= root.clientHeight * 0.5) current = i;
      else break;
    }
    onPageChangeRef.current(current);
  }, []);

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

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [pageFit]);

  // Jump to the entry page once mounted, then correct twice more shortly after:
  // the first jump only has the generic estimate to go on for most slots (real
  // heights are unknown until each image loads), so as the seeded window around
  // the target loads and refines `aspectRef`, re-running scrollIntoView tightens
  // the landing spot instead of leaving it wherever the initial guess put it.
  // Skipped once the user starts scrolling on their own.
  //
  // Reacts to `initialPage` changing (not just mount): reader.tsx's own
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
        requestAnimationFrame(() => slotsRef.current[clamped]?.scrollIntoView({ block: 'start' }));
      },
    }),
    [n],
  );

  const paged = pageFit === 'fit-page';

  return (
    <div ref={scrollerRef} onScroll={onScroll} onClick={onToggleChrome} style={scrollerStyle(paged)}>
      <div ref={contentRef} style={contentStyle}>
        {pages.map((uri, i) => {
          const isLoaded = loaded.has(i);
          const slotStyle = paged
            ? pagedSlotStyle(height)
            : isLoaded
              ? loadedSlotStyle
              : { width: '100%', height: width * aspectRef.current };
          return (
            <div
              key={`${uri}:${i}`}
              data-index={i}
              ref={(el) => {
                slotsRef.current[i] = el;
              }}
              style={slotStyle}
            >
              {isLoaded ? (
                <ReaderPage
                  uri={uri}
                  page={i + 1}
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

function scrollerStyle(paged: boolean): React.CSSProperties {
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
    scrollSnapType: paged ? 'y mandatory' : undefined,
    // Reference: `#reader-view { background: #0f0f0f }` — not pure black.
    backgroundColor: '#0f0f0f',
  };
}
function pagedSlotStyle(height: number): React.CSSProperties {
  return { width: '100%', height, scrollSnapAlign: 'start' };
}
const contentStyle: React.CSSProperties = { width: '100%' };
const loadedSlotStyle: React.CSSProperties = { width: '100%' };
