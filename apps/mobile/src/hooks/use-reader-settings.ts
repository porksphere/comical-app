import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';

// Reader preferences, persisted to AsyncStorage (single key) via a Legend State
// observable (see `lib/observable.ts`), so they survive leaving and reopening the
// reader, and an app restart. Mirrors the reference's localStorage
// `readDirection` / `pageLayout`.

export type ReaderMode = 'paged' | 'webtoon';
export type ReaderDirection = 'ltr' | 'rtl';
/** How a page is fitted. `auto` shows every page whole and fills the height with a SPREAD alone —
 *  a picture wider than it is tall, which would otherwise lie as a strip — panned sideways; it is
 *  device-independent, an ordinary page is never scrolled on any screen. The other two fit an
 *  AXIS, and the other axis is whatever the picture's shape makes it: on a phone, fit-width shows
 *  an ordinary page whole and scrolls a tall strip, while fit-height fills the screen's height
 *  with an ordinary page (panned sideways) and shows a strip whole. There is no "fit page" — on
 *  any screen that is just whichever of the two is smaller. Webtoon reads auto and fit-height as
 *  one page per screen and fit-width as the continuous strip. */
export type PageFit = 'auto' | 'fit-width' | 'fit-height';
/** What a double-tap does: magnify the page, switch `pageFit` to the other axis, or nothing (a
 *  lone tap then acts at once instead of waiting out a second one). */
export type DoubleTapMode = 'magnify' | 'switch-fit' | 'off';
/** Pages warmed ahead of the one being read — any whole number from none to PREFETCH_AHEAD_MAX. */
export type PrefetchAhead = number;
export const PREFETCH_AHEAD_MIN = 0;
export const PREFETCH_AHEAD_MAX = 10;
export type ReaderSettings = {
  mode: ReaderMode;
  direction: ReaderDirection;
  pageFit: PageFit;
  doubleTap: DoubleTapMode;
  /** Hold the screen awake while a page is on screen. */
  keepAwake: boolean;
  /** Keep the page count faintly on screen after the rest of the chrome has hidden. */
  pageCountWhenHidden: boolean;
  /** Keep the pages out of the screen's cutout and system bars, instead of drawing edge to edge
   *  under them — a page fitted to the height otherwise runs under the notch. */
  respectSafeArea: boolean;
  prefetchAhead: PrefetchAhead;
};

const STORAGE_KEY = 'comical:readerSettings';
const DEFAULT_SETTINGS: ReaderSettings = {
  mode: 'paged',
  direction: 'ltr',
  pageFit: 'auto',
  doubleTap: 'magnify',
  keepAwake: true,
  pageCountWhenHidden: true,
  respectSafeArea: false,
  prefetchAhead: 4,
};

// Starts at DEFAULT_SETTINGS (also the pre-hydration value the web static export
// renders) and rehydrates from the same `comical:readerSettings` key the old
// hand-rolled store wrote, so existing persisted preferences carry over.
const settings$ = persisted$<ReaderSettings>(STORAGE_KEY, DEFAULT_SETTINGS);

/** `patch` merges into the stored settings; the observable persists and notifies readers. */
export function setReaderSettings(patch: Partial<ReaderSettings>): void {
  if (patch.pageFit !== undefined) fitOverride$.set(null);
  settings$.assign(patch);
}

/** Values a blob may still hold from before: `fit-page` was the contain fit with the spread
 *  rule, which is `auto`, and `fill-height` was fit-height under another name. Mapped on read;
 *  the next write stores the current value. */
const LEGACY_PAGE_FIT: Record<string, PageFit> = { 'fit-page': 'auto', 'fill-height': 'fit-height' };

/** The fit a `switch-fit` double-tap has put in place of the setting — the other axis of the page
 *  it was tapped on — or null. In memory only: it carries across page turns, which is the point,
 *  and is cleared by the next double-tap, by leaving the reader, and by choosing a fit in the
 *  sheet, so the sheet never shows a value the pages aren't drawn to for long. */
export const fitOverride$ = observable<PageFit | null>(null);
export function useFitOverride(): PageFit | null {
  return use$(fitOverride$);
}
export function setFitOverride(fit: PageFit | null): void {
  fitOverride$.set(fit);
}
const LEGACY_DOUBLE_TAP: Record<string, DoubleTapMode> = { 'fill-height': 'switch-fit' };

/** `[settings, patch]`. Reads spread over the defaults so a blob persisted before a
 *  field existed still surfaces every key. */
export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const value = use$(settings$);
  const merged = { ...DEFAULT_SETTINGS, ...value };
  merged.pageFit = LEGACY_PAGE_FIT[merged.pageFit] ?? merged.pageFit;
  merged.doubleTap = LEGACY_DOUBLE_TAP[merged.doubleTap] ?? merged.doubleTap;
  // A stored count outside the stepper's range (an older build's fixed choices went to 8, and a
  // blob can hold anything) is brought inside it rather than trusted.
  merged.prefetchAhead = Math.min(
    PREFETCH_AHEAD_MAX,
    Math.max(PREFETCH_AHEAD_MIN, Math.round(Number(merged.prefetchAhead) || 0)),
  );
  return [merged, setReaderSettings];
}
