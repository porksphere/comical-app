/**
 * How much width a vertical scrollbar takes out of a scroller on this browser. A classic Windows
 * scrollbar is laid out INSIDE the scroller's box, so a grid that divides the box's width into
 * columns has that much less room than it was told — LegendList's column slots shrink by a share of
 * it each, and the gaps between cards come out narrower than the hand-laid rails beside them. 0 on
 * native and wherever scrollbars overlay the content (macOS, phones).
 *
 * Watched rather than measured once: the desktop shell restyles the scrollbar on `dom-ready`, which
 * can land after the first render, and the probe's content box changes size when it does.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { useEffect } from 'react';
import { Platform, type ViewStyle } from 'react-native';

import { useHydrated } from '@/hooks/use-responsive';

const gutter$ = observable(0);
let watching = false;

function watch(): void {
  if (watching || typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return;
  watching = true;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:-200px;width:100px;height:100px;overflow-y:scroll;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const read = () => gutter$.set(probe.offsetWidth - probe.clientWidth);
  read();
  new ResizeObserver(read).observe(probe);
}

/** The bare read, alone in its own hook — see `sidebar-bridges.tsx`: the React Compiler doesn't know
 *  `use$` is a hook, and given anything else to do around it, it memoized the call away. */
function useMeasuredGutter(): number {
  return use$(gutter$);
}

/** 0 until hydrated, so the static export's first render matches the server's. */
export function useScrollbarGutter(): number {
  const hydrated = useHydrated();
  useEffect(() => {
    if (Platform.OS === 'web') watch();
  }, []);
  const gutter = useMeasuredGutter();
  return hydrated ? gutter : 0;
}

/** Reserves the gutter whether or not the list overflows, so a grid sized net of it is right either
 *  way — a short list would otherwise lay its columns out over the gutter it has no scrollbar in. */
export const stableScrollbarGutter: ViewStyle | undefined =
  Platform.OS === 'web' ? ({ scrollbarGutter: 'stable' } as ViewStyle) : undefined;
