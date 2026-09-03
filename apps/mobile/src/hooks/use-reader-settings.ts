import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';

// Reader preferences, persisted to AsyncStorage (single key) via a Legend State
// observable (see `lib/observable.ts`), so they survive leaving and reopening the
// reader, and an app restart. Mirrors the reference's localStorage
// `readDirection` / `pageLayout`.

export type ReaderMode = 'paged' | 'webtoon';
export type ReaderDirection = 'ltr' | 'rtl';
/** Which axis a page is fitted to. The other axis is whatever the picture's shape makes it: on a
 *  phone, fit-width shows an ordinary page whole and scrolls a tall strip, while fit-height fills
 *  the screen's height with an ordinary page (panned sideways) and shows a strip whole. There is
 *  no "fit page" — on any screen that is just whichever of the two is smaller. Webtoon reads
 *  fit-height as one page per screen and fit-width as the continuous strip. */
export type PageFit = 'fit-width' | 'fit-height';
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
  prefetchAhead: PrefetchAhead;
};

const STORAGE_KEY = 'comical:readerSettings';
const DEFAULT_SETTINGS: ReaderSettings = {
  mode: 'paged',
  direction: 'ltr',
  pageFit: 'fit-width',
  doubleTap: 'magnify',
  keepAwake: true,
  pageCountWhenHidden: true,
  prefetchAhead: 4,
};

// Starts at DEFAULT_SETTINGS (also the pre-hydration value the web static export
// renders) and rehydrates from the same `comical:readerSettings` key the old
// hand-rolled store wrote, so existing persisted preferences carry over.
const settings$ = persisted$<ReaderSettings>(STORAGE_KEY, DEFAULT_SETTINGS);

/** `patch` merges into the stored settings; the observable persists and notifies readers. */
export function setReaderSettings(patch: Partial<ReaderSettings>): void {
  settings$.assign(patch);
}

/** Values a blob may still hold from before the page fit became an axis: `fit-page` was the
 *  contain fit, which on a phone is fit-width for nearly every page, and `fill-height` was
 *  fit-height under another name. Mapped on read; the next write stores the current value. */
const LEGACY_PAGE_FIT: Record<string, PageFit> = { 'fit-page': 'fit-width', 'fill-height': 'fit-height' };
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
