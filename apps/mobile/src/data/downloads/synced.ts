/**
 * A series saved on another device downloads here by THIS device's series toggle, as if it had been
 * saved here. A few arriving together download quietly, the way a save does; more than that in one
 * sync is a pairing (the other device's whole library landing) or a bulk import over there, which
 * is asked about first — the same offer turning the toggle on makes for what's already saved.
 */
import { openConfirm } from '@/components/confirm-popup';
import { showToast } from '@/components/toast';
import { logDiagnostic } from '@/lib/diagnostics';
import { isMockActive } from '../mock';
import { getRealDataSource } from '../source';
import { syncedSeriesBackfill } from './auto';

const QUIET_SERIES = 3;

export function autoDownloadSynced(added: readonly { bridgeId: string; seriesId: string }[]): Promise<void> {
  if (added.length === 0 || isMockActive()) return Promise.resolve();
  return run(added).catch((e: unknown) =>
    logDiagnostic('auto-download', (e as Error)?.message || String(e), { context: 'synced series' }),
  );
}

async function run(added: readonly { bridgeId: string; seriesId: string }[]): Promise<void> {
  const plan = await syncedSeriesBackfill(added);
  if (!plan) return;
  const { series, skipped } = plan.size;
  if (series <= QUIET_SERIES) {
    await plan.download(getRealDataSource());
    return;
  }
  // No chapter estimate: a synced series' chapter list stays on the device that fetched it, so
  // here it is unknown until each one is asked for.
  const skip = skipped === 0 ? '' : ` ${skipped} already downloaded ${skipped === 1 ? 'is' : 'are'} skipped.`;
  openConfirm({
    title: 'Download what just synced?',
    message: `${series} series saved on another device can be downloaded here too.${skip}`,
    confirmLabel: `Download ${series} series`,
    tone: 'primary',
    onConfirm: () => {
      void plan.download(getRealDataSource()).then((n) => showToast(n > 0 ? `Downloading ${n} series` : 'Nothing to download'));
    },
  });
}
