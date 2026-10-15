/**
 * Where everything the app keeps lives, and moving it somewhere else.
 *
 * Everything is `userData`: the host's folder in it (library, downloads, bridges, the shell's own
 * settings) and Chromium's profile beside that, which holds the page's localStorage — every
 * preference the page keeps. So moving the data is moving `userData`, which can only be set before
 * `ready`. A move is written into the pointer in the default folder, and the next launch carries it
 * out before anything opens either copy.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  checkTarget,
  copyData,
  dataSize,
  freeSpace,
  isEmptyFolder,
  POINTER_FILE,
  readPointer,
  resolveTarget,
  samePath,
  SCRATCH_DIR,
  writePointer,
  type Pointer,
  type Problem,
  type Target,
} from "./data-dir.ts";
import { shellIcon } from "./icon.ts";
import { LOGIN_ARG } from "./login-item.ts";

export type DataLaunch =
  /** The data is in `dir`, and this launch runs on it. */
  | { kind: "run"; dir: string }
  /** This launch copies the data from `from` to `to`, then hands over to one that runs on it. */
  | { kind: "move"; from: string; to: string }
  /** The data's folder isn't there; this launch asks what to do about it. */
  | { kind: "missing"; dir: string };

/** Where the data is now, as the page shows it. */
export type DataDir = { dir: string; isDefault: boolean };

/** A folder the data could go to, with what the page needs to offer the move. */
export type DataDirTarget = (Target & { isDefault: boolean; bytes: number; free: number | null }) | Problem;

let defaultDir = "";
const pointerFile = (): string => join(defaultDir, POINTER_FILE);
const current = (): string => app.getPath("userData");

/** Before `ready`, and before the single-instance lock: that lock is taken in `userData`, and two
 *  launches on the same data have to meet there. */
export function locateData(): DataLaunch {
  defaultDir = app.getPath("userData");
  const pointer = readPointer(pointerFile());
  const dir = pointer.dir ?? defaultDir;
  const launch: DataLaunch = pointer.copyFrom
    ? { kind: "move", from: pointer.copyFrom, to: dir }
    : pointer.dir && !pointer.fresh && isEmptyFolder(pointer.dir)
      ? { kind: "missing", dir: pointer.dir }
      : { kind: "run", dir };
  const userData = launch.kind === "run" ? dir : join(defaultDir, SCRATCH_DIR);
  mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);
  if (pointer.fresh) writePointer(pointerFile(), pointer.dir ? { dir: pointer.dir } : {});
  return launch;
}

export function currentDataDir(): DataDir {
  return { dir: current(), isDefault: samePath(current(), defaultDir) };
}

/** The scratch profile a move ran on. Only a launch running on the data calls this, and none of
 *  those overlaps one that's moving it. */
export function clearScratch(): void {
  void rm(join(defaultDir, SCRATCH_DIR), { recursive: true, force: true }).catch(() => {});
}

/** The default folder is left out of the pointer rather than written down, so the data stays with
 *  wherever Electron puts that folder. */
function pointTo(dir: string, rest: Omit<Pointer, "dir"> = {}): void {
  writePointer(pointerFile(), { ...(samePath(dir, defaultDir) ? {} : { dir }), ...rest });
}

/** An AppImage's own binary is inside the mounted image, which goes when this process does. A link
 *  the launch was opened with, or a login start's flag, has done its job and would only repeat. */
function relaunch(): void {
  app.relaunch({
    execPath: process.env.APPIMAGE ?? process.execPath,
    args: process.argv.slice(1).filter((arg) => !arg.startsWith("comical:") && arg !== LOGIN_ARG),
  });
}

const targetOf = (dir: string): Target | Problem =>
  samePath(dir, defaultDir) ? checkTarget(defaultDir, current()) : resolveTarget(dir, { current: current(), name: basename(defaultDir) });

async function describe(target: Target | Problem): Promise<DataDirTarget> {
  if ("problem" in target) return target;
  const [bytes, free] = await Promise.all([dataSize(current()), freeSpace(target.dir)]);
  return { ...target, isDefault: samePath(target.dir, defaultDir), bytes, free };
}

async function move(dir: string, copy: boolean): Promise<string | null> {
  const target = targetOf(dir);
  if ("problem" in target) return target.problem;
  // What the page showed is what gets moved to: a folder that has gained files since it was picked
  // would now resolve to a folder inside it.
  if (!samePath(target.dir, dir)) return "That folder has changed since you chose it. Choose it again.";
  try {
    await mkdir(target.dir, { recursive: true });
    const probe = join(target.dir, `.comical-probe-${process.pid}`);
    await writeFile(probe, "");
    await unlink(probe);
  } catch {
    return "Comical can't write to that folder.";
  }
  pointTo(target.dir, copy ? { copyFrom: current() } : target.holdsData ? {} : { fresh: true });
  relaunch();
  app.quit();
  return null;
}

export function registerDataLocation(): void {
  ipcMain.handle("data-dir-choose", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Choose where Comical keeps its data",
      buttonLabel: "Choose",
      defaultPath: currentDataDir().isDefault ? app.getPath("home") : join(current(), ".."),
      properties: ["openDirectory", "createDirectory", "promptToCreate", "dontAddToRecent"],
    };
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const picked = filePaths[0];
    if (canceled || !picked) return null;
    return describe(resolveTarget(picked, { current: current(), name: basename(defaultDir) }));
  });
  ipcMain.handle("data-dir-default", () => describe(checkTarget(defaultDir, current())));
  ipcMain.handle("data-dir-move", (_e, dir: unknown, copy: unknown) =>
    typeof dir === "string" ? move(dir, copy === true) : "That isn't a folder.",
  );
  ipcMain.on("data-dir-show", () => void shell.openPath(current()));
}

/** A launch that can't run on the data. It ends by relaunching or quitting, never by booting. */
export function settleData(launch: Exclude<DataLaunch, { kind: "run" }>): Promise<void> {
  return launch.kind === "move" ? moveData(launch.from, launch.to) : askAboutMissing(launch.dir);
}

async function askAboutMissing(dir: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Comical",
    message: "Comical can't find its data",
    detail: `It was in ${dir}\n\nIf that's on a drive that isn't connected, connect it and try again. Use Default Location goes back to the folder Comical started out with.`,
    buttons: ["Try Again", "Use Default Location", "Quit"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 1) pointTo(defaultDir);
  if (response !== 2) relaunch();
  app.quit();
}

async function moveData(from: string, to: string): Promise<void> {
  const stop = new AbortController();
  const win = await progressWindow(to);
  let settled = false;
  win.on("close", (e) => {
    if (settled) return;
    e.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: "question",
        message: "Stop moving your data?",
        detail: `Comical goes on using it where it is, in ${from}`,
        buttons: ["Keep Going", "Stop"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => response === 1 && stop.abort());
  });

  let shownAt = 0;
  const onProgress = (done: number, total: number) => {
    const now = Date.now();
    if (win.isDestroyed() || (now - shownAt < 100 && done < total)) return;
    shownAt = now;
    win.setProgressBar(total ? done / total : 0);
    void win.webContents.executeJavaScript(`show(${done}, ${total})`).catch(() => {});
  };

  try {
    await copyData(from, to, { onProgress, signal: stop.signal });
    pointTo(to);
  } catch (err) {
    pointTo(from);
    if (!stop.signal.aborted) {
      await dialog.showMessageBox(win, {
        type: "error",
        message: "Couldn't move your data",
        detail: `${failure(err, from)}\n\nComical goes on using it where it was, in ${from}`,
        noLink: true,
      });
    }
  }
  settled = true;
  relaunch();
  app.exit(0);
}

function failure(err: unknown, from: string): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT" && !existsSync(from)) return "The folder it was in isn't there any more.";
  if (code === "ENOSPC") return "The drive ran out of space.";
  if (code === "EACCES" || code === "EPERM") return "Comical wasn't allowed to write there.";
  return err instanceof Error ? err.message : String(err);
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Its own page, inline: the web export's pages want the host this launch doesn't start. */
async function progressWindow(to: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 440,
    height: 150,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Comical",
    icon: shellIcon(),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Comical</title><style>
  :root { color-scheme: light dark; font: 13px system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { margin: 0; padding: 20px 24px; display: grid; gap: 10px; background: Canvas; color: CanvasText; cursor: default; user-select: none; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; }
  p { margin: 0; opacity: 0.7; overflow-wrap: anywhere; }
  progress { width: 100%; }
</style></head><body>
  <h1>Moving your data</h1>
  <p>To ${escapeHtml(to)}</p>
  <progress></progress>
  <p id="status">Getting ready…</p>
<script>
  const units = ["B", "KB", "MB", "GB", "TB"];
  const size = (n) => {
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1; }
    return (unit <= 1 ? Math.round(n) : Math.round(n * 10) / 10) + " " + units[unit];
  };
  window.show = (done, total) => {
    const bar = document.querySelector("progress");
    bar.max = total || 1;
    bar.value = done;
    document.getElementById("status").textContent = size(done) + " of " + size(total);
  };
</script></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  win.show();
  return win;
}
