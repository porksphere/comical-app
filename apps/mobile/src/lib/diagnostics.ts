import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A small on-device failure log for things that otherwise fail silently with no way to inspect
 * them outside a debugger attached to Metro — chiefly asset loads (page images, thumbnails) that
 * just leave a spinner/blank tile with no visible error. Entries are only ever appended from an
 * actual failure path (never a render or a successful load), so this has no hot-path cost: at
 * most a handful of small writes per problem, not per frame. Capped to `MAX_ENTRIES` so neither
 * memory nor the persisted blob can grow unbounded.
 */

export type DiagnosticEntry = {
  id: string;
  time: number;
  category: string;
  message: string;
  url?: string;
  context?: string;
};

const MAX_ENTRIES = 200;
const STORAGE_KEY = 'comical:diagnostics-log';

let entries: DiagnosticEntry[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Fire-and-forget: a single small read at module load. `logDiagnostic` can run before this
// resolves (an early failure) — the `entries.length === 0` guard below keeps that entry instead
// of letting the hydration overwrite it.
void AsyncStorage.getItem(STORAGE_KEY)
  .then((raw: string | null) => {
    if (raw && entries.length === 0) entries = JSON.parse(raw);
  })
  .catch(() => {})
  .finally(() => {
    hydrated = true;
    notify();
  });

let seq = 0;

/** Records a failure entry. Cheap and safe to call from any error/catch/onError path. */
export function logDiagnostic(category: string, message: string, opts: { url?: string; context?: string } = {}): void {
  seq += 1;
  entries = [{ id: `${Date.now()}-${seq}`, time: Date.now(), category, message, ...opts }, ...entries].slice(0, MAX_ENTRIES);
  notify();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
}

/** Current snapshot, newest first. Safe to call before hydration finishes (starts empty). */
export function getDiagnostics(): DiagnosticEntry[] {
  return entries;
}

export function isDiagnosticsHydrated(): boolean {
  return hydrated;
}

/** Re-renders on any new entry or on the initial hydration from disk. */
export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDiagnostics(): void {
  entries = [];
  notify();
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
