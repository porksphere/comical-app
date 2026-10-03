/**
 * The app's mark as the shell shows it: the book alone, on transparent. `scripts/render-icons.ts`
 * renders both files and `build-main.ts` copies them beside the bundles.
 */
import { app, nativeImage } from "electron";
import { join } from "node:path";

const file = (name: string): string => join(app.getAppPath(), "build", name);

export const iconImage = (): Electron.NativeImage => nativeImage.createFromPath(file("icon.png"));

/** For what the OS sizes itself — the window, the taskbar, the tray. The .ico holds a rendering
 *  per size and Windows takes the one its scaling calls for; a PNG it would shrink itself, badly. */
export const shellIcon = (): Electron.NativeImage =>
  process.platform === "win32" ? nativeImage.createFromPath(file("icon.ico")) : iconImage();
