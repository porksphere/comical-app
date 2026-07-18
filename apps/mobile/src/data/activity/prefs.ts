/**
 * Device-local new-chapter notification preferences (Legend State, persisted) — same pattern as
 * `downloads/prefs.ts`. Read synchronously off the React tree by the auto-check and the background
 * task, reactively by the Notifications settings screen.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

export interface NotifyPrefs {
  /** Check for new chapters automatically while the app is open (launch + foreground). */
  autoCheck: boolean;
  /** Let the OS run the chapter check in background windows (native only, opt-in). */
  backgroundCheck: boolean;
  /** Gate the background check to Wi-Fi. */
  wifiOnly: boolean;
  /** Fire a local notification when a background check finds new chapters (needs OS permission). */
  notifications: boolean;
  /** Mirror the unread count onto the app icon (iOS/Android home screen). */
  appBadge: boolean;
}

const DEFAULTS: NotifyPrefs = {
  autoCheck: true,
  backgroundCheck: false,
  wifiOnly: false,
  notifications: false,
  appBadge: true,
};

export const notifyPrefs$ = persisted$<NotifyPrefs>('comical:notify:prefs', DEFAULTS);

/**
 * Reactively read the prefs in a component. `use$` MUST stay wrapped in a custom hook — it doesn't
 * match the `use[A-Z]` name the React Compiler detects hooks by (see `useDownloadPrefs`). Spread
 * over the defaults so a blob persisted before a field existed still surfaces every key.
 */
export function useNotifyPrefs(): NotifyPrefs {
  const value = use$(notifyPrefs$);
  return { ...DEFAULTS, ...value };
}

/** Non-tracking read for use outside React (auto-check, background task, badge sync). */
export function getNotifyPrefsSync(): NotifyPrefs {
  return { ...DEFAULTS, ...notifyPrefs$.peek() };
}
