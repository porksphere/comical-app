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
import { app, BrowserWindow, ipcMain, Notification, screen, shell, session } from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createDesktopHost, type DesktopHost } from "./host/create-host.ts";
import { startLoopbackServer, type LoopbackServer } from "./host/serve.ts";
import { iconImage, shellIcon } from "./icon.ts";
import { newSyncKey, startSyncListener, type SyncListener } from "./host/sync-listener.ts";
import { linkInArgs, linkRoute, registerLinkScheme } from "./links.ts";
import { canOpenAtLogin, launchedAtLogin, setOpenAtLogin } from "./login-item.ts";
import { attachContextMenu, setAppMenu, type NavDirection } from "./menus.ts";
import { shellSettings, updateShellSettings } from "./shell-settings.ts";
import { setTray, trayNotice } from "./tray.ts";
import { startAutoUpdate, updatesSupported } from "./updater.ts";
import { savedWindowState, trackWindowState } from "./window-state.ts";

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
 *  can't hide the buttons short of fullscreen, so they recede instead — the strip goes clear, so
 *  the page runs on under them, and the glyphs fade to a grey that still reads on a white page. */
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
  return { color: dimmed ? "#00000000" : `#${hex}`, symbolColor };
}

let server: LoopbackServer | null = null;
let host: DesktopHost | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;
/** A session start with the tray on opens no window: being there is the whole point of it. */
let startInTray = false;
/** Maximizing a hidden window shows it, so a window that was left maximized is maximized as it is
 *  first shown rather than when it is made — a start into the tray has to stay hidden. */
let maximizeOnShow = false;

/** The page subscribes to shell commands once it can navigate (`shell-commands` below). A route
 *  asked for before then — a link that launched the app, a click on a notice while it reloads —
 *  waits here and is handed over as it subscribes. */
let commandsReady = false;
let pendingRoute: string | null = linkInArgs(process.argv);

type ShellCommand = { type: "open"; route: string } | { type: "navigate"; dir: NavDirection };

function reveal(win: BrowserWindow): void {
  if (maximizeOnShow) {
    maximizeOnShow = false;
    win.maximize();
  }
  win.show();
}

/** Bring the window back from the tray, the taskbar or behind other windows. */
function showWindow(): void {
  const win = mainWindow;
  // Before the listener is up the boot in progress is about to open one anyway.
  if (!win) return void (server && openWindow());
  if (win.isMinimized()) win.restore();
  reveal(win);
  win.focus();
}

function openRoute(route: string): void {
  if (mainWindow && commandsReady) mainWindow.webContents.send("shell-command", { type: "open", route } satisfies ShellCommand);
  else pendingRoute = route;
  showWindow();
}

function navigate(win: BrowserWindow, dir: NavDirection): void {
  if (win === mainWindow && commandsReady) win.webContents.send("shell-command", { type: "navigate", dir } satisfies ShellCommand);
}

/** Held until clicked or dismissed: a notice collected by the garbage collector loses its click
 *  handler on Windows while still sitting in the Action Center. */
const notices = new Set<Notification>();

function notify(title: string, body: string, route: string | null): void {
  if (!Notification.isSupported()) return;
  const notice = new Notification({
    title,
    body,
    icon: iconImage(),
  });
  notices.add(notice);
  notice.on("click", () => {
    notices.delete(notice);
    if (route) openRoute(route);
    else showWindow();
  });
  notice.on("close", () => notices.delete(notice));
  notice.show();
}

let syncListener: SyncListener | null = null;
let syncListenerChange: Promise<unknown> = Promise.resolve();

/** Bring the network listener in line with the saved setting. Resolves to the address a phone is
 *  given, or null when off or unreachable. Queued, so a toggle flicked twice can't leave two
 *  listeners or close the one just opened. */
function applyNetworkSync(): Promise<string | null> {
  const applied = syncListenerChange.then(async () => {
    if (!shellSettings().networkSync) {
      await syncListener?.close();
      syncListener = null;
      return null;
    }
    if (!syncListener) {
      const key = shellSettings().syncKey ?? updateShellSettings({ syncKey: newSyncKey() }).syncKey!;
      syncListener = await startSyncListener({
        getHost: () => host,
        key,
        port: process.env.COMICAL_SYNC_PORT ? Number(process.env.COMICAL_SYNC_PORT) : undefined,
      });
    }
    return syncListener.address();
  });
  syncListenerChange = applied.catch(() => {});
  return applied.catch((err: unknown) => {
    console.error("[sync] listener failed:", err);
    return null;
  });
}

function withoutHeaders<V>(headers: Record<string, V>, dropped: RegExp): Record<string, V> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !dropped.test(name)));
}

/** Start the host + its listener. Runs once per process; `openWindow` can then be called freely. */
async function boot(): Promise<void> {
  if (process.env.COMICAL_DEBUG || process.env.COMICAL_CAPTURE) console.log(`[boot] web root: ${webRoot()}`);
  const dataDir = join(app.getPath("userData"), "comical");

  // Bind the listener first: the host wants its own base URL (bridges get it as `hostUrl`, OAuth
  // uses it as the redirect target) and that URL only exists once the ephemeral port is bound.
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
    onSynced: () => mainWindow?.webContents.send("synced"),
    onSyncDevices: (devices) => mainWindow?.webContents.send("sync-devices", devices),
  });
  if (shellSettings().networkSync) void applyNetworkSync();

  // The renderer's requests — page load, JS, and every API call — carry the launch token; nothing
  // else on the machine has it, so the open port isn't an open door.
  //
  // The images it asks other hosts for are covers, straight off a source's CDN, and to a CDN with
  // hotlink protection an <img> on a loopback page is a hotlink: `Sec-Fetch-Site: cross-site` with
  // `Sec-Fetch-Mode: no-cors` is answered with an HTML 403 (which surfaces as an ORB block, not a
  // status), and a cover that is served can still carry `Cross-Origin-Resource-Policy: same-site`
  // and be dropped on arrival. The native apps send no such headers and enforce no such policy, so
  // desktop asks the way they do. Both jobs share a listener because a session keeps only one per
  // event — a second registration replaces the first, and with it the token.
  const bearer = `Bearer ${server.token}`;
  const own = `${server.origin}/`;
  const { webRequest } = session.defaultSession;
  webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith(own)) {
      callback({ requestHeaders: { ...details.requestHeaders, Authorization: bearer } });
    } else if (details.resourceType === "image") {
      callback({ requestHeaders: withoutHeaders(details.requestHeaders, /^(referer|sec-fetch-.+)$/i) });
    } else {
      callback({});
    }
  });
  webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith(own) || details.resourceType !== "image" || !details.responseHeaders) {
      callback({});
      return;
    }
    callback({ responseHeaders: withoutHeaders(details.responseHeaders, /^cross-origin-resource-policy$/i) });
  });

  await openWindow();
}

/** Open a window on the running listener. */
async function openWindow(): Promise<void> {
  if (!server) throw new Error("openWindow before boot");

  const saved = savedWindowState();
  maximizeOnShow = saved.maximized;
  const win = new BrowserWindow({
    width: saved.bounds?.width ?? 1280,
    height: saved.bounds?.height ?? 860,
    ...(saved.bounds ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
    minWidth: 480,
    minHeight: 480,
    backgroundColor: "#000000",
    // A packaged Windows build would take the .exe's icon anyway; Linux and an unpackaged run have
    // nothing else to go on. macOS ignores it.
    icon: shellIcon(),
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

  const hidden = startInTray;
  startInTray = false;
  win.once("ready-to-show", () => {
    if (!hidden) reveal(win);
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow !== win) return;
    mainWindow = null;
    commandsReady = false;
  });
  trackWindowState(win);
  attachContextMenu(win, server.origin);
  // The mouse's back and forward buttons, on Windows and Linux; macOS sends them to the page.
  win.on("app-command", (_e, command) => {
    if (command === "browser-backward") navigate(win, "back");
    else if (command === "browser-forward") navigate(win, "forward");
  });
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) commandsReady = false;
  });
  win.on("close", (e) => {
    if (quitting || !shellSettings().runInTray) return;
    e.preventDefault();
    win.hide();
    if (shellSettings().trayNoticeShown) return;
    updateShellSettings({ trayNoticeShown: true });
    trayNotice();
  });

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

// A second launch — the shortcut clicked while the app sits in the tray — would boot a second host
// against the same data dir. It hands over to the running one instead.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", (_e, argv) => {
  const route = linkInArgs(argv);
  if (route) openRoute(route);
  else showWindow();
});
// macOS delivers links as an event instead — before `ready`, for the one that launched the app.
app.on("open-url", (e, url) => {
  e.preventDefault();
  const route = linkRoute(url);
  if (route) openRoute(route);
});

// The renderer reads these synchronously from its preload, before the page's first render.
ipcMain.on("shell-settings", (e) => {
  const { runInTray, openAtLogin, networkSync } = shellSettings();
  e.returnValue = { runInTray, openAtLogin, networkSync, loginItems: canOpenAtLogin(), updates: updatesSupported };
});
ipcMain.on("shell-commands", (e) => {
  if (e.sender !== mainWindow?.webContents) return void (e.returnValue = null);
  commandsReady = true;
  e.returnValue = pendingRoute;
  pendingRoute = null;
});
ipcMain.on("notify", (_e, title: unknown, body: unknown, route: unknown) => {
  if (typeof title !== "string" || typeof body !== "string") return;
  notify(title, body, typeof route === "string" && route.startsWith("/") ? route : null);
});
ipcMain.on("run-in-tray", (_e, on: unknown) => {
  updateShellSettings({ runInTray: on === true });
  setTray(on === true, showWindow);
});
ipcMain.on("open-at-login", (_e, on: unknown) => {
  updateShellSettings({ openAtLogin: on === true });
  setOpenAtLogin(on === true).catch((err: unknown) => console.error("[login-item] failed:", err));
});

// With a boolean it sets; without one it only reports where the listener is.
ipcMain.handle("network-sync", (_e, on: unknown) => {
  if (typeof on === "boolean") updateShellSettings({ networkSync: on });
  return applyNetworkSync();
});

ipcMain.handle("sync-devices", () => host?.syncDevices() ?? []);

// The key is the listener's whole secret, so a new one means a new listener: the old is closed
// first, through the same queue a toggle goes through, and the old key stops opening anything the
// moment the new address exists.
ipcMain.handle("network-sync-new-key", async () => {
  const closed = syncListenerChange.then(async () => {
    await syncListener?.close();
    syncListener = null;
    updateShellSettings({ syncKey: newSyncKey() });
  });
  syncListenerChange = closed.catch(() => {});
  await closed.catch((err: unknown) => console.error("[sync] rekey failed:", err));
  return applyNetworkSync();
});

if (primary) {
  app
    .whenReady()
    .then(() => {
      // Without it Windows attributes the tray's notice to Electron itself in dev.
      if (process.platform === "win32") app.setAppUserModelId("com.porksphere.comical");
      setAppMenu(navigate);
      registerLinkScheme();
      const settings = shellSettings();
      setTray(settings.runInTray, showWindow);
      startInTray = settings.runInTray && launchedAtLogin();
      // Re-registered every launch, so the entry follows the app to wherever an update put it.
      if (settings.openAtLogin) {
        setOpenAtLogin(true).catch((err: unknown) => console.error("[login-item] failed:", err));
      }
      startAutoUpdate();
      return boot();
    })
    .catch((err: unknown) => {
      console.error("comical-desktop failed to start:", err);
      app.exit(1);
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow) return showWindow();
  if (BrowserWindow.getAllWindows().length > 0) return;
  // The host and its listener outlive every window (downloads keep draining), so reopening is just
  // a window — booting a second host would fight the first over the same data dir.
  void (server ? openWindow() : boot());
});

app.on("before-quit", () => {
  quitting = true;
  host?.close();
  void server?.close();
  void syncListener?.close();
});
