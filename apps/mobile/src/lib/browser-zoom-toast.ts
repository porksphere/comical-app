import { Platform } from 'react-native';

import { showToast } from '@/components/toast';

// The browser's own zoom (Ctrl/⌘ +/-/0, Ctrl+wheel off the reader) is left to the browser, but it
// gives no sign of the level inside a full-window app — so it is announced here.
//
// No browser exposes its zoom level. What a page can see is devicePixelRatio, which moves with it
// (and with the window crossing to a monitor of another density), and in Chromium the ratio of
// outer to inner window width, which IS the zoom. So a change is only announced when it follows a
// zoom key or ctrl-wheel the page saw, and its level is read from the window when the window moved
// in step with the pixel ratio, else carried relatively from the last one, then snapped onto the
// browsers' own zoom ladders.

const ARM_MS = 1000;
const SNAP_TOLERANCE = 0.04;
// Chromium's and Firefox's zoom steps, in percent.
const LADDER = [
  25, 30, 33, 50, 67, 75, 80, 90, 100, 110, 120, 125, 133, 150, 170, 175, 200, 240, 250, 300, 400, 500,
];

const ZOOM_KEYS = new Set(['=', '+', '-', '_', '0']);

/** The ladder step `percent` is, or null when it is none of them. */
function onLadder(percent: number): number | null {
  let best = LADDER[0];
  for (const step of LADDER) if (Math.abs(step - percent) < Math.abs(best - percent)) best = step;
  return Math.abs(best - percent) / best <= SNAP_TOLERANCE ? best : null;
}

const windowRatio = () => (window.innerWidth > 0 ? window.outerWidth / window.innerWidth : 0);

export function installBrowserZoomToast(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;

  let armedUntil = 0;
  const arm = () => {
    armedUntil = Date.now() + ARM_MS;
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ZOOM_KEYS.has(e.key)) arm();
    },
    true,
  );
  // Bubble phase, so a reader that claims its ctrl-wheel for the page zoom has already said so.
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey && !e.defaultPrevented) arm();
    },
    { passive: true },
  );

  let dpr = window.devicePixelRatio || 1;
  let ratio = windowRatio();
  let percent = onLadder(ratio * 100) ?? 100;

  const onChange = () => {
    const nextDpr = window.devicePixelRatio || 1;
    if (nextDpr === dpr) return;
    const nextRatio = windowRatio();
    const scaled = nextDpr / dpr;
    // A window with something docked beside the page (devtools) moves in step but lands off the
    // ladder — read relatively then.
    const fromWindow = ratio > 0 && Math.abs(nextRatio / ratio - scaled) < 0.03 ? onLadder(nextRatio * 100) : null;
    const next = fromWindow ?? onLadder(percent * scaled) ?? Math.round(percent * scaled);
    dpr = nextDpr;
    ratio = nextRatio;
    if (Date.now() > armedUntil) return;
    percent = next;
    showToast(`Browser zoom ${percent}%`, { slot: 'browser-zoom', durationMs: 1200 });
  };

  // A zoom resizes the viewport (in CSS pixels); a move to another monitor's density may not, so
  // the ratio is watched too. A resolution query matches only the current ratio, so it is re-made
  // on every change.
  window.addEventListener('resize', onChange);
  const listen = () => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener(
      'change',
      () => {
        onChange();
        listen();
      },
      { once: true },
    );
  };
  listen();
}
