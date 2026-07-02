/**
 * The embedded `Transport`: resolve `api.ts`'s server-relative paths in-process by driving the
 * reused `@comical/host-server` router with a plain `Request` — no socket, no external URI. This is
 * the same router the remote server runs; only the `BridgeProvider` differs (proxy bridges backed
 * by the native engine instead of `loadBridge`d bundles). `createRouter` is injected so this module
 * stays free of host-server's node-typed imports (see types.ts).
 *
 * `cors: false`: CORS is meaningless in-process, and Hono's post-response header tweak re-wraps the
 * Response via `new Response(res.body, …)` where `res.body` (a ReadableStream) is `null` under React
 * Native — which silently empties the body. Disabling CORS keeps the original string-bodied Response.
 *
 * Body read-back: read the response to text and hand `api.ts` a minimal response whose `json()`/
 * `text()` return that string (the only members api.ts uses), avoiding any RN Response body quirks.
 */
import type { Transport } from '../api';
import type { BridgeProvider, CreateRouter } from './types';

/** Base is arbitrary — the router matches on path only; nothing leaves the device. */
const EMBEDDED_ORIGIN = 'http://embedded.comical.local';

export function createEmbeddedTransport(provider: BridgeProvider, createRouter: CreateRouter): Transport {
  const router = createRouter(provider, { cors: false });
  return async (path, init) => {
    const routed = await router.fetch(new Request(`${EMBEDDED_ORIGIN}${path}`, init));
    const body = await routed.text();
    return {
      ok: routed.status >= 200 && routed.status < 300,
      status: routed.status,
      statusText: routed.statusText,
      json: async () => (body ? JSON.parse(body) : undefined),
      text: async () => body,
    } as unknown as Response;
  };
}
