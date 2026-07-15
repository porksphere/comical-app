/**
 * Device-local download preferences (Legend State, persisted) — the same pattern as reader settings
 * (`use-reader-settings.ts`). These are UI/device state, not server data, so they live in an
 * observable the engine can read *synchronously* (the Wi-Fi-only gate runs mid-drain, off the React
 * tree). The `@comical/downloads` core also has a prefs seam for portability/other hosts, but the app
 * owns its own copy here — a sync, flicker-free source for both the engine and the Settings toggle.
 */
import { persisted$ } from '@/lib/observable';

export interface DownloadPrefs {
  /** When true, downloads only run while on Wi-Fi. */
  wifiOnly: boolean;
  /** When true, allow the OS to drain the queue in granted background windows. */
  background: boolean;
}

const DEFAULTS: DownloadPrefs = { wifiOnly: true, background: false };

export const downloadPrefs$ = persisted$<DownloadPrefs>('comical:dl:prefs-local', DEFAULTS);

/** Non-tracking read for use outside React (the engine). */
export function getDownloadPrefsSync(): DownloadPrefs {
  return downloadPrefs$.peek();
}
