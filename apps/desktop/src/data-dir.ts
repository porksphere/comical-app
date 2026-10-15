/**
 * The data folder as files: where it is, what counts as one, and copying one onto another. Nothing
 * here knows about Electron — `data-location.ts` decides when any of it runs.
 */
import { constants, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readlink, rename, rm, statfs, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/** The host's own data inside the data folder: `main.ts`'s `dataDir`. */
export const HOST_DIR = "comical";

/** Always in the DEFAULT folder, wherever the data is, since it's what says where that is. */
export const POINTER_FILE = "data-location.json";

/** The profile a launch runs on while it copies the data or asks about a folder that's gone, so it
 *  has neither the old copy nor the new one open. In the default folder because that one always
 *  exists and always belongs to this user. */
export const SCRATCH_DIR = ".moving";

/** Where a copy is put together: inside the folder it's going to, so putting it in place is renames. */
const STAGING_DIR = ".comical-incoming";
/** Where whatever a copy replaces waits until the copy is in place. */
const REPLACED_DIR = ".comical-replaced";

/**
 * Left out of a copy. The move's own working folders. Chromium's process locks and debugging port,
 * which name a process that has exited, so the copy would read as already open. And its caches,
 * which it rebuilds on its own and which are much of a profile's size.
 */
const LEFT_BEHIND = new Set([
  POINTER_FILE,
  SCRATCH_DIR,
  STAGING_DIR,
  REPLACED_DIR,
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
  "DevToolsActivePort",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GrShaderCache",
  "ShaderCache",
  "Crashpad",
]);

/** Files Finder and Explorer drop into a folder just by showing it. */
const LITTER = new Set([".DS_Store", "desktop.ini", "Thumbs.db"]);

export type Pointer = {
  /** Where the data is. Absent: the default folder. */
  dir?: string;
  /** The next launch copies the data here from this folder before it runs. */
  copyFrom?: string;
  /** Nothing has run there yet, so an empty folder is what's expected, not a drive that isn't connected. */
  fresh?: boolean;
};

export function readPointer(file: string): Pointer {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // No file, or one that doesn't parse: the default folder.
    return {};
  }
  const path = (value: unknown) => (typeof value === "string" && isAbsolute(value) ? value : undefined);
  const pointer: Pointer = {};
  if (path(raw.dir)) pointer.dir = path(raw.dir);
  if (path(raw.copyFrom)) pointer.copyFrom = path(raw.copyFrom);
  if (raw.fresh === true) pointer.fresh = true;
  return pointer;
}

/** Written beside itself and renamed over: a launch that read half a pointer would lose the data. */
export function writePointer(file: string, pointer: Pointer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(pointer, null, 2));
  renameSync(`${file}.tmp`, file);
}

/** Written into the host's folder by the shell itself: its settings on a folder's first launch (the
 *  port it bound, `shell-settings.ts`), and the window's place on every close (`window-state.ts`). */
const SHELL_FILES = ["desktop-settings.json", "window-state.json"];

/** A folder Comical's data has been in. Known by the shell's own files rather than by a folder
 *  called "comical", which a folder of comics might well have — and that is not a library to open,
 *  or to copy over. Chromium's profile is no help: on Linux it doesn't even write `Local State`. */
export function isDataFolder(dir: string): boolean {
  return SHELL_FILES.some((name) => {
    try {
      return statSync(join(dir, HOST_DIR, name)).isFile();
    } catch {
      return false;
    }
  });
}

/** A folder that isn't there counts: it's made on the way in. */
export function isEmptyFolder(dir: string): boolean {
  try {
    return readdirSync(dir).every((name) => LITTER.has(name));
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** Resolved through links as far as the path exists, so two spellings of one folder compare equal,
 *  and folded where the file system ignores case (as Windows' and macOS's do unless told not to). */
function canonical(path: string): string {
  let head = resolve(path);
  let tail = "";
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) break;
    tail = tail ? join(parse(head).base, tail) : parse(head).base;
    head = up;
  }
  let real = head;
  try {
    real = realpathSync.native(head);
  } catch {
    // Unreadable on the way down: the path as written is the best there is.
  }
  const full = tail ? join(real, tail) : real;
  return process.platform === "linux" ? full : full.toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

/** `inner` is somewhere under `outer`, and not `outer` itself. */
export function isInside(inner: string, outer: string): boolean {
  const rel = relative(canonical(outer), canonical(inner));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export type Target = {
  dir: string;
  /** It already has a Comical library: opening it uses that, and a copy replaces it. */
  holdsData: boolean;
};

export type Problem = { problem: string };

/**
 * Whether the data can move from `current` to `dir` at all. Not into or around itself: a copy into
 * its own folder never finishes, and one over the folder it comes from replaces its own source.
 */
export function checkTarget(dir: string, current: string): Target | Problem {
  if (samePath(dir, current)) return { problem: "Comical already keeps its data there." };
  if (isInside(dir, current)) return { problem: "That folder is inside the one Comical uses now." };
  if (isInside(current, dir)) return { problem: "The folder Comical uses now is inside that one." };
  return { dir: resolve(dir), holdsData: isDataFolder(dir) };
}

/**
 * Where a folder the user picked puts the data: in the folder itself when it's empty or already a
 * data folder, and otherwise in one called `name` inside it, so a profile's few dozen entries don't
 * land among the user's own files. A drive's root always gets the folder.
 */
export function resolveTarget(picked: string, { current, name }: { current: string; name: string }): Target | Problem {
  let dir = resolve(picked);
  if (parse(dir).root === dir || !(isEmptyFolder(dir) || isDataFolder(dir))) {
    dir = join(dir, name);
    if (!isEmptyFolder(dir) && !isDataFolder(dir)) return { problem: `There's already a folder called “${name}” there.` };
  }
  return checkTarget(dir, current);
}

type Entry = { path: string; kind: "dir" | "file" | "link"; bytes: number };

/** Everything a copy of `from` takes, each folder listed before what's in it. */
async function walk(from: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const pending = [""];
  while (pending.length) {
    const at = pending.pop()!;
    for (const item of await readdir(join(from, at), { withFileTypes: true })) {
      if (!at && LEFT_BEHIND.has(item.name)) continue;
      const path = at ? join(at, item.name) : item.name;
      if (item.isDirectory()) {
        entries.push({ path, kind: "dir", bytes: 0 });
        pending.push(path);
      } else if (item.isSymbolicLink()) {
        entries.push({ path, kind: "link", bytes: 0 });
      } else if (item.isFile()) {
        entries.push({ path, kind: "file", bytes: (await lstat(join(from, path))).size });
      }
    }
  }
  return entries;
}

/** What a copy of the data in `dir` comes to. */
export async function dataSize(dir: string): Promise<number> {
  return (await walk(dir)).reduce((sum, entry) => sum + entry.bytes, 0);
}

/** Space free on the drive `dir` is on, or would be once made; null where that can't be told. */
export async function freeSpace(dir: string): Promise<number | null> {
  let at = resolve(dir);
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  try {
    const stats = await statfs(at);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/**
 * Make `to` hold a copy of the data in `from`, entry by entry: an entry `to` already has is replaced,
 * one only `to` has is left as it is, and nothing in `from` is touched. The copy is put together
 * in a staging folder inside `to` and only then renamed into place, so one that fails or is stopped
 * part way leaves `to` as it found it.
 */
export async function copyData(
  from: string,
  to: string,
  { onProgress, signal }: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const entries = await walk(from);
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const staging = join(to, STAGING_DIR);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    let done = 0;
    onProgress?.(done, total);
    for (const entry of entries) {
      signal?.throwIfAborted();
      const source = join(from, entry.path);
      const dest = join(staging, entry.path);
      if (entry.kind === "dir") {
        await mkdir(dest, { recursive: true });
      } else if (entry.kind === "link") {
        await symlink(await readlink(source), dest);
      } else {
        await copyFile(source, dest, constants.COPYFILE_FICLONE);
        done += entry.bytes;
        onProgress?.(done, total);
      }
    }
    signal?.throwIfAborted();
    await swapIn(staging, to);
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** Each entry renamed into place, with whatever it replaces renamed aside first. One that can't be
 *  puts back everything already moved, so `to` is never left half old and half new. */
async function swapIn(staging: string, to: string): Promise<void> {
  const replaced = join(to, REPLACED_DIR);
  await rm(replaced, { recursive: true, force: true });
  await mkdir(replaced);
  const moved: { name: string; displaced: boolean }[] = [];
  try {
    for (const name of await readdir(staging)) {
      const target = join(to, name);
      const displaced = await lstat(target).then(
        () => true,
        () => false,
      );
      if (displaced) await rename(target, join(replaced, name));
      moved.push({ name, displaced });
      await rename(join(staging, name), target);
    }
  } catch (err) {
    for (const { name, displaced } of moved.reverse()) {
      await rename(join(to, name), join(staging, name)).catch(() => {});
      if (displaced) await rename(join(replaced, name), join(to, name)).catch(() => {});
    }
    // Not removed: whatever couldn't be put back is still in it.
    throw err;
  }
  // The copy is in place by now. What it replaced not going away is untidy, not a failed move.
  await rm(replaced, { recursive: true, force: true }).catch((err: unknown) => console.error("[data-dir] cleanup failed:", err));
  await rm(staging, { recursive: true, force: true }).catch(() => {});
}
