/**
 * The desktop host: the *real* `@comical/host-server` stack, assembled to run inside Electron's
 * main process instead of behind `Bun.serve`.
 *
 * `@comical/host-server/host`'s `createHost()` is exactly that assembly — the Hono router,
 * `BridgeManager`, registry, settings, library + runtime, sync hub, download engine — with no
 * listener; `createServer()` is only `createHost()` + `Bun.serve`. This file is the thin desktop
 * shaping of it: every optional module on (a single-user machine with a disk is what they were
 * written for), CORS locked to the loopback origin, and the `fetch(path, init)` seam the IPC path
 * uses (the same in-process shape `@comical/host-rn`'s embedded transport has on iOS/Android).
 *
 * Bridges execute in `node:vm` contexts here, exactly as they do on a self-hosted server — desktop
 * needs neither the JavaScriptCore harness (iOS) nor the QuickJS one (Android), because Electron
 * already ships a full Node runtime.
 */
import { createHost, type ComicalHost, type HostOptions } from "@comical/host-server/host";

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
  /** Another device's changes have just landed in this library or its bridges. */
  onSynced?: HostOptions["onSynced"];
}

/** `router.fetch(Request)` is the whole API surface; `fetch(path)` drives it with no socket;
 *  `close()` stops the download engine and schedules no more sync rounds. */
export type DesktopHost = ComicalHost;

export function createDesktopHost(opts: DesktopHostOptions): DesktopHost {
  return createHost({
    dataDir: opts.dataDir,
    ...(opts.bridgesDir ? { bridgesDir: opts.bridgesDir } : {}),
    hostUrl: opts.baseUrl,
    // The renderer is a file:// / app:// page talking to loopback, so it *is* cross-origin.
    // Locked to the loopback origin rather than the server's LAN-friendly "*" default.
    origin: opts.baseUrl,
    library: true,
    // Always a sync hub, as `createServer({ sync: true })` is: the routes cost nothing while only
    // the loopback can reach them, and `sync-listener.ts` is what lets a phone in.
    sync: true,
    ...(opts.onSynced ? { onSynced: opts.onSynced } : {}),
    downloads: true,
  });
}
