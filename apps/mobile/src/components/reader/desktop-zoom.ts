import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

import { showToast } from '@/components/toast';

// Mouse-and-keyboard zoom for the web readers: Ctrl/⌘+wheel (which is also what a trackpad pinch
// arrives as), the +/-/0 keys and the toolbar's stepper. All of them speak a LEVEL — a multiple of
// the current page's rest, so 100% is the page as its fit draws it, whatever scale that takes.

/** One press of +/- (and one notch of a mouse wheel, see `wheelZoomFactor`). */
export const ZOOM_STEP = 1.25;
/** The webtoon strip is drawn at the full width of the window, which on a desktop is far wider
 *  than anyone reads a strip at — so there, unlike a page, zooming OUT is most of the point. */
export const WEBTOON_MIN_LEVEL = 0.25;

/** The level the active reader is showing, however it got there (a double-click and a pinch
 *  included). Written by the reader; read by the stepper and the toast. */
export const zoomLevel$ = observable(1);

/** What a reader exposes to the stepper and the keys. Only the PRIMARY reader registers — a pager
 *  parked as the series page's backdrop must not zoom under the details card. */
export type ZoomTarget = {
  /** Zoom to `level` about the middle of the viewport (clamped to what the page allows). */
  zoomTo: (level: number) => void;
  /** Back to the page's rest, as a double-click from a zoomed page does. */
  reset: () => void;
};
let target: ZoomTarget | null = null;
/** Whether a reader is listening — the stepper is only shown while one is (a webtoon strip in
 *  fit-page mode doesn't zoom). */
export const zoomAvailable$ = observable(false);
export function registerZoomTarget(t: ZoomTarget): () => void {
  target = t;
  zoomAvailable$.set(true);
  return () => {
    if (target !== t) return;
    target = null;
    zoomAvailable$.set(false);
  };
}

/** The level the desktop zoom KEEPS: a page turned to arrives at it instead of at rest, so a
 *  chapter can be read at 130% without re-zooming every page. Only the deliberate controls set it —
 *  a double-click or a pinch is a moment's look and still drops with the page. Cleared with the
 *  reader pane, like `fitOverride$`. */
let keptLevel = 1;
export function keptZoomLevel(): number {
  return keptLevel;
}
export function keepZoomLevel(level: number): void {
  keptLevel = level;
}

export function useZoomLevel(): number {
  return use$(zoomLevel$);
}
export function useZoomAvailable(): boolean {
  return use$(zoomAvailable$);
}

export function formatZoom(level: number): string {
  return `${Math.round(level * 100)}%`;
}

export function showZoomToast(level: number): void {
  showToast(`Page zoom ${formatZoom(level)}`, { slot: 'reader-zoom', durationMs: 1200 });
}

/** One step in or out from whatever the page shows now (not from the kept level: after a
 *  double-click the step should start from what is on screen). Lands exactly on 100% when it
 *  passes it, so stepping back out always finds the rest again. */
export function stepZoom(dir: 1 | -1, opts?: { toast?: boolean }): void {
  if (!target) return;
  const from = zoomLevel$.peek();
  let next = from * ZOOM_STEP ** dir;
  if ((from < 1 && next > 1) || (from > 1 && next < 1) || Math.abs(next - 1) < 0.02) next = 1;
  if (next === 1) target.reset();
  else target.zoomTo(next);
  if (opts?.toast !== false) showZoomToast(zoomLevel$.peek());
}

export function resetZoom(opts?: { toast?: boolean }): void {
  if (!target) return;
  target.reset();
  if (opts?.toast !== false) showZoomToast(zoomLevel$.peek());
}

/** The zoom factor for one wheel event. Chromium reports a trackpad pinch as a ctrl-wheel whose
 *  deltaY is −100·ln(scale), so e^(−Δ/100) follows the fingers exactly; a mouse notch (Δ≈100)
 *  would be a 2.7× jump by the same rule, so a single event is capped at one `ZOOM_STEP`. */
export function wheelZoomFactor(e: WheelEvent, pageHeight: number): number {
  const delta = wheelPixels(e.deltaY, e.deltaMode, pageHeight);
  const cap = 100 * Math.log(ZOOM_STEP);
  return Math.exp(-Math.max(-cap, Math.min(cap, delta)) / 100);
}

/** A wheel delta in pixels — Firefox reports a mouse wheel in LINES. */
export function wheelPixels(delta: number, mode: number, pageHeight: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * pageHeight : delta;
}

/** A mouse+keyboard session, not a touch one. */
export function isDesktopPointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
}
