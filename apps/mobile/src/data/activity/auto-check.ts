/**
 * Foreground auto-check: scan the library for new chapters shortly after launch and whenever the
 * app returns to the foreground, so the Activity feed and badge stay fresh without the user ever
 * pressing "Check for updates". Cheap by construction — the call carries no `force`, so the host's
 * staleness window (6h) skips recently-synced entries and a fresh library returns in one store
 * read; a local 15-min throttle keeps rapid foreground flips from even issuing the request.
 *
 * This is the reliable freshness path on every platform (web included); the OS background task
 * (`./background.ts`, native only) is the best-effort extra on top.
 */
import { AppState } from 'react-native';

import { persisted$ } from '@/lib/observable';
import * as api from '../api';
import { isMockActive } from '../mock';
import { queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { getNotifyPrefsSync } from './prefs';

const THROTTLE_MS = 15 * 60 * 1000;
/** Let the cold-start queries (home, library) land before contending for the transport. */
const LAUNCH_DELAY_MS = 5000;

// Persisted so an app relaunch inside the throttle window doesn't re-scan either.
const lastAutoCheckAt$ = persisted$<number>('comical:activity:lastAutoCheck', 0);

let installed = false;

/** Wire the launch + foreground triggers. Called once from the root layout (all platforms). */
export function installActivityAutoCheck(): void {
  if (installed) return;
  installed = true;
  setTimeout(() => void run(), LAUNCH_DELAY_MS);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void run();
  });
}

async function run(): Promise<void> {
  if (isMockActive()) return; // demo/mock source — nothing real to scan
  if (!getNotifyPrefsSync().autoCheck) return;
  const now = Date.now();
  if (now - lastAutoCheckAt$.peek() < THROTTLE_MS) return;
  // Claim the slot before the request so overlapping triggers (launch timer + a quick
  // background/foreground flip) can't double-fire; a failed check just waits out the window.
  lastAutoCheckAt$.set(now);
  try {
    const res = await api.runBackgroundSync({});
    // mock=false throughout: this never runs against the mock source (guard above).
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity(false) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(false) });
    // Unread counts on library cards moved too — but only bother when something changed.
    if (res.newChapters > 0 || res.readSynced > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(false) });
    }
  } catch {
    // Best-effort: offline or no server reachable is a normal state, never surface an error.
  }
}
