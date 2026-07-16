/**
 * Web has no on-device JS engine for bridges, so the embedded runtime is never installed — the app
 * stays on the remote transport. This keeps `_layout.tsx`'s `startEmbeddedRuntime()` call
 * platform-agnostic. What web DOES get is server-managed downloads: warm the offline index from the
 * remote server's storage tree and subscribe to its SSE progress stream, so downloading works in the
 * browser against a host-server that runs the download engine.
 */
import { installDownloadProgress } from '../downloads/events';
import { hydrateDownloadIndex } from '../downloads/index-cache';

let started = false;

export function startEmbeddedRuntime(): void {
  if (started) return;
  started = true;
  void hydrateDownloadIndex();
  installDownloadProgress();
}
