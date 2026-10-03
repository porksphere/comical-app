/**
 * Self-update, from the `desktop-release` channel `release.yml` publishes: the installer or AppImage
 * downloads in the background and the page is told once it's ready to install on a restart.
 */
import { app, BrowserWindow, ipcMain, net } from "electron";
import { autoUpdater } from "electron-updater";

/** Baked in by `scripts/build-main.ts`, from the same input the web export's channel comes from. */
const CHANNEL = process.env.COMICAL_BUILD_CHANNEL ?? "";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** Off the launch path: the host and the first render want the disk and network first. */
const FIRST_CHECK_AFTER_MS = 15 * 1000;

/** Only a release build follows the feed — a PR build is versioned `X.Y.Z-N`, which semver ranks
 *  BELOW the release it precedes, so it would "update" itself onto the release. A .deb belongs to
 *  apt (electron-updater would install it through a root prompt), so it keeps the download link. */
export const updatesSupported =
  app.isPackaged &&
  CHANNEL === "desktop-release" &&
  (process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE));

const RELEASE_ASSETS = "https://github.com/porksphere/comical-app/releases/download/";

let readyVersion: string | null = null;

export function startAutoUpdate(): void {
  // The page's own update check reads its channel's version.json, and cannot fetch it: GitHub
  // serves a Release asset with no CORS headers, so a browser refuses the response to every page.
  ipcMain.handle("release-json", async (_e, url: unknown) => {
    if (typeof url !== "string" || !new URL(url).href.startsWith(RELEASE_ASSETS)) throw new Error("not a release asset");
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`release asset fetch failed: ${res.status}`);
    return res.json();
  });
  ipcMain.on("update-ready?", (e) => {
    e.returnValue = readyVersion;
  });
  ipcMain.on("update-install", () => {
    // Silent: the user already chose to update by pressing the button, and the installer's own
    // pages would only ask again. Run-after brings the app back.
    if (readyVersion) autoUpdater.quitAndInstall(true, true);
  });
  if (!updatesSupported) return;

  // The installers sit at fixed URLs, so the "old" blockmap a differential download would diff
  // against is the new one — every attempt would fail its checksum and fall back anyway.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.on("update-downloaded", (info) => {
    readyVersion = info.version;
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("update-ready", info.version);
  });
  // Offline or GitHub unreachable is an ordinary state; the next check tries again.
  autoUpdater.on("error", (err) => console.error("[updater]", err.message));

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, FIRST_CHECK_AFTER_MS);
  setInterval(check, CHECK_EVERY_MS);
}
