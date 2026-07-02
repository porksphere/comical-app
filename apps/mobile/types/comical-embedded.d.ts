/**
 * Ambient declarations for the Node-free `@comical/*` subpaths the embedded runtime imports at
 * startup (native only). These are resolved by Metro at bundle time (see metro.config.js
 * extraNodeModules + package `exports`), but we declare their types here — rather than adding
 * tsconfig `paths` to the submodule source — so `tsc` doesn't compile the whole hono/@comical graph
 * under the app's strict config. The signatures mirror the app-side contracts in
 * `src/data/embedded/`; the real implementations come from the comical submodule.
 */
declare module '@comical/host-server/router' {
  import type { CreateRouter } from '@/data/embedded/types';
  export const createRouter: CreateRouter;
}

declare module '@comical/registry/fetcher' {
  import type { RegistryFetcher } from '@/data/embedded/registry-bundle-source';
  export const fetchIndex: RegistryFetcher['fetchIndex'];
  export const downloadBundle: RegistryFetcher['downloadBundle'];
}
