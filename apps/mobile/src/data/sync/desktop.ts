/**
 * The desktop app is the hub a phone syncs with, not a device that syncs: its library is its
 * shell's own server's. So a phone's changes land in that server behind the page's back, and the
 * shell says so — the same moment `./index.ts`'s `onApplied` marks on a phone.
 */
import { desktopShell } from '@/lib/desktop-shell';
import { bumpDataEpoch } from '../data-epoch';
import { queryClient } from '../query-client';

let installed = false;

/** Called once from the root layout; nothing outside the desktop shell. */
export function installDesktopSyncRefresh(): void {
  if (installed) return;
  installed = true;
  desktopShell()?.onSynced?.(() => {
    bumpDataEpoch();
    void queryClient.invalidateQueries();
  });
}
