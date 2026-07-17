/**
 * Background download draining (Phase 5). Registers an `expo-background-task` that drains the queue in
 * OS-granted background windows, so a download continues after the app is backgrounded and resumes
 * across launches. Opt-in via the device-local `background` pref.
 *
 * Known platform constraint (surfaced deliberately): iOS background execution is opportunistic and
 * time-limited — `expo-background-task` runs on the OS's periodic scheduler, not a long-running
 * `URLSession` background session. So a large download runs mainly in the foreground and *continues*
 * in short granted windows; the manifest persists the queue so an interruption resumes next launch.
 * Android can grant longer windows. Everything here is native-only and defensively guarded — on web
 * (and before a native build ships the config plugin) it is inert.
 */
import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { drain } from './engine';

export const BACKGROUND_DOWNLOAD_TASK = 'comical.downloads.drain';

const isNative = Platform.OS !== 'web';

// Define the task at module load (a background launch must find it registered). Guarded so importing
// this module on web — where TaskManager has no native backing — can never throw at startup.
if (isNative) {
  try {
    TaskManager.defineTask(BACKGROUND_DOWNLOAD_TASK, async () => {
      try {
        await drain();
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });
  } catch {
    // Native module unavailable (e.g. before the config-plugin build) — background stays off.
  }
}

/** Register the background drain task (idempotent). No-op on web / when the API is restricted. */
export async function registerBackgroundDownloads(): Promise<void> {
  if (!isNative) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_DOWNLOAD_TASK)) return;
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_DOWNLOAD_TASK);
  } catch {
    // Best-effort — a registration failure just means downloads only run in the foreground.
  }
}

/** Unregister the background drain task (idempotent). */
export async function unregisterBackgroundDownloads(): Promise<void> {
  if (!isNative) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_DOWNLOAD_TASK)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_DOWNLOAD_TASK);
    }
  } catch {
    // ignore
  }
}

/** Apply the user's background preference. */
export function applyBackgroundDownloads(enabled: boolean): void {
  void (enabled ? registerBackgroundDownloads() : unregisterBackgroundDownloads());
}
