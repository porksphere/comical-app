# Comical desktop — Electron spike

A **working spike**, not a shipping app: the existing web UI in an Electron window, with the
Comical host running **in-process** so the desktop build needs no server, no Docker, and no
account — the same "everything on-device" story iOS and Android already have.

```bash
bun run setup                # once, from the repo root (submodule + deps)
cd apps/desktop
bun run build                # web export → build/web, main process → build/main.cjs
bun run start                # build + launch Electron
```

Two checks, both runnable headlessly:

```bash
bun run smoke                # host + loopback under plain node, 22 assertions, no Electron
bun run launch-check         # launches Electron, asserts the app actually mounted
                             # headless: xvfb-run -a bun run launch-check
```

To have something on the home screen before you've added a registry, point the local-bridge scan
at the submodule's examples — `test-sprites` needs no network:

```bash
COMICAL_BRIDGES_DIR=../../external/comical/bridges bun run start
```

---

## Why Electron

The interesting fact about this codebase is that **the desktop host already exists**. Three pieces
that were built for other reasons line up exactly:

| Piece | Written for | What desktop needs |
| --- | --- | --- |
| `@comical/host-server` | the self-hosted Docker backend | the same REST surface, per-user |
| `@comical/host-bun` | "desktop/CLI host adapter" | `node:fs` storage + `fetch` — **zero `Bun.*` calls in it** |
| `NodeVmEvaluator` (`@comical/core`) | the server's bridge sandbox | a JS engine to run bridges in |

Bridges are pre-compiled CJS evaluated through a swappable `BundleEvaluator`. iOS needs a
JavaScriptCore harness for that, Android a QuickJS one — **Electron needs neither**, because its
main process is a full Node and `node:vm` is already the registered default evaluator. Desktop is
the one platform where the on-device runtime requires no new native work at all.

That's the argument against the alternatives:

- **Tauri** (Rust shell, system WebView). Smaller binaries, but no Node in the shell — the entire
  host layer would need either a sidecar Bun/Node binary (giving the size back) or a port of
  `host-server` to Rust. It also swaps one browser engine for three (WebKitGTK / WKWebView /
  WebView2), and react-native-web is currently only exercised against Chromium.
- **react-native-windows / -macos.** Would reuse the screens, but Expo SDK 56 with the New
  Architecture, `expo-router`, `expo-image`, `expo-blur`, `expo-symbols` and Reanimated 4 has no
  realistic story there, and it leaves Linux out entirely.
- **A PWA.** No Node, so still no local bridge execution — it can't deliver the "no server
  required" part, which is the whole reason to ship desktop at all.

Electron also means the renderer is Chromium, which is the engine the web build is already tested
against. The desktop app is the shipped web bundle plus a private backend — this is roughly
Obsidian's shape, yes.

## How the spike is put together

```
Electron main (Node)
├── createDesktopHost()        src/host/create-host.ts
│     BridgeManager + RegistryManager + Library + Downloads + TrackerManager + Hono router
│     bridges evaluated in node:vm · storage under app.getPath('userData')/comical
└── startLoopbackServer()      src/host/serve.ts     127.0.0.1:<ephemeral>
      ├── /api/*  → router.fetch (prefix stripped)
      └── /*      → apps/mobile's `expo export --platform web` output, unmodified
                    with window.__COMICAL_SERVER__ injected per request
Renderer (Chromium) ── loads http://127.0.0.1:<port>/ ── same origin as its API, so no CORS
```

**`apps/mobile` is untouched.** The renderer is the same static export the container image ships,
and it already reads its backend URL from `window.__COMICAL_SERVER__` at runtime — which is what
`docker-entrypoint.sh` writes in with `sed` at container start. Here the loopback server injects it
per request instead, so the ephemeral port is fine. `create-host.ts` is a near-copy of
`@comical/host-server`'s own `createServer()`; the only Bun-only line in that file is the final
`Bun.serve`, and this replaces it.

The one export-time difference: `app.json`'s `experiments.baseUrl` is `/comical-app` for GitHub
Pages, so `scripts/build-web.ts` patches it to `''` and restores it afterwards — exactly what
`Dockerfile` does for the web image.

Bridges execute with the same capabilities and the same sandbox as on a self-hosted server, so a
desktop install is as capable as the Docker stack: local library, downloads with a real engine
(the host owns the bytes), registries, trackers.

## What the spike proves — and what it doesn't

Verified (`bun run smoke`, under **plain node**, not Bun — Electron's main process is Node):

- the whole `@comical/*` stack bundles for Node in one `bun build --target=node` pass (108 modules,
  ~480 KB) and boots
- bridges are discovered on disk, evaluated in `node:vm`, and answer through the router —
  `lists` → `lists/:id` → `series/:id` → `pages` end-to-end against `test-sprites`
- `/registries`, `/library/*`, `/downloads` all mounted; a binary asset route serves real bytes
- the in-process `host.fetch(path)` seam works with no socket at all (this is Milestone 2's
  mechanism, already exercised)
- the loopback rejects any request without the launch token, and refuses path traversal
- the renderer gets `window.__COMICAL_SERVER__` pointed at this launch's own origin

Verified (`bun run launch-check`, Electron under Xvfb): the window loads, React mounts (155 nodes),
and the app chrome plus a bridge-backed home row render.

Not addressed — this is a spike:

- **Packaging.** No electron-builder/Forge config, no icons, no installers, no signing or
  notarization. `bun run start` runs from source.
- **Auto-update.** Nothing. The mobile channels (`android-latest`, `ios-main`) have no desktop
  counterpart yet.
- **Desktop chrome.** No app menu, no keyboard shortcuts, no tray, no window-state persistence,
  no deep links. `titleBarStyle: hiddenInset` on macOS is the only concession made.
- **The open port.** Loopback + a per-launch bearer token injected by Electron's session
  (`onBeforeSendHeaders`) keeps other local processes out, but the port exists. See Milestone 2.
- **OAuth trackers.** `callbackBaseUrl` points at the loopback origin, which would work, but no
  tracker was connected end-to-end.
- **Desktop-shaped UI.** The renderer is the *web* layout — a responsive top nav that adapts to a
  wide viewport. It's usable at 1280×860, not designed for it.

## What a real desktop app would take, in order

**Milestone 1 — package it (this spike + ~1 week).** `electron-builder` for `.dmg` / `.exe` / 
`AppImage`, icons from `apps/mobile/assets`, an app menu with the standard edit/window roles, and
window-state persistence. macOS needs signing + notarization to open without a Gatekeeper detour —
which, unlike iOS, needs a **paid Apple Developer account**; without one, macOS ships the same
"right-click → Open" caveat the unsigned IPA has. Windows SmartScreen wants an EV cert or a
reputation build-up. Linux `AppImage` needs neither.

**Milestone 2 — drop the port, go over IPC.** Replace the loopback listener with
`ipcMain.handle('comical:fetch', …)` → `host.fetch(path, init)`, a preload that exposes it on
`window`, and a `startup.electron.ts` in `apps/mobile/src/data/embedded/` that calls the existing
`setTransport()`. That is *precisely* the shape `@comical/host-rn` already uses on iOS/Android —
`createEmbeddedTransport` drives `router.fetch` in-process and marshals the response — so this is
mostly a re-use, not a design. The renderer then loads over a custom `app://` protocol with a real
CSP, nothing listens on any port, and the token disappears. This is the only item here that touches
`apps/mobile`, and it's one new platform-suffixed file plus a resolver entry.

**Milestone 3 — make it feel native.** Menu-bar accelerators for the reader (arrows, page fit,
fullscreen), a desktop-width library grid, drag-and-drop import, "open in browser" for source
links (the spike already routes external navigation to `shell.openExternal`), and a real tray /
background-download story now that downloads run in a process that outlives no window.

**Milestone 4 — CI and a release channel.** A `build-desktop.yml` matrixed over
`macos-14` / `windows-latest` / `ubuntu-latest`, publishing to a rolling `desktop-latest` Release
plus versioned `vX.Y.Z` assets — mirroring the Android channel split, which already has the exact
"rolling vs release, never the same tag" lesson baked into it. Then `electron-updater` pointed at
those Releases.

**Ongoing cost to be honest about:** a third shell to keep working (Metro/Expo, nginx/Docker, and
now Electron), Chromium security updates that force a rebuild whether or not the app changed, and
~110 MB of `electron` in the root `bun install` for everyone in the workspace — a typecheck-only CI
job can set `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, since the `.d.ts` ships in the npm package.

## Files

| File | What it is |
| --- | --- |
| `src/main.ts` | Electron main: boot order, session token injection, window, external-link handling |
| `src/host/create-host.ts` | the `@comical/host-server` stack assembled for Node (a `createServer()` without `Bun.serve`) |
| `src/host/serve.ts` | loopback listener: token guard, `/api` → router, static export with the server URL injected |
| `scripts/build-web.ts` | `expo export --platform web` at the domain root → `build/web` |
| `scripts/build-main.ts` | `bun build --target=node --format=cjs` → `build/main.cjs` |
| `scripts/smoke.ts` | headless host checks, run under `node` |
| `scripts/launch-check.ts` | launches Electron and asserts the app mounted |
