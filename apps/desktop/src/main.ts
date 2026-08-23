/**
 * Electron main process.
 *
 * Three jobs, in order: assemble the Comical host (the real `@comical/host-server` stack, running
 * on Electron's own Node — see `host/create-host.ts`), put a loopback listener in front of it that
 * also serves the unmodified web bundle (`host/serve.ts`), then open a window on it.
 *
 * The renderer is the *existing* `expo export --platform web` output. That's the whole point of the
 * spike: the desktop app is the shipped web UI plus a private, per-user backend, so nothing in
 * `apps/mobile` has to know desktop exists.
 */
import { app, BrowserWindow, shell, session } from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createDesktopHost } from "./host/create-host.ts";
import { startLoopbackServer, type LoopbackServer } from "./host/serve.ts";

/** The web export, which `scripts/build-web.ts` writes to `build/web` beside the bundled main.
 *
 *  Resolved from Electron's `app.getAppPath()` rather than `__dirname` / `import.meta.url`: bun's
 *  bundler inlines both to the *source* module's location (`src/`), which is wrong at runtime.
 *  `getAppPath()` is a real runtime call — the app dir in dev (`electron .`), the asar root when
 *  packaged — so it survives bundling either way. */
const webRoot = (): string => process.env.COMICAL_WEB_ROOT ?? join(app.getAppPath(), "build", "web");

let server: LoopbackServer | null = null;

/** Start the host + its listener. Runs once per process; `openWindow` can then be called freely. */
async function boot(): Promise<void> {
  if (process.env.COMICAL_DEBUG || process.env.COMICAL_CAPTURE) console.log(`[boot] web root: ${webRoot()}`);
  const dataDir = join(app.getPath("userData"), "comical");

  // Bind the listener first: the host wants its own base URL (bridges get it as `hostUrl`, OAuth
  // uses it as the redirect target) and that URL only exists once the ephemeral port is bound.
  let host: ReturnType<typeof createDesktopHost> | null = null;
  server = await startLoopbackServer({ getHost: () => host, webRoot: webRoot() });
  host = createDesktopHost({
    dataDir,
    // Registry-installed bridges land in {dataDir}/bridge-cache regardless. This extra scan dir is
    // the escape hatch for an unpacked bundle you're developing — and what the demo points at the
    // submodule's `bridges/` with, to have something to look at before any registry is added:
    //   COMICAL_BRIDGES_DIR=../../external/comical/bridges bun run start
    bridgesDir: process.env.COMICAL_BRIDGES_DIR ?? join(dataDir, "bridges"),
    baseUrl: `${server.origin}/api`,
  });

  // The renderer's requests — page load, JS, and every API call — carry the launch token; nothing
  // else on the machine has it, so the open port isn't an open door.
  const bearer = `Bearer ${server.token}`;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${server.origin}/*`] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Authorization: bearer } });
    },
  );

  await openWindow();
}

/** Open a window on the running listener. */
async function openWindow(): Promise<void> {
  if (!server) throw new Error("openWindow before boot");

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: "#000000",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Renderer diagnostics on stdout — the spike's only debugging channel, since there's no devtools
  // in a headless run. Off unless asked for.
  if (process.env.COMICAL_DEBUG || process.env.COMICAL_CAPTURE) {
    win.webContents.on("console-message", (e) => {
      console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.error(`[renderer] load failed ${code} ${desc} — ${url}`);
    });
  }

  // Bridges link out to their source sites; those belong in the user's browser, not in a
  // chrome-less Electron window with no navigation controls.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(server!.origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  await win.loadURL(server.origin + "/");

  // Headless verification hook: with COMICAL_CAPTURE set, wait for the UI to settle, write a PNG,
  // and exit. Lets CI (and a container with no display, under `xvfb-run`) prove the shell actually
  // renders the app rather than a white page — see `scripts/launch-check.ts`.
  if (process.env.COMICAL_CAPTURE) {
    await new Promise((r) => setTimeout(r, Number(process.env.COMICAL_CAPTURE_DELAY ?? 6000)));
    const probe = await win.webContents.executeJavaScript(
      `JSON.stringify({title: document.title, nodes: document.body.querySelectorAll('*').length, text: (document.body.innerText||'').slice(0,300)})`,
    );
    console.log(`[capture] ${probe}`);
    const image = await win.webContents.capturePage();
    await writeFile(process.env.COMICAL_CAPTURE, image.toPNG());
    console.log(`captured → ${process.env.COMICAL_CAPTURE}`);
    app.exit(0);
  }
}

app.whenReady().then(boot).catch((err: unknown) => {
  console.error("comical-desktop failed to start:", err);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  // The host and its listener outlive every window (downloads keep draining), so reopening is just
  // a window — booting a second host would fight the first over the same data dir.
  void (server ? openWindow() : boot());
});

app.on("before-quit", () => {
  void server?.close();
});
