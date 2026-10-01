/**
 * The window's own caption buttons, when the page is drawn underneath them — the desktop shell's
 * hidden title bar, or an installed PWA with `window-controls-overlay`. The standard Window Controls
 * Overlay API reports the strip of title bar they leave free; a bar at the top of the window keeps
 * its content out of the rest, the way a phone's bar keeps out of the status bar. 0 everywhere else.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useContentWidth } from '@/hooks/use-content-width';
import { useHydrated } from '@/hooks/use-responsive';

/** Not in TypeScript's DOM lib yet. */
type WindowControlsOverlay = EventTarget & {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
};

const inset$ = observable(0);
let watching = false;

function watch(): void {
  if (watching || typeof navigator === 'undefined') return;
  const overlay = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay;
  if (!overlay) return;
  watching = true;
  const read = () => {
    if (!overlay.visible) return inset$.set(0);
    const free = overlay.getTitlebarAreaRect();
    inset$.set(Math.max(0, window.innerWidth - (free.x + free.width)));
  };
  read();
  overlay.addEventListener('geometrychange', read);
}

/** The bare read, alone in its own hook — see `sidebar-bridges.tsx`. */
function useMeasuredInset(): number {
  return use$(inset$);
}

/** How far in from the window's right edge the caption buttons reach, in a bar at the top of it. */
export function useWindowControlsInset(): number {
  const hydrated = useHydrated();
  useEffect(() => {
    if (Platform.OS === 'web') watch();
  }, []);
  const inset = useMeasuredInset();
  return hydrated ? inset : 0;
}

/**
 * What a bar's content row, capped at `maxWidth` and centred in the content region, has to give up
 * on its right to clear the buttons: only the part of them that reaches past the space already
 * beside the row. Taken off the row rather than the bar, so a capped row stays centred over the
 * grid beneath it; a full-width row gives up the whole inset.
 */
export function useWindowControlsClearance(maxWidth = Infinity): number {
  const inset = useWindowControlsInset();
  const width = useContentWidth();
  return Math.max(0, inset - (width - Math.min(width, maxWidth)) / 2);
}

/**
 * Spread onto a bar to make it the handle the window is moved by, where the window has no title bar
 * of its own. Only a marker: the shell that hid the title bar styles it (`app-region: drag`), and
 * cuts the bar's controls back out of it, so a browser tab gets nothing but an inert attribute.
 */
export const windowDragRegion = (Platform.OS === 'web' ? { dataSet: { appRegion: 'drag' } } : {}) as object;

/**
 * For chrome stacked OVER a bar rather than inside it (a back button that persists across bar
 * modes): not a handle itself, but its controls are cut out of the handle beneath them. The window
 * takes a click in a drag region before the page ever sees it, whatever is painted on top.
 */
export const windowControlsLayer = (Platform.OS === 'web' ? { dataSet: { appRegion: 'controls' } } : {}) as object;

/** Spread onto a bar that is mounted but not in use (a mode's bar faded out), so it stops being a
 *  handle without unmounting. */
export const windowDragOff = (Platform.OS === 'web' ? { dataSet: { windowDrag: 'off' } } : {}) as object;

/**
 * Spread onto the root of anything drawn over the bars while it is open — a sheet, a menu, a dialog.
 * A drag region takes the mouse before the page sees it, whatever is painted on top of it, so the
 * bars stop being one while a layer marked with this is up (the shell's stylesheet, via `:has`).
 */
export const windowModalLayer = (Platform.OS === 'web' ? { dataSet: { windowLayer: 'modal' } } : {}) as object;

/**
 * Publishes `color` as the page's `theme-color` — what a shell that draws its caption buttons over
 * the page paints behind them. The highest `layer` mounted wins, so a screen that darkens the top of
 * the window (the reader) can claim it from the app's own background, and hand it back by unmounting
 * or passing `null`.
 */
export function useWindowThemeColor(color: string | null, layer = 0): void {
  useEffect(() => {
    if (color == null || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const claim = { color, layer };
    claims.add(claim);
    publishThemeColor();
    return () => {
      claims.delete(claim);
      publishThemeColor();
    };
  }, [color, layer]);
}

const claims = new Set<{ color: string; layer: number }>();

function publishThemeColor(): void {
  let top: { color: string; layer: number } | undefined;
  for (const claim of claims) if (!top || claim.layer >= top.layer) top = claim;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!top) return meta?.remove();
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = top.color;
}
