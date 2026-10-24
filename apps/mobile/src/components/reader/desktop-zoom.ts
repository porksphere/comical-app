import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

import { showToast } from '@/components/toast';
import { createKeyHold, HOLD_SPEED, keySpeedStore } from '@/lib/key-hold';
import { keyActionOf } from '@/lib/keybindings';

// Mouse-and-keyboard zoom for the web readers: Ctrl/⌘+wheel (which is also what a trackpad pinch
// arrives as), the +/-/0 keys, Q/E held and the toolbar's stepper. All of them speak a LEVEL — a multiple of
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
  /** Zoom to `level` (clamped to what the page allows) about the point the reader is FOCUSED on —
   *  the content last panned to, wherever it sits on screen now, so zooming back in after a zoom
   *  out returns to it rather than to the middle of the page — eased, unless `animate` is false: a
   *  held key moves it every frame, and an ease restarted every frame only trails behind. */
  zoomTo: (level: number, animate?: boolean) => void;
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

/** The factor Q/E zoom by over a second at full speed, at the default `keyZoomSpeed`. */
const HOLD_ZOOM_PER_S = 4;

/** How fast the KEYBOARD zooms — Q/E held and the +/- keys — as a power on the default pace: 1 is
 *  the pace above, 2 is twice the rate in log-zoom (twice as many doublings a second, and a +/-
 *  step twice as far). The mouse wheel, a pinch and the toolbar's stepper don't read it: a wheel
 *  notch is the browser's own unit, and a button is a fixed step. The range is the keyboard
 *  speeds' shared one (lib/key-hold), where the pan's lives. */
const zoomSpeed = keySpeedStore('comical:keyZoomSpeed');
export const keyZoomSpeed = zoomSpeed.get;
export const useKeyZoomSpeed = zoomSpeed.use;
export const setKeyZoomSpeed = zoomSpeed.set;
/** A second Q/E press within this long of the first goes all the way out/in. */
const DOUBLE_PRESS_MS = 300;

/** Q zooms out and E in, continuously while held — on the pan keys' own eased velocity
 *  (lib/key-hold), read as a rate in log-zoom, so it starts, runs and settles the way they do.
 *  A quick double press jumps to the far end instead (see `zoomToLimit`). */
export function zoomHoldDirection(e: KeyboardEvent): -1 | 1 | null {
  const action = keyActionOf(e, ['zoom-out', 'zoom-in']);
  return action === 'zoom-out' ? -1 : action === 'zoom-in' ? 1 : null;
}
export function createZoomHold() {
  const hold = createKeyHold((dx) => {
    if (!target || dx === 0) return;
    const from = zoomLevel$.peek();
    target.zoomTo(from * HOLD_ZOOM_PER_S ** ((dx / HOLD_SPEED) * keyZoomSpeed()), false);
    const level = zoomLevel$.peek();
    if (Math.round(level * 100) !== Math.round(from * 100)) showZoomToast(level);
  });
  let lastPress: { key: string; at: number } | null = null;
  // The key whose second press jumped. Its auto-repeat must not feed the hold until it comes back
  // up: the hold zooms un-eased every frame, which would cut the jump's ease off where it started.
  let jumped: string | null = null;
  return {
    press(key: string, dir: -1 | 1, repeat: boolean) {
      const k = key.toLowerCase();
      if (repeat) {
        if (jumped !== k) hold.press(k, { x: dir, y: 0 });
        return;
      }
      const now = performance.now();
      if (lastPress?.key === k && now - lastPress.at < DOUBLE_PRESS_MS) {
        lastPress = null;
        jumped = k;
        hold.stop();
        zoomToLimit(dir);
        return;
      }
      lastPress = { key: k, at: now };
      hold.press(k, { x: dir, y: 0 });
    },
    release(key: string) {
      const k = key.toLowerCase();
      if (jumped === k) jumped = null;
      hold.release(k);
    },
    clear() {
      jumped = null;
      hold.clear();
    },
    dispose: hold.dispose,
  };
}

/** All the way in or out, eased like the +/-/0 keys — the readers clamp the level to what the
 *  page allows, so asking for the extremes lands exactly on them. */
export function zoomToLimit(dir: 1 | -1, opts?: { toast?: boolean }): void {
  if (!target) return;
  target.zoomTo(dir > 0 ? Number.POSITIVE_INFINITY : 0);
  if (opts?.toast !== false) showZoomToast(zoomLevel$.peek());
}

/** One step in or out from whatever the page shows now (not from the kept level: after a
 *  double-click the step should start from what is on screen). Lands exactly on 100% when it
 *  passes it, so stepping back out always finds the rest again. `speed` scales the step (the keys
 *  pass `keyZoomSpeed()`; the stepper's buttons take the plain step). */
export function stepZoom(dir: 1 | -1, opts?: { toast?: boolean; speed?: number }): void {
  if (!target) return;
  const from = zoomLevel$.peek();
  let next = from * ZOOM_STEP ** (dir * (opts?.speed ?? 1));
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
