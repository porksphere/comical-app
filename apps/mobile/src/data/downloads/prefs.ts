/**
 * Device-local download preferences (Legend State, persisted) — the same pattern as reader settings
 * (`use-reader-settings.ts`). These are UI/device state, not server data, so they live in an
 * observable the engine can read *synchronously* (the Wi-Fi-only gate runs mid-drain, off the React
 * tree). The `@comical/downloads` core also has a prefs seam for portability/other hosts, but the app
 * owns its own copy here — a sync, flicker-free source for both the engine and the Settings toggle.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

export interface DownloadPrefs {
  /** When true, downloads only run while on Wi-Fi. */
  wifiOnly: boolean;
  /** When true, allow the OS to drain the queue in granted background windows. */
  background: boolean;
  /** Download what gets saved to the library, per kind of item (see `auto.ts`). */
  autoSeries: boolean;
  autoChapters: boolean;
  autoPages: boolean;
  /** Download chapters a library sync finds on series already saved. */
  autoNew: boolean;
}

const DEFAULTS: DownloadPrefs = {
  wifiOnly: true,
  background: false,
  autoSeries: false,
  autoChapters: false,
  autoPages: false,
  autoNew: false,
};

export const downloadPrefs$ = persisted$<DownloadPrefs>('comical:dl:prefs-local', DEFAULTS);

/**
 * Reactively read the download prefs in a component. `use$` MUST be wrapped in a custom hook (this
 * one) rather than called directly in a screen: `use$` doesn't match the `use[A-Z]` name the React
 * Compiler uses to detect hooks, so calling it inline among other hooks lets the compiler reorder its
 * internal `useSyncExternalStore` and break the rules of hooks. Reading the whole object once (spread
 * over the defaults, so a blob persisted before a field existed still surfaces every key) mirrors the
 * app's only other `use$` usage, `useReaderSettings`.
 */
export function useDownloadPrefs(): DownloadPrefs {
  const value = use$(downloadPrefs$);
  return { ...DEFAULTS, ...value };
}

/** Non-tracking read for use outside React (the engine). */
export function getDownloadPrefsSync(): DownloadPrefs {
  return { ...DEFAULTS, ...downloadPrefs$.peek() };
}

/** The kinds of auto-download, each a global toggle above that a bridge can opt out of. */
export type AutoDownloadKind = 'autoSeries' | 'autoNew' | 'autoChapters' | 'autoPages';

/** Per-bridge opt-outs, keyed by bridge id. Only `false` is ever stored: a bridge takes part in
 *  every kind that is on globally until it is switched off here. */
export const bridgeAutoDownload$ = persisted$<Record<string, Partial<Record<AutoDownloadKind, boolean>>>>(
  'comical:dl:autoBridges',
  {},
);

/** Whether `kind` should auto-download for `bridgeId` right now: on globally and not opted out. */
export function autoDownloadsFor(bridgeId: string, kind: AutoDownloadKind): boolean {
  return getDownloadPrefsSync()[kind] && bridgeAutoDownload$.peek()[bridgeId]?.[kind] !== false;
}

/** Reactive `[optedIn, set]` for one bridge's settings. Writes replace the whole record, as
 *  `useComicalExcluded` does, so subscribers elsewhere see a new reference. */
export function useBridgeAutoDownload(
  bridgeId: string,
): readonly [(kind: AutoDownloadKind) => boolean, (kind: AutoDownloadKind, on: boolean) => void] {
  const map = use$(bridgeAutoDownload$);
  const set = (kind: AutoDownloadKind, on: boolean) => {
    const all = bridgeAutoDownload$.peek();
    const { [kind]: _, ...rest } = all[bridgeId] ?? {};
    const next = on ? rest : { ...rest, [kind]: false };
    const { [bridgeId]: __, ...others } = all;
    bridgeAutoDownload$.set(Object.keys(next).length > 0 ? { ...others, [bridgeId]: next } : others);
  };
  return [(kind) => map[bridgeId]?.[kind] !== false, set] as const;
}
