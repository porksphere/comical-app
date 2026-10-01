/**
 * The tray icon the app keeps running behind once its window is closed, while `runInTray` is on.
 */
import { app, Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";

let tray: Tray | null = null;

/** `build-main.ts` copies the web favicon here, so the tray carries the same mark as the window. */
function trayImage(): Electron.NativeImage {
  const source = nativeImage.createFromPath(join(app.getAppPath(), "build", "tray.png"));
  const image = source.resize({ width: 16, height: 16, quality: "best" });
  image.addRepresentation({ scaleFactor: 2, buffer: source.resize({ width: 32, height: 32, quality: "best" }).toPNG() });
  return image;
}

export function setTray(enabled: boolean, open: () => void): void {
  if (!enabled) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip("Comical");
  // Some Linux trays show nothing at all for an icon without a menu, and none of them report clicks.
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Comical", click: open },
      { type: "separator" },
      { label: "Quit Comical", click: () => app.quit() },
    ]),
  );
  tray.on("click", open);
}

/** Windows only: the first time a close leaves the app running, say where it went — otherwise the
 *  window simply vanishing reads as a quit. */
export function trayNotice(): void {
  if (process.platform !== "win32" || !tray) return;
  tray.displayBalloon({
    iconType: "info",
    title: "Comical is still running",
    content: "Closing the window keeps it going in the tray. Right-click the icon to quit.",
  });
}
