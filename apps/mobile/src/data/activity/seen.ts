/**
 * The Activity "seen" watermark — when the user last looked at the Activity tab (device-local,
 * persisted). The tab pip / app-icon badge count only items detected AFTER this, so opening the
 * tab clears the badge (inbox semantics) without writing any per-item state: the server filters
 * with `?since=` and each item's `read` flag stays derived from real chapter progress.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

const activitySeen$ = persisted$<{ lastSeenAt: number }>('comical:activity:seen', { lastSeenAt: 0 });

/**
 * Reactively read the watermark. `use$` MUST stay wrapped in a custom hook — it doesn't match the
 * `use[A-Z]` name the React Compiler detects hooks by, so calling it inline in a component lets
 * the compiler reorder its internal `useSyncExternalStore` (see `useDownloadPrefs`).
 */
export function useActivitySeenAt(): number {
  return use$(activitySeen$.lastSeenAt);
}

/** Non-tracking read for use outside React (the background task). */
export function getActivitySeenAtSync(): number {
  return activitySeen$.lastSeenAt.peek();
}

/** The user just looked at the Activity tab — badge counts restart from now. */
export function markActivitySeen(): void {
  activitySeen$.lastSeenAt.set(Date.now());
}
