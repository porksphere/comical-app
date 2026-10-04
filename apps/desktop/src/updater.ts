/**
 * Self-update, from the Release this build's channel publishes to (`desktop-release` or
 * `desktop-nightly`): the installer or AppImage downloads in the background and the page is told
 * once it's ready to install on a restart.
 */
import { app, BrowserWindow, ipcMain, net } from "electron";
import { autoUpdater } from "electron-updater";

/** Baked in by `scripts/build-main.ts`, from the same input the web export's channel comes from. */
const CHANNEL = process.env.COMICAL_BUILD_CHANNEL ?? "";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** Off the launch path: the host and the first render want the disk and network first. */
const FIRST_CHECK_AFTER_MS = 15 * 1000;

/** A build follows its OWN channel's feed and no other. A nightly is versioned `X.Y.Z-N`, which
 *  semver ranks BELOW the release it precedes, so on the release feed it would "update" itself onto
 *  the release; among themselves nightlies only go up. A PR build has no feed. A .deb belongs to
 *  apt (electron-updater would install it through a root prompt), so it keeps the download link. */
export const updatesSupported =
  app.isPackaged &&
  (CHANNEL === "desktop-release" || CHANNEL === "desktop-nightly") &&
  (process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE));

const RELEASE_ASSETS = "https://github.com/porksphere/comical-app/releases/download/";

/** `manual`: the page knows of an update this shell couldn't get, so it offers the link. */
type UpdateState = { phase: "idle" | "downloading" | "manual"; version: null } | { phase: "ready"; version: string };

let state: UpdateState = { phase: "idle", version: null };

function setState(next: UpdateState): void {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("update-state", state);
}

/** The version as the page writes it: `stamp-version.ts` turned `X.Y.Z.N` into `X.Y.Z-N`. */
const shown = (version: string) => version.replace("-", ".");

const check = () => void autoUpdater.checkForUpdates().catch(() => {});

export function startAutoUpdate(): void {
  // The page's own update check reads its channel's version.json, and cannot fetch it: GitHub
  // serves a Release asset with no CORS headers, so a browser refuses the response to every page.
  ipcMain.handle("release-json", async (_e, url: unknown) => {
    if (typeof url !== "string" || !new URL(url).href.startsWith(RELEASE_ASSETS)) throw new Error("not a release asset");
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`release asset fetch failed: ${res.status}`);
    return res.json();
  });
  ipcMain.on("update-state?", (e) => {
    e.returnValue = state;
  });
  // The page has seen a newer build on its channel and isn't waiting for the next timed look.
  ipcMain.on("update-download", () => {
    if (!updatesSupported || state.phase === "downloading" || state.phase === "ready") return;
    setState({ phase: "downloading", version: null });
    check();
  });
  ipcMain.on("update-install", () => {
    // Silent: the user already chose to update by pressing the button, and the installer's own
    // pages would only ask again. Run-after brings the app back.
    if (state.phase === "ready") autoUpdater.quitAndInstall(true, true);
  });
  if (!updatesSupported) return;

  // app-update.yml names the release feed in every build; each channel's Release carries its own.
  autoUpdater.setFeedURL({ provider: "generic", url: RELEASE_ASSETS + CHANNEL });
  // The installers sit at fixed URLs, so the "old" blockmap a differential download would diff
  // against is the new one — every attempt would fail its checksum and fall back anyway.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.on("update-available", (info) => {
    // A look that finds the update already downloaded announces it again; that one is still ready.
    if (state.phase === "ready" && state.version === shown(info.version)) return;
    setState({ phase: "downloading", version: null });
  });
  autoUpdater.on("update-not-available", () => {
    if (state.phase === "downloading") setState({ phase: "manual", version: null });
  });
  autoUpdater.on("update-downloaded", (info) => setState({ phase: "ready", version: shown(info.version) }));
  // Offline or GitHub unreachable is an ordinary state; the next check tries again.
  autoUpdater.on("error", (err) => {
    console.error("[updater]", err.message);
    if (state.phase === "downloading") setState({ phase: "manual", version: null });
  });

  setTimeout(check, FIRST_CHECK_AFTER_MS);
  setInterval(check, CHECK_EVERY_MS);
}
