import { useSyncExternalStore } from 'react';

// Reader preferences, persisted for the app session via a tiny module-level
// store (no AsyncStorage dependency) so they survive leaving and reopening the
// reader. Mirrors the reference's localStorage `readDirection` / `pageLayout`.

export type ReaderMode = 'paged' | 'webtoon';
export type ReaderDirection = 'ltr' | 'rtl';
export type ReaderSettings = { mode: ReaderMode; direction: ReaderDirection };

let settings: ReaderSettings = { mode: 'paged', direction: 'ltr' };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReaderSettings {
  return settings;
}

export function setReaderSettings(patch: Partial<ReaderSettings>): void {
  settings = { ...settings, ...patch };
  listeners.forEach((l) => l());
}

/** `[settings, patch]` — `patch` merges and notifies all readers. */
export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [value, setReaderSettings];
}
