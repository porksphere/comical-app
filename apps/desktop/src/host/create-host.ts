/**
 * The desktop host: the *real* `@comical/host-server` stack, assembled to run inside Electron's
 * main process instead of behind `Bun.serve`.
 *
 * This is a near-copy of `@comical/host-server`'s own `createServer()` (external/comical/packages/
 * host-server/src/server.ts) with two deliberate differences:
 *
 *  1. **No `Bun.serve`.** That is the single Bun-only line in the whole server; everything else —
 *     the Hono router, `BridgeManager`, the `node:vm` bundle evaluator, `FileStorage` — is plain
 *     Node. We return the Hono app instead, and let the caller decide how to expose it (see
 *     `serve()` below and `main.ts`).
 *  2. **A `fetch(path, init)` seam.** `router.fetch` driven directly, no socket — the same
 *     in-process shape `@comical/host-rn`'s embedded transport uses on iOS/Android. The localhost
 *     listener is only there so the *unmodified* web bundle (which speaks HTTP to
 *     `window.__COMICAL_SERVER__`) can talk to us; the IPC path is the one to keep.
 *
 * Bridges execute in `node:vm` contexts here, exactly as they do on a self-hosted server — desktop
 * needs neither the JavaScriptCore harness (iOS) nor the QuickJS one (Android), because Electron
 * already ships a full Node runtime.
 */
import { join } from "node:path";
import { DownloadEngine, Downloads } from "@comical/downloads";
import { DEFAULT_USER_AGENT } from "@comical/host-bun";
import { Library } from "@comical/library";
import { ManifestStore, RegistryManager } from "@comical/registry";
import { ComicalRuntime } from "@comical/runtime";
import { BridgeManager } from "@comical/host-server/bridge-manager";
import { FileBlobStore } from "@comical/host-server/blob-store";
import { FileDownloadsStore } from "@comical/host-server/downloads-store";
import { FileLibraryStore } from "@comical/host-server/library-store";
import { createServerPageFetcher, createServerPageResolver } from "@comical/host-server/page-fetcher";
import { createRouter, type RouterOptions } from "@comical/host-server/router";
import { SettingsStore } from "@comical/host-server/settings-store";
import { TrackerManager } from "@comical/host-server/tracker-manager";

export interface DesktopHostOptions {
  /** Per-user data root — `app.getPath('userData')` in Electron. Holds settings, library,
   *  downloads, the bridge cache and each bridge's own storage namespace. */
  dataDir: string;
  /** Extra directory scanned for local (unpacked) bridge bundles. Registry-installed bridges
   *  land in `{dataDir}/bridge-cache` regardless. */
  bridgesDir?: string | string[];
  /** Base URL handed to bridges as `hostUrl` and used as the OAuth redirect target. Set once the
   *  loopback listener has a port. */
  baseUrl: string;
}

export interface DesktopHost {
  /** The assembled Hono app. `.fetch(Request)` is the whole API surface. */
  router: ReturnType<typeof createRouter>;
  /** In-process transport: a server-relative path in, a `Response` out. No socket involved.
   *  Shape-identical to the app's own `Transport` type in `apps/mobile/src/data/api.ts`. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export function createDesktopHost(opts: DesktopHostOptions): DesktopHost {
  const { dataDir, baseUrl } = opts;

  const settings = new SettingsStore(dataDir);
  const manifest = new ManifestStore(dataDir);
  const registry = new RegistryManager({
    cacheDir: join(dataDir, "bridge-cache"),
    manifest,
  });
  const manager = new BridgeManager({
    bridgesDir: opts.bridgesDir ?? join(dataDir, "bridges"),
    dataDir,
    settings,
    registry,
    hostUrl: baseUrl,
  });

  const routerOpts: RouterOptions = {
    registry,
    callbackBaseUrl: baseUrl,
    userAgent: DEFAULT_USER_AGENT,
    // The renderer is a file:// / app:// page talking to loopback, so it *is* cross-origin.
    // Locked to the loopback origin rather than the server's LAN-friendly "*" default.
    origin: baseUrl,
  };

  routerOpts.trackers = new TrackerManager({ dataDir, settings, registry });

  // Late-bound in-process fetch: the download engine and the cover capture both drive the router
  // directly, but the router can't exist until the options that reference them are assembled.
  let routerFetch: (req: Request) => Response | Promise<Response> = () =>
    new Response(null, { status: 503 });
  const pageFetcher = createServerPageFetcher(() => routerFetch);

  // Desktop gets both optional modules unconditionally — it's a single-user machine with a disk,
  // which is exactly the case they were written for.
  const libDir = join(dataDir, "library");
  const lib = new Library(new FileLibraryStore(libDir));
  routerOpts.library = lib;
  routerOpts.runtime = new ComicalRuntime({
    bridges: manager,
    library: lib,
    trackers: routerOpts.trackers,
    log: console,
  });
  routerOpts.covers = { blobs: new FileBlobStore(join(libDir, "covers")), fetchPage: pageFetcher };

  const dlDir = join(dataDir, "downloads");
  const downloads = new Downloads(new FileDownloadsStore(dlDir));
  const engine = new DownloadEngine({
    downloads,
    blobs: new FileBlobStore(join(dlDir, "blobs")),
    fetchPage: pageFetcher,
    resolvePages: createServerPageResolver(() => routerFetch),
  });
  routerOpts.downloads = downloads;
  routerOpts.downloadEngine = engine;

  const router = createRouter(manager, routerOpts);
  routerFetch = (req) => router.fetch(req);
  engine.kick(); // resume anything the previous run left mid-download

  return {
    router,
    // The origin is arbitrary — the router matches on path only, and nothing leaves the process.
    // Same trick `@comical/host-rn`'s embedded transport uses on iOS/Android.
    fetch: (path, init) =>
      Promise.resolve(router.fetch(new Request(`http://desktop.comical.local${path}`, init))),
  };
}
