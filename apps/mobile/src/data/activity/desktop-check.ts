/**
 * The desktop app's background check — the `backgroundCheck` pref, which on a phone is an OS task
 * (`./background.ts`). The desktop has no such task, and needs none: with the tray on, the app keeps
 * running with its window hidden, which is exactly where the foreground auto-check never fires,
 * since a hidden page never comes back to `active`. So it's a timer in the page, which a hidden
 * window keeps running.
 */
import { desktopShell, notifyDesktop } from '@/lib/desktop-shell';
import * as api from '../api';
import { isMockActive } from '../mock';
import { refreshAfterSync } from './auto-check';
import { feedCounts } from './feed-counts';
import { NEW_CHAPTERS_TITLE, newChaptersBody } from './notice';
import { getNotifyPrefsSync } from './prefs';

const CHECK_EVERY_MS = 60 * 60 * 1000;

let installed = false;

/** Called once from the root layout; nothing outside the desktop shell. */
export function installDesktopChapterCheck(): void {
  if (installed || !desktopShell()) return;
  installed = true;
  setInterval(() => void run(), CHECK_EVERY_MS);
}

async function run(): Promise<void> {
  const prefs = getNotifyPrefsSync();
  if (!prefs.backgroundCheck || isMockActive()) return;
  try {
    const res = await api.runBackgroundSync({});
    refreshAfterSync(res);
    // Someone looking at the app already has the Activity badge in front of them.
    const { announced } = feedCounts(res, prefs.caughtUpOnly);
    if (announced > 0 && prefs.notifications && !document.hasFocus()) {
      notifyDesktop(NEW_CHAPTERS_TITLE, await newChaptersBody(announced), '/activity');
    }
  } catch {
    // Offline is an ordinary state; the next hour tries again.
  }
}
