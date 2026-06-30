import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { ReaderPage } from '@/components/reader/reader-page';
import { clamp, distance, MAX_SCALE, midpoint, type Point, ZOOM_EPSILON } from '@/components/reader/reader-zoom';

export type WebtoonReaderHandle = { goToPage: (index: number) => void };

type Props = {
  pages: string[];
  width: number;
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
 */

// Comics are taller than wide; matches ReaderPage's DEFAULT_ASPECT (2/3 w:h),
// so an unloaded slot reserves ≈ 1.5 × width of height.
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
  { pages, width, initialPage, onPageChange, onToggleChrome },
  ref,
) {
  const n = pages.length;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<(HTMLDivElement | null)[]>([]);

  // Which slots currently mount a real image (lazy; viewport-driven).
  const [loaded, setLoaded] = useState<Set<number>>(() => seedWindow(initialPage, n));

  // Live zoom, kept in a ref so pinch frames don't re-render.
  const zoom = useRef(1);
  const pinch = useRef({ active: false, startDist: 0, z0: 1, cpX: 0, cpY: 0 });

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
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

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
      };
      el.style.overflowX = 'auto'; // allow horizontal scroll while we anchor the focal
    };

    const onMove = (e: TouchEvent) => {
      if (!pinch.current.active || e.touches.length < 2) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const a = rel(e.touches[0], rect);
      const b = rel(e.touches[1], rect);
      const f = midpoint(a, b);
      const z = clamp(pinch.current.z0 * (distance(a, b) / pinch.current.startDist), 1, MAX_SCALE);
      zoom.current = z;
      applyZoom(z);
      el.scrollLeft = clamp(pinch.current.cpX * z - f.x, 0, Math.max(0, el.scrollWidth - el.clientWidth));
      el.scrollTop = clamp(pinch.current.cpY * z - f.y, 0, Math.max(0, el.scrollHeight - el.clientHeight));
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
  }, []);

  // Jump to the entry page once mounted (best-effort; heights settle as images load).
  useEffect(() => {
    if (initialPage <= 0) return;
    const id = requestAnimationFrame(() => {
      slotsRef.current[Math.min(n - 1, initialPage)]?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div ref={scrollerRef} onScroll={onScroll} onClick={onToggleChrome} style={scrollerStyle}>
      <div ref={contentRef} style={contentStyle}>
        {pages.map((uri, i) => {
          const isLoaded = loaded.has(i);
          return (
            <div
              key={`${uri}:${i}`}
              data-index={i}
              ref={(el) => {
                slotsRef.current[i] = el;
              }}
              style={isLoaded ? loadedSlotStyle : { width: '100%', height: width * ESTIMATED_ASPECT }}
            >
              {isLoaded ? <ReaderPage uri={uri} page={i + 1} fit="width" width={width} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});

const scrollerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  touchAction: 'pan-y',
  WebkitOverflowScrolling: 'touch',
  backgroundColor: '#000',
};
const contentStyle: React.CSSProperties = { width: '100%' };
const loadedSlotStyle: React.CSSProperties = { width: '100%' };
