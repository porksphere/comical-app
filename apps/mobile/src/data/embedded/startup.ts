/**
 * Native startup wiring for the embedded runtime (the `.web.ts` sibling is a no-op — web is always
 * remote). Injects the built comical packages — `@comical/host-server`'s `createRouter` and
 * `@comical/registry`'s fetcher, imported from their Node-free subpaths — into the embedded runtime,
 * then installs the embedded transport if the persisted preference says on-device (and the native
 * engine is present). Safe to call when the native module isn't linked: it resolves to remote.
 *
 * Called once from `_layout.tsx` at app launch. This is the single place the app depends on the
 * comical submodule at runtime; Metro bundles these subpaths on native only (see metro.config.js).
 */
import { createRouter } from '@comical/host-server/router';
import { downloadBundle, fetchIndex } from '@comical/registry/fetcher';
import { applyEmbeddedMode, configureEmbeddedRuntime, getResolvedModeSync } from './index';

/** Registry the on-device runtime downloads bridge bundles from. Override with the env var. */
const REGISTRY_INDEX_URL =
  process.env.EXPO_PUBLIC_COMICAL_REGISTRY ??
  'https://raw.githubusercontent.com/bridges-repo/main/index.json';

let started = false;

export function startEmbeddedRuntime(): void {
  if (started) return;
  started = true;
  configureEmbeddedRuntime({
    createRouter,
    fetcher: { fetchIndex, downloadBundle },
    indexUrl: REGISTRY_INDEX_URL,
  });
  // Apply the persisted preference (no-ops to remote when the native engine is unavailable).
  applyEmbeddedMode(getResolvedModeSync() === 'embedded');
}
