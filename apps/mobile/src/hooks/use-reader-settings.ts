import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Reader preferences, persisted to AsyncStorage (single JSON key) via a tiny
// module-level store, so they survive leaving and reopening the reader, and an
// app restart. Mirrors the reference's localStorage `readDirection` / `pageLayout`.

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

let settings: ReaderSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReaderSettings {
  return settings;
}

// Static web export renders server + client identically before hydration —
// always the unpersisted default, same as the app's other persisted toggles.
function getServerSnapshot(): ReaderSettings {
  return DEFAULT_SETTINGS;
}

AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (!stored) return;
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    notify();
  })
  .catch(() => {});

export function setReaderSettings(patch: Partial<ReaderSettings>): void {
  settings = { ...settings, ...patch };
  notify();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
}

/** `[settings, patch]` — `patch` merges, persists, and notifies all readers. */
export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [value, setReaderSettings];
}
