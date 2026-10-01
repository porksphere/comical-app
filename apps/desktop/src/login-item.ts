/**
 * Starting with the user's session. Windows and macOS register through Electron; Linux has no API
 * for it there, so it gets the XDG autostart entry desktop environments read instead.
 */
import { app } from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Passed by the login entry, so a launch can tell it was the session starting rather than the user. */
const LOGIN_ARG = "--login";

const autostartFile = (): string =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "autostart", "comical.desktop");

/** A dev run is a bare Electron pointed at a Metro server, which a login launch would have neither of:
 *  registering it would put a broken Electron in the user's startup items. */
export function canOpenAtLogin(): boolean {
  return app.isPackaged;
}

export async function setOpenAtLogin(on: boolean): Promise<void> {
  if (!canOpenAtLogin()) return;
  if (process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: on, args: [LOGIN_ARG] });
    return;
  }
  if (!on) return rm(autostartFile(), { force: true });
  // An AppImage's own path is the mounted image, which is gone by the next session.
  const exec = process.env.APPIMAGE ?? process.execPath;
  await mkdir(join(autostartFile(), ".."), { recursive: true });
  await writeFile(
    autostartFile(),
    ["[Desktop Entry]", "Type=Application", "Name=Comical", `Exec="${exec}" ${LOGIN_ARG}`, "X-GNOME-Autostart-enabled=true", ""].join("\n"),
  );
}

export function launchedAtLogin(): boolean {
  // macOS starts a login item without its args.
  if (process.platform === "darwin") return app.getLoginItemSettings().wasOpenedAtLogin === true;
  return process.argv.includes(LOGIN_ARG);
}
