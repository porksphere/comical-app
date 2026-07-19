/**
 * Background new-chapter checking. Registers an `expo-background-task` that scans the library in
 * OS-granted background windows, fires a local notification when new chapters were found, and keeps
 * the app-icon badge current — so the user hears about releases without opening the app. Opt-in via
 * the device-local `backgroundCheck` pref (Settings → Notifications).
 *
 * Platform reality (mirrors `downloads/background.ts`): the cadence is the OS's, not ours —
 * Android's WorkManager honors ~15-min-plus intervals; iOS's BGTaskScheduler is opportunistic and
 * can wait hours. The scan itself is budgeted (20s) to fit iOS's short windows: entries are synced
 * stalest-first and a truncated (`partial`) run simply resumes in the next window. The foreground
 * auto-check (`./auto-check.ts`) remains the reliable freshness path.
 */
import * as BackgroundTask from 'expo-background-task';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { startEmbeddedRuntime } from '@/data/embedded/startup';
import * as api from '../api';
import { isMockActive } from '../mock';
import { syncAppBadge } from './app-badge';
import { getNotifyPrefsSync } from './prefs';

export const CHAPTER_CHECK_TASK = 'comical.chapters.check';

/** Wall-clock budget for the scan — fits inside iOS's ~30s background windows with headroom. */
const SYNC_BUDGET_MS = 20_000;
/** Ask the OS for hourly runs (minutes). A floor, not a schedule — see the header. */
const MINIMUM_INTERVAL_MIN = 60;

const isNative = Platform.OS !== 'web';

// Define the task at module load (a background launch must find it registered). Guarded so importing
// this module on web — where TaskManager has no native backing — can never throw at startup.
if (isNative) {
  try {
    TaskManager.defineTask(CHAPTER_CHECK_TASK, () => runChapterCheck());
  } catch {
    // Native module unavailable (e.g. before the config-plugin build) — background stays off.
  }
}

/**
 * One background pass: scan → notify → badge. Exported for testing/manual trigger.
 *
 * A headless launch does NOT mount `_layout.tsx`, so the transport must be bootstrapped here —
 * `startEmbeddedRuntime()` is idempotent and installs whichever transport the user configured
 * (on-device runtime, or remote for a configured server).
 */
export async function runChapterCheck(): Promise<BackgroundTask.BackgroundTaskResult> {
  try {
    startEmbeddedRuntime();
    const prefs = getNotifyPrefsSync();
    // Belt-and-braces: the toggle unregisters the task, but an OS-cached registration may still fire.
    if (!prefs.backgroundCheck || isMockActive()) return BackgroundTask.BackgroundTaskResult.Success;
    if (prefs.wifiOnly && !(await onWifi())) return BackgroundTask.BackgroundTaskResult.Success;

    const res = await api.runBackgroundSync({ budgetMs: SYNC_BUDGET_MS, trackers: false });

    if (res.newChapters > 0 && prefs.notifications) await notifyNewChapters(res.newChapters);
    // Same whole-feed unread count as the tab pip, so the icon and the in-app badge always agree.
    const { unread } = await api.getActivityCount();
    syncAppBadge(unread);

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

async function onWifi(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.WIFI && state.isConnected !== false;
  } catch {
    return true; // if we can't tell, don't silently starve the check (mirrors mayDownloadNow)
  }
}

/** Fire a local notification summarizing this run's finds ("One Piece, Berserk and 2 more"). */
async function notifyNewChapters(count: number): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('new-chapters', {
        name: 'New chapters',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const chapters = `${count} new chapter${count === 1 ? '' : 's'}`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New chapters',
        body: (await seriesSummary()) ?? `${chapters} in your library`,
      },
      // A channel-only trigger delivers immediately on that channel; null = immediate on default
      // (iOS has no channels).
      trigger: Platform.OS === 'android' ? { channelId: 'new-chapters' } : null,
    });
  } catch {
    // Notification failure never fails the check.
  }
}

/** Names of the most recent unread finds, e.g. "One Piece, Berserk and 2 more". Null on any miss. */
async function seriesSummary(): Promise<string | null> {
  try {
    const items = await api.getActivity();
    const titles: string[] = [];
    for (const item of items) {
      if (item.read) continue;
      if (!titles.includes(item.title)) titles.push(item.title);
    }
    if (titles.length === 0) return null;
    if (titles.length <= 3) return titles.join(', ');
    return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
  } catch {
    return null;
  }
}

/** Register the chapter-check task (idempotent). No-op on web / when the API is restricted. */
export async function registerChapterCheck(): Promise<void> {
  if (!isNative) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(CHAPTER_CHECK_TASK)) return;
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    await BackgroundTask.registerTaskAsync(CHAPTER_CHECK_TASK, { minimumInterval: MINIMUM_INTERVAL_MIN });
  } catch {
    // Best-effort — a registration failure just means checks only run in the foreground.
  }
}

/** Unregister the chapter-check task (idempotent). */
export async function unregisterChapterCheck(): Promise<void> {
  if (!isNative) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(CHAPTER_CHECK_TASK)) {
      await BackgroundTask.unregisterTaskAsync(CHAPTER_CHECK_TASK);
    }
  } catch {
    // ignore
  }
}

/** Apply the user's background-check preference. */
export function applyChapterCheck(enabled: boolean): void {
  void (enabled ? registerChapterCheck() : unregisterChapterCheck());
}
