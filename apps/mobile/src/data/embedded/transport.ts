/**
 * The embedded `Transport`: resolve `api.ts`'s server-relative paths in-process by driving the
 * reused `@comical/host-server` router with a plain `Request` — no socket, no external URI. This is
 * the same router the remote server runs; only the `BridgeProvider` differs (proxy bridges backed
 * by the native engine instead of `loadBridge`d bundles). `createRouter` is injected so this module
 * stays free of host-server's node-typed imports (see types.ts).
 */
import type { Transport } from '../api';
import type { BridgeProvider, CreateRouter } from './types';

/** Base is arbitrary — the router matches on path only; nothing leaves the device. */
const EMBEDDED_ORIGIN = 'http://embedded.comical.local';

export function createEmbeddedTransport(provider: BridgeProvider, createRouter: CreateRouter): Transport {
  const router = createRouter(provider, { origin: '*' });
  return (path, init) => Promise.resolve(router.fetch(new Request(`${EMBEDDED_ORIGIN}${path}`, init)));
}
