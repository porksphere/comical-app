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
import { app, BrowserWindow, ipcMain, screen, shell, session } from "electron";
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

/** Windows Chromium draws a grey track with arrow buttons; this is the thin overlay-style thumb macOS
 *  and phones show. Injected here rather than shipped in the web bundle so browsers keep their own.
 *  Only the `::-webkit-scrollbar` form: setting the standard `scrollbar-color` / `scrollbar-width`
 *  as well makes Chromium ignore all of it. A transparent border, clipped out, is what makes the
 *  thumb narrower than the gutter it sits in. The app's lists run under an overlaid top bar and
 *  publish how tall it is as `--scrollbar-inset-top`, so the track starts below it. */
const SCROLLBAR_CSS = `
  ::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-track:vertical { margin-top: var(--scrollbar-inset-top, 0px); }
  ::-webkit-scrollbar-button { display: none; }
  ::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.35);
    border: 3px solid transparent;
    background-clip: padding-box;
    border-radius: 999px;
  }
  ::-webkit-scrollbar-thumb:hover { background-color: rgba(128, 128, 128, 0.6); }
`;

/** Windows and Linux lose their title bar (and the File/Edit menu row under it; its accelerators
 *  still work) and draw only the caption buttons, over the page. macOS keeps its inset traffic
 *  lights, which already sit inside the window. */
const CAPTION_OVERLAY = process.platform !== "darwin";

/** The app's top bars are the window's handle now. They carry a `data-app-region` marker and this is
 *  what makes it mean something; a browser never sees it. A control inside a bar is cut back out —
 *  `app-region` is the OS's hit test, decided before the page sees the click. A bar faded out of
 *  use (`data-window-drag="off"`) stops being one, and while a menu or dialog is up nothing is,
 *  since those are drawn over the bars and a handle under them would swallow their clicks. */
const DRAG_REGION_CSS = `
  [data-app-region="drag"]:not([data-window-drag="off"] *) { app-region: drag; }
  [data-app-region]:not([data-window-drag="off"] *) :is(
    a, button, input, textarea, select, [tabindex]:not([tabindex="-1"]),
    [role="button"], [role="link"], [role="switch"], [role="tab"], [role="checkbox"],
    [role="combobox"], [role="menuitem"], [role="textbox"], [role="searchbox"]
  ) { app-region: no-drag; }
  body:has([data-window-layer]) [data-app-region="drag"] { app-region: no-drag; }
`;

/** The caption buttons are as tall as the bar they sit in — `useTopBarHeight` in the app: the
 *  desktop bar from 768px of window width (`LARGE_SCREEN_BREAKPOINT`), the compact one below — less
 *  the bar's 1px bottom rule, which the strip would otherwise paint over beneath the buttons. */
const captionHeight = (win: BrowserWindow): number => (win.getContentBounds().width >= 768 ? 64 : 60) - 1;

/** How much of the glyphs' contrast survives while the page has its own chrome hidden: Windows
 *  can't hide the buttons short of fullscreen, so they recede instead. */
const DIMMED_GLYPH = 0.3;

/** The page says what is behind the buttons with `<meta name="theme-color">`; the glyphs take
 *  whichever of black and white reads on it. */
function captionColors(background: string, dimmed = false): { color: string; symbolColor: string } {
  const hex = /^#([0-9a-f]{6})$/i.exec(background)?.[1] ?? "000000";
  const bg = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = 0.299 * bg[0]! + 0.587 * bg[1]! + 0.114 * bg[2]! > 150;
  const glyph = light ? 0 : 255;
  const mix = dimmed ? DIMMED_GLYPH : 1;
  const symbolColor = `#${bg.map((c) => Math.round(c + (glyph - c) * mix).toString(16).padStart(2, "0")).join("")}`;
  return { color: `#${hex}`, symbolColor };
}

let server: LoopbackServer | null = null;

/** Start the host + its listener. Runs once per process; `openWindow` can then be called freely. */
async function boot(): Promise<void> {
  if (process.env.COMICAL_DEBUG || process.env.COMICAL_CAPTURE) console.log(`[boot] web root: ${webRoot()}`);
  const dataDir = join(app.getPath("userData"), "comical");

  // Bind the listener first: the host wants its own base URL (bridges get it as `hostUrl`, OAuth
  // uses it as the redirect target) and that URL only exists once the ephemeral port is bound.
  let host: ReturnType<typeof createDesktopHost> | null = null;
  server = await startLoopbackServer({
    getHost: () => host,
    webRoot: webRoot(),
    // Set by `scripts/dev.ts`.
    devServer: process.env.COMICAL_DEV_SERVER,
    port: process.env.COMICAL_PORT ? Number(process.env.COMICAL_PORT) : undefined,
  });
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
    titleBarStyle: CAPTION_OVERLAY ? "hidden" : "hiddenInset",
    ...(CAPTION_OVERLAY ? { titleBarOverlay: { ...captionColors("#000000"), height: 63 } } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(app.getAppPath(), "build", "preload.cjs"),
    },
  });

  win.once("ready-to-show", () => win.show());

  // Every load (a reload included) starts without it, and `insertCSS` lasts only until the next one.
  win.webContents.on("dom-ready", () => {
    void win.webContents.insertCSS(SCROLLBAR_CSS);
    if (CAPTION_OVERLAY) void win.webContents.insertCSS(DRAG_REGION_CSS);
  });

  if (CAPTION_OVERLAY) {
    let background = "#000000";
    let dimmed = false;
    let colors = captionColors(background);
    let height = captionHeight(win);
    const paint = () => {
      colors = captionColors(background, dimmed);
      win.setTitleBarOverlay({ ...colors, height });
    };
    paint();
    win.webContents.on("did-change-theme-color", (_e, color) => {
      background = color ?? "#000000";
      paint();
    });
    const onDim = (e: Electron.IpcMainEvent, dim: unknown) => {
      if (e.sender !== win.webContents || dimmed === (dim === true)) return;
      dimmed = dim === true;
      paint();
    };
    ipcMain.on("caption-dim", onDim);
    win.on("closed", () => ipcMain.off("caption-dim", onDim));
    // A reload drops whatever screen asked for it without that screen ever saying so.
    win.webContents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument || !dimmed) return;
      dimmed = false;
      paint();
    });
    win.on("resize", () => {
      const next = captionHeight(win);
      if (next === height) return;
      height = next;
      win.setTitleBarOverlay({ ...colors, height });
    });
  }

  // The page can't watch the top of the window itself: a drag region takes the mouse as the title
  // bar's, so over it the page receives nothing, not even the pointer arriving. Polled, because
  // the OS reports no hover over a title bar either.
  let edgeWatch: ReturnType<typeof setInterval> | null = null;
  const stopEdgeWatch = () => {
    if (edgeWatch) clearInterval(edgeWatch);
    edgeWatch = null;
  };
  const onEdgeWatch = (e: Electron.IpcMainEvent, edge: unknown) => {
    if (e.sender !== win.webContents) return;
    stopEdgeWatch();
    if (typeof edge !== "number" || !(edge > 0)) return;
    let inside: boolean | null = null;
    edgeWatch = setInterval(() => {
      if (win.isDestroyed()) return stopEdgeWatch();
      const at = screen.getCursorScreenPoint();
      const box = win.getContentBounds();
      const now =
        win.isVisible() &&
        !win.isMinimized() &&
        at.x >= box.x &&
        at.x < box.x + box.width &&
        at.y >= box.y &&
        at.y < box.y + edge;
      if (now === inside) return;
      inside = now;
      win.webContents.send("top-edge", now);
    }, 50);
  };
  ipcMain.on("top-edge-watch", onEdgeWatch);
  win.on("closed", () => {
    stopEdgeWatch();
    ipcMain.off("top-edge-watch", onEdgeWatch);
  });
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) stopEdgeWatch();
  });

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
