/**
 * Headless proof that the desktop host works outside Electron: same modules `main.ts` loads, no
 * BrowserWindow. Bundled to CJS and run under plain `node` (not Bun) — Electron's main process is
 * Node, so that's the runtime that has to be satisfied.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryLibraryStore, Library } from "@comical/library";
import {
  HttpBackend,
  librarySyncStore,
  pair,
  SyncEngine,
  SyncPairingError,
  SyncUnlinkedError,
  wrapLibraryStore,
  type StoredPairing,
} from "@comical/sync";
import { createDesktopHost } from "../src/host/create-host.ts";
import { startLoopbackServer } from "../src/host/serve.ts";
import { createSyncGate, startSyncListener } from "../src/host/sync-listener.ts";

async function main(): Promise<void> {
  const WEB_ROOT = process.env.COMICAL_WEB_ROOT ?? join(__dirname, "..", "build", "web");
  const dataDir = await mkdtemp(join(tmpdir(), "comical-smoke-"));
  let failures = 0;

  function check(name: string, ok: boolean, detail?: unknown): void {
    console.log(`${ok ? "  ok  " : " FAIL "} ${name}${ok || detail === undefined ? "" : ` — ${String(detail)}`}`);
    if (!ok) failures++;
  }

  console.log(`runtime: ${process.release?.name ?? "?"} ${process.version}`);
  console.log(`dataDir: ${dataDir}`);

  let host: ReturnType<typeof createDesktopHost> | null = null;
  // Point the local-bridge scan at the submodule's example bridges so this can exercise real bridge
  // execution. `test-sprites` needs no network and no credentials — it renders synthetic pages out
  // of two SVG sprite sheets the router itself serves — which makes it the one bridge that proves
  // the whole chain (discover → node:vm evaluate → call → route) with nothing external involved.
  // Honours COMICAL_BRIDGES_DIR like main.ts does, so CI and a local run point at one place.
  // These are SOURCE dirs until `bun run build` in the submodule compiles each to dist/bridge.js —
  // the pre-compiled CJS the node:vm evaluator actually loads. Without that the three
  // bridge-execution checks below have no fixture and fail with "not found in .../bridges".
  const EXAMPLE_BRIDGES =
    process.env.COMICAL_BRIDGES_DIR ??
    join(__dirname, "..", "..", "..", "external", "comical", "bridges");
  const server = await startLoopbackServer({ getHost: () => host, webRoot: WEB_ROOT });
  let synced = 0;
  host = createDesktopHost({
    dataDir,
    bridgesDir: EXAMPLE_BRIDGES,
    baseUrl: `${server.origin}/api`,
    onSynced: () => synced++,
  });
  console.log(`origin:  ${server.origin}\n`);

  const authed = (path: string, init: RequestInit = {}) =>
    fetch(`${server.origin}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${server.token}` },
    });

  // 1. The host answers the REST surface the app speaks.
  const bridges = await authed("/api/bridges");
  check("GET /api/bridges → 200", bridges.status === 200, bridges.status);
  const list = await bridges.json().catch(() => null);
  check("…returns a bridge array (empty until one is installed)", Array.isArray(list), JSON.stringify(list));

  // 2. In-process transport: the same router, no socket. This is Milestone 2's whole mechanism.
  const direct = await host.fetch("/bridges");
  check("host.fetch('/bridges') in-process → 200", direct.status === 200, direct.status);

  // 3. Registry endpoints are mounted (this is how bridges get installed at runtime).
  const registries = await authed("/api/registries");
  check("GET /api/registries → 200", registries.status === 200, registries.status);

  // 4. The optional modules the desktop host turns on unconditionally.
  const library = await authed("/api/library/collected");
  check("GET /api/library/collected mounted (not 404)", library.status !== 404, library.status);
  const downloads = await authed("/api/downloads");
  check("GET /api/downloads mounted (not 404)", downloads.status !== 404, downloads.status);

  // 5. The real thing: a bridge bundle discovered on disk, evaluated in a `node:vm` context, and
  //    called through the router. Desktop needs neither the JavaScriptCore harness (iOS) nor the
  //    QuickJS one (Android) — Electron's main process already is a full Node.
  const ids = (list as { info?: { id?: string } }[] | null)?.map((b) => b?.info?.id) ?? [];
  check("local bridges discovered from disk", ids.includes("test-sprites"), ids.join(", ") || "none");

  const B = "/api/bridges/test-sprites";
  const lists = await authed(`${B}/lists`);
  check("GET /bridges/test-sprites/lists → 200 (bridge ran in node:vm)", lists.status === 200, lists.status);
  const listBody = (await lists.json().catch(() => null)) as { id?: string }[] | { lists?: { id?: string }[] } | null;
  const listId = (Array.isArray(listBody) ? listBody[0]?.id : listBody?.lists?.[0]?.id) ?? undefined;
  check("…the bridge advertises at least one list", Boolean(listId), JSON.stringify(listBody)?.slice(0, 160));

  if (listId) {
    const page = await authed(`${B}/lists/${encodeURIComponent(listId)}`);
    check(`GET /bridges/test-sprites/lists/${listId} → 200`, page.status === 200, page.status);
    const body = (await page.json().catch(() => null)) as { items?: { id?: string }[] } | null;
    const seriesId = body?.items?.[0]?.id;
    check("…the list returned series", Boolean(seriesId), JSON.stringify(body)?.slice(0, 160));

    if (seriesId) {
      const sid = encodeURIComponent(seriesId);
      const series = await authed(`${B}/series/${sid}`);
      check("GET …/series/:id → 200", series.status === 200, series.status);

      // `test-sprites` is a direct-pages bridge (no chapter layer), so pages hang off the series.
      const pages = await authed(`${B}/series/${sid}/pages`);
      check("GET …/series/:id/pages → 200", pages.status === 200, pages.status);
      const pgBody = (await pages.json().catch(() => null)) as { pages?: unknown[] } | unknown[] | null;
      const count = Array.isArray(pgBody) ? pgBody.length : (pgBody?.pages?.length ?? 0);
      check("…page list resolved end-to-end", count > 0, count);
    }
  }

  // A router-served binary asset over the loopback — the same path comic page bytes take
  // (`/img-proxy`, `/downloads/.../file`), which is the one thing a reader can't do without.
  const sheet = await authed("/api/test-sprite.svg");
  const sheetBytes = sheet.status === 200 ? (await sheet.arrayBuffer()).byteLength : 0;
  check("binary asset route serves bytes", sheetBytes > 0, `${sheet.status} / ${sheetBytes}B`);

  const missing = await authed("/api/bridges/definitely-not-installed/home");
  check("unknown bridge → 4xx, not a crash", missing.status >= 400 && missing.status < 500, missing.status);

  // 6. The loopback port is not an open door.
  const unauth = await fetch(`${server.origin}/api/bridges`);
  check("request without the launch token → 401", unauth.status === 401, unauth.status);

  // 7. The renderer is served, with the server URL injected the way the container entrypoint does it.
  const index = await authed("/");
  if (index.status === 404) {
    console.log("  skip  renderer checks — run `bun run build:web` first");
  } else {
    const html = await index.text();
    check("GET / → 200 text/html", index.status === 200 && (index.headers.get("content-type") ?? "").includes("text/html"), index.status);
    check("…has window.__COMICAL_SERVER__ injected", html.includes("window.__COMICAL_SERVER__="), false);
    check("…points at this origin's /api", html.includes(`${server.origin}/api`), false);
    check("…asset paths are root-relative (baseUrl patched out)", !html.includes('"/comical-app/'), false);
    const escape = await authed("/../../../etc/passwd");
    check("path traversal is refused", escape.status === 404 || escape.status === 403, escape.status);
  }

  // 8. A phone's way in: the sync routes alone, on the network, each phone sealed under a key of
  //    its own that a one-time code got it.
  let savedPairings: StoredPairing[] = [];
  const gate = createSyncGate({ getHost: () => host, pairings: [], save: (pairings) => (savedPairings = pairings) });
  const lan = await startSyncListener({ gate, port: 0 });
  const address = await lan.address();
  check("the sync listener has an address to hand a phone", Boolean(address), address);
  // Whatever interface that names, the listener is on all of them — loopback is the one a CI
  // runner is sure to have.
  const local = address ? `http://127.0.0.1:${new URL(address).port}` : "";
  const viaFetch = (url: string, init?: RequestInit) => fetch(url, init);
  const post = (path: string, body: string) =>
    fetch(`${local}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
  const probe = { device: "smoke-probe", name: "Smoke probe", have: {} };

  const { code } = gate.openCode();
  const pairing = await pair({ baseUrl: local, fetch: viaFetch, code, name: "Smoke phone" });
  check("a phone pairs with the code on screen, and is listed", gate.devices().map((d) => d.name).join() === "Smoke phone", JSON.stringify(gate.devices()));
  check("…under a key the shell is handed to keep", savedPairings.some((p) => p.id === pairing.id && p.key === pairing.key), savedPairings.length);
  const reused = await pair({ baseUrl: local, fetch: viaFetch, code, name: "Second phone" }).catch((err: unknown) => err);
  check("…and the code doesn't work twice", reused instanceof SyncPairingError, String(reused));
  const closed = gate.openCode().code;
  gate.closeCode();
  const late = await pair({ baseUrl: local, fetch: viaFetch, code: closed, name: "Late phone" }).catch((err: unknown) => err);
  check("…nor one taken off the screen", late instanceof SyncPairingError, String(late));

  const paired = new HttpBackend({ baseUrl: local, pairing, fetch: viaFetch });
  const pulled = await paired.pull({ device: "smoke-phone", name: "Smoke phone", have: {} }).catch((err: unknown) => err);
  check("a pull sealed under the phone's key is answered", !(pulled instanceof Error), String(pulled));
  const stranger = new HttpBackend({ baseUrl: local, pairing: { id: pairing.id, key: Buffer.alloc(32, 7).toString("base64") }, fetch: viaFetch });
  const forged = await stranger.pull(probe).catch((err: unknown) => err);
  check("…one sealed under another key is not", forged instanceof Error, String(forged));
  const clear = await post("/sync/pull", JSON.stringify(probe));
  check("…in the clear → 404", clear.status === 404, clear.status);
  const codeInPath = await post(`/${code}/sync/pull`, JSON.stringify(probe));
  check("…the code in the path → 404", codeInPath.status === 404, codeInPath.status);
  const beyond = await fetch(`${local}/bridges`);
  check("…nothing but sync is there", beyond.status === 404, beyond.status);

  // A phone's whole exchange: its own engine, the app's own client, one new collection.
  const phoneStore = new InMemoryLibraryStore();
  const phone = new SyncEngine({
    store: librarySyncStore(phoneStore),
    backend: paired,
    device: "smoke-phone",
    name: () => "Smoke phone",
    newDeviceId: () => "smoke-phone-2",
  });
  await new Library(wrapLibraryStore(phoneStore, phone)).createCollection("From a phone");
  const round = await phone.sync().catch((err: unknown) => err);
  check("a phone's change is pushed", ((round as { pushed?: number }).pushed ?? 0) > 0, JSON.stringify(round));
  let landed = false;
  for (let i = 0; i < 50 && !landed; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const collections = (await (await authed("/api/library/collections")).json().catch(() => null)) as { name?: string }[] | null;
    landed = Array.isArray(collections) && collections.some((c) => c.name === "From a phone");
  }
  check("…and lands in the desktop's library", landed);
  // Said once the round that applied it is over, a moment after the write itself.
  for (let i = 0; i < 20 && synced === 0; i++) await new Promise((r) => setTimeout(r, 100));
  check("…and the shell is told to refresh its page", synced > 0, synced);
  check("…and the phone is listed as having synced", gate.devices()[0]?.lastSeenAt != null, JSON.stringify(gate.devices()));

  // A second phone, so unlinking one can be seen to leave the other alone.
  const other = new HttpBackend({
    baseUrl: local,
    pairing: await pair({ baseUrl: local, fetch: viaFetch, code: gate.openCode().code, name: "Other phone" }),
    fetch: viaFetch,
  });
  check("unlinking a phone takes it off the list", gate.unlink(pairing.id) && gate.devices().map((d) => d.name).join() === "Other phone", JSON.stringify(gate.devices()));
  const cutOff = await paired.pull({ device: "smoke-phone", name: "Smoke phone", have: {} }).catch((err: unknown) => err);
  check("…and it is told so when it next syncs", cutOff instanceof SyncUnlinkedError, String(cutOff));
  const untouched = await other.pull({ device: "other-phone", name: "Other phone", have: {} }).catch((err: unknown) => err);
  check("…while the other phone carries on", !(untouched instanceof Error), String(untouched));
  await other.unpair();
  check("a phone that unpairs itself is gone from the list", gate.devices().length === 0, JSON.stringify(gate.devices()));

  await lan.close();
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);

}

void main();
