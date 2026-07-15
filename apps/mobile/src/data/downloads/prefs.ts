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
}

const DEFAULTS: DownloadPrefs = { wifiOnly: true, background: false };

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
  return downloadPrefs$.peek();
}
