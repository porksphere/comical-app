import { observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { Dimensions, Platform, useWindowDimensions, type ScaledSize } from 'react-native';

/**
 * The window's size, as `useWindowDimensions` gives it, without the sizes a window is reported at
 * mid-change and never takes. As the iPhone Duo folds, UIKit first turns the window upright at its
 * open size (951x669 becomes 669x951) and only then shrinks it to the folded display, and React
 * Native reads the size in between: the whole app laid out for a shape larger than the screen it
 * was on, and the real size waited behind that work, up to half a second. A window is never larger
 * than its screen, so a size that is is that moment, and is skipped.
 */
function takes(window: ScaledSize, screen: ScaledSize): boolean {
  return window.width <= screen.width + 1 && window.height <= screen.height + 1;
}

const window$ = observable<ScaledSize>(Dimensions.get('window'));
const beforeResize = new Set<() => void>();
// Whether the window is changing size, from its first new size until `RESIZE_SETTLE_MS` after its
// last (`useWindowResizing`).
const resizing$ = observable(false);
const RESIZE_SETTLE_MS = 1000;
let settle: ReturnType<typeof setTimeout> | undefined;
if (Platform.OS !== 'web') {
  Dimensions.addEventListener('change', ({ window, screen }: { window: ScaledSize; screen: ScaledSize }) => {
    if (!takes(window, screen)) return;
    const was = window$.peek();
    if (was.width !== window.width || was.height !== window.height) {
      for (const run of beforeResize) run();
      // Set before the size, so whatever holds still for a resize does so in the render that has it.
      resizing$.set(true);
      clearTimeout(settle);
      settle = setTimeout(() => resizing$.set(false), RESIZE_SETTLE_MS);
    }
    window$.set(window);
  });
}

/**
 * Runs `run` as the window is about to take a new size, before anything renders for it — while
 * every list is still laid out at the old one, which is the moment to note what is on screen (a grid
 * holding its first visible card through the columns changing). Native only; returns the unsubscribe.
 */
export function onBeforeWindowResize(run: () => void): () => void {
  beforeResize.add(run);
  return () => beforeResize.delete(run);
}

function useNativeWindowSize(): ScaledSize {
  return useSelector(() => window$.get());
}

/** Whether the window is in the middle of changing size (an iPhone Duo folding or opening), until a
 *  second after it settles. Always false on the web. */
export function useWindowResizing(): boolean {
  return useSelector(() => resizing$.get());
}

// The web never reports one: it keeps React Native's own hook, prerender handling and all.
export const useWindowSize: () => ScaledSize = Platform.OS === 'web' ? useWindowDimensions : useNativeWindowSize;
