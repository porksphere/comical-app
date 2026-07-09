import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';

// Reader preferences, persisted to AsyncStorage (single key) via a Legend State
// observable (see `lib/observable.ts`), so they survive leaving and reopening the
// reader, and an app restart. Mirrors the reference's localStorage
// `readDirection` / `pageLayout`.

export type ReaderMode = 'paged' | 'webtoon';
export type ReaderDirection = 'ltr' | 'rtl';
export type PageFit = 'fit-page' | 'fit-width';
export type PrefetchAhead = 1 | 2 | 3 | 4 | 6 | 8;
export type ReaderSettings = {
  mode: ReaderMode;
  direction: ReaderDirection;
  pageFit: PageFit;
  prefetchAhead: PrefetchAhead;
};

const STORAGE_KEY = 'comical:readerSettings';
const DEFAULT_SETTINGS: ReaderSettings = { mode: 'paged', direction: 'ltr', pageFit: 'fit-page', prefetchAhead: 4 };

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
