/**
 * The desktop app is the hub a phone syncs with, not a device that syncs: its library is its
 * shell's own server's. So a phone's changes land in that server behind the page's back, and the
 * shell says so — the same moment `./index.ts`'s `onApplied` marks on a phone. The series those
 * changes added wait in the shell until taken, so one that synced while the page was loading still
 * gets this device's auto-download.
 */
import { autoDownloadSynced } from '../downloads/synced';
import { desktopShell } from '@/lib/desktop-shell';
import { queryClient } from '../query-client';
import { refreshAfterSync } from './refresh';

let installed = false;

/** Called once from the root layout; nothing outside the desktop shell. */
export function installDesktopSyncRefresh(): void {
  if (installed) return;
  installed = true;
  const shell = desktopShell();
  const takeAdded = () => {
    void shell?.takeSyncedSeries?.().then(autoDownloadSynced, () => {});
  };
  shell?.onSynced?.((tables) => {
    refreshAfterSync(queryClient, tables);
    takeAdded();
  });
  takeAdded();
}
