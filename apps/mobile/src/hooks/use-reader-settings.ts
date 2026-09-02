import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';

// Reader preferences, persisted to AsyncStorage (single key) via a Legend State
// observable (see `lib/observable.ts`), so they survive leaving and reopening the
// reader, and an app restart. Mirrors the reference's localStorage
// `readDirection` / `pageLayout`.

export type ReaderMode = 'paged' | 'webtoon';
export type ReaderDirection = 'ltr' | 'rtl';
/** `smart` picks per page from the picture's shape: fit-width for a tall page, the spread rule
 *  (fit-height, panned sideways) for a wide one. `fill-height` rests EVERY page at the viewport's
 *  height (where that buys anything — a page near the screen's own shape just fits), panned
 *  sideways, with the side taps turning. Both paged-only; webtoon reads `smart` as fit-width and
 *  `fill-height` as fit-page. */
export type PageFit = 'fit-page' | 'fit-width' | 'fill-height' | 'smart';
/** What a double-tap does: magnify the page, toggle `pageFit` between fill-height and fit-page, or
 *  nothing (a lone tap then acts at once instead of waiting out a second one). */
export type DoubleTapMode = 'magnify' | 'fill-height' | 'off';
export type PrefetchAhead = 1 | 2 | 3 | 4 | 6 | 8;
export type ReaderSettings = {
  mode: ReaderMode;
  direction: ReaderDirection;
  pageFit: PageFit;
  /** Rest a SPREAD (a page wider than it is tall) at the viewport's height instead of letterboxed
   *  across its middle, so it reads by panning sideways. Paged mode, fit-page only. */
  zoomWidePages: boolean;
  doubleTap: DoubleTapMode;
  /** Hold the screen awake while a page is on screen. */
  keepAwake: boolean;
  prefetchAhead: PrefetchAhead;
};

const STORAGE_KEY = 'comical:readerSettings';
const DEFAULT_SETTINGS: ReaderSettings = {
  mode: 'paged',
  direction: 'ltr',
  pageFit: 'fit-page',
  zoomWidePages: true,
  doubleTap: 'magnify',
  keepAwake: true,
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

/** `[settings, patch]`. Reads spread over the defaults so a blob persisted before a
 *  field existed still surfaces every key. */
export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const value = use$(settings$);
  return [{ ...DEFAULT_SETTINGS, ...value }, setReaderSettings];
}
