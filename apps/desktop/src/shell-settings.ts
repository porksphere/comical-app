/**
 * Preferences the shell acts on itself, outside any page: they have to be known when there is no
 * page to ask (a window closing, a launch at login), so they live beside the data dir rather than
 * in the renderer's storage.
 */
import { app } from "electron";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ShellSettings = {
  /** Closing the window hides it, and the app carries on from a tray icon until quit from there. */
  runInTray: boolean;
  /** Start with the user's session — into the tray, when `runInTray` is on too. */
  openAtLogin: boolean;
  /** The one-time "still running" notice has been shown. */
  trayNoticeShown: boolean;
  /** Other devices on the network may sync with this library (`host/sync-listener.ts`). */
  networkSync: boolean;
  /** What those devices present. Made the first time `networkSync` goes on and kept, so a device
   *  paired once stays paired. */
  syncKey: string | null;
};

const file = (): string => join(app.getPath("userData"), "comical", "desktop-settings.json");

let current: ShellSettings | null = null;

export function shellSettings(): ShellSettings {
  if (current) return current;
  let raw: Partial<Record<keyof ShellSettings, unknown>> = {};
  try {
    raw = JSON.parse(readFileSync(file(), "utf8")) as typeof raw;
  } catch {
    // No file yet, or one that doesn't parse: every setting at its default.
  }
  current = {
    runInTray: raw.runInTray === true,
    openAtLogin: raw.openAtLogin === true,
    trayNoticeShown: raw.trayNoticeShown === true,
    networkSync: raw.networkSync === true,
    syncKey: typeof raw.syncKey === "string" && raw.syncKey ? raw.syncKey : null,
  };
  return current;
}

let writing: Promise<void> = Promise.resolve();

export function updateShellSettings(patch: Partial<ShellSettings>): ShellSettings {
  current = { ...shellSettings(), ...patch };
  const json = JSON.stringify(current, null, 2);
  // Chained, so two quick changes can't land on disk in the wrong order.
  writing = writing
    .then(async () => {
      await mkdir(dirname(file()), { recursive: true });
      await writeFile(file(), json);
    })
    .catch((err: unknown) => console.error("[shell-settings] save failed:", err));
  return current;
}
