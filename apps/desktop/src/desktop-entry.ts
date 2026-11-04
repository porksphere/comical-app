/**
 * The launcher entry an AppImage doesn't come with. A .deb installs one; an AppImage nothing has
 * integrated is in no menu, and its `comical://` handler names a `comical.desktop` that isn't
 * there. The entry is the one electron-builder packed into the image, pointed at the image itself,
 * and it's checked every launch so it follows the file to wherever it was moved or updated.
 */
import { app } from "electron";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** package.json's `desktopName`, which is also what `setAsDefaultProtocolClient` registers. */
const ENTRY_NAME = "comical.desktop";
const ICON_NAME = "comical.png";

export async function registerDesktopEntry(): Promise<void> {
  const appImage = process.env.APPIMAGE;
  const mount = process.env.APPDIR;
  if (process.platform !== "linux" || !app.isPackaged || !appImage || !mount) return;

  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const applications = join(dataHome, "applications");
  // AppImageLauncher and Gear Lever write entries of their own, under their own names.
  if (await integratedElsewhere(applications, appImage)) return;

  const packed = await readFile(join(mount, ENTRY_NAME), "utf8");
  const entry = packed
    // AppRun adds --no-sandbox itself where the sandbox can't start.
    .replace(/^Exec=AppRun(?: --no-sandbox)?/gm, () => `Exec=${execArg(appImage)}`)
    // An AppImage deleted by hand takes its entry out of the menu with it.
    .replace(/^\[Desktop Entry\]$/m, (header) => `${header}\nTryExec=${escaped(appImage)}`);
  await writeIfChanged(join(applications, ENTRY_NAME), entry);

  const packedIcons = join(mount, "usr", "share", "icons", "hicolor");
  for (const size of await readdir(packedIcons).catch(() => [])) {
    const icon = await readFile(join(packedIcons, size, "apps", ICON_NAME)).catch(() => null);
    if (icon) await writeIfChanged(join(dataHome, "icons", "hicolor", size, "apps", ICON_NAME), icon);
  }
}

async function integratedElsewhere(applications: string, appImage: string): Promise<boolean> {
  const names = await readdir(applications).catch(() => []);
  for (const name of names) {
    if (name === ENTRY_NAME || !name.endsWith(".desktop")) continue;
    const text = await readFile(join(applications, name), "utf8").catch(() => "");
    if (/^Exec=.*$/m.exec(text)?.[0].includes(appImage)) return true;
  }
  return false;
}

/** Rewriting an unchanged entry still has the desktop rebuild its menu cache. */
async function writeIfChanged(path: string, content: string | Buffer): Promise<void> {
  const current = await readFile(path).catch(() => null);
  if (current?.equals(Buffer.from(content))) return;
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
}

/** The Desktop Entry spec's string escape, which applies to every value. */
const escaped = (value: string): string => value.replace(/\\/g, "\\\\");

/** An Exec argument: quoted, field codes doubled, then string-escaped like any value. */
const execArg = (arg: string): string => escaped(`"${arg.replace(/["`$\\]/g, "\\$&").replace(/%/g, "%%")}"`);
