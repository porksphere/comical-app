import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import {
  checkTarget,
  copyData,
  dataSize,
  HOST_DIR,
  isDataFolder,
  isEmptyFolder,
  POINTER_FILE,
  readPointer,
  resolveTarget,
  SCRATCH_DIR,
  writePointer,
} from "./data-dir.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "data-dir-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(path: string, content = "x"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

/** A data folder as a launch leaves one: a profile beside the host's own folder. */
function dataFolder(dir: string, library = "mine"): string {
  put(join(dir, "Preferences"), "{}");
  put(join(dir, HOST_DIR, "desktop-settings.json"), '{"port":38120}');
  put(join(dir, "Local Storage", "leveldb", "000003.log"), "prefs");
  put(join(dir, HOST_DIR, "library", "library.json"), library);
  put(join(dir, HOST_DIR, "downloads", "blobs", "page-1.webp"), "0123456789");
  return dir;
}

describe("pointer", () => {
  test("round-trips, and reads junk as the default folder", () => {
    const file = join(root, "default", POINTER_FILE);
    expect(readPointer(file)).toEqual({});
    writePointer(file, { dir: join(root, "elsewhere"), copyFrom: join(root, "default") });
    expect(readPointer(file)).toEqual({ dir: join(root, "elsewhere"), copyFrom: join(root, "default") });
    writeFileSync(file, '{"dir": "relative/path", "fresh": "yes"');
    expect(readPointer(file)).toEqual({});
    writeFileSync(file, '{"dir": "relative/path", "fresh": true}');
    expect(readPointer(file)).toEqual({ fresh: true });
  });
});

describe("folders", () => {
  test("a data folder is known by the shell's own files, not by a folder called comical", () => {
    const comics = join(root, "home");
    put(join(comics, HOST_DIR, "issue-1.cbz"));
    expect(isDataFolder(comics)).toBe(false);
    expect(isDataFolder(dataFolder(join(root, "data")))).toBe(true);
    const closedOnce = join(root, "closed-once");
    put(join(closedOnce, HOST_DIR, "window-state.json"), "{}");
    expect(isDataFolder(closedOnce)).toBe(true);
  });

  test("an absent folder and one holding only a file browser's litter are empty", () => {
    expect(isEmptyFolder(join(root, "nope"))).toBe(true);
    put(join(root, "shown", ".DS_Store"));
    expect(isEmptyFolder(join(root, "shown"))).toBe(true);
    put(join(root, "used", "notes.txt"));
    expect(isEmptyFolder(join(root, "used"))).toBe(false);
  });
});

describe("resolveTarget", () => {
  const current = () => dataFolder(join(root, "current"));

  test("uses an empty folder as it is", () => {
    mkdirSync(join(root, "empty"));
    expect(resolveTarget(join(root, "empty"), { current: current(), name: "Comical" })).toEqual({
      dir: join(root, "empty"),
      holdsData: false,
    });
  });

  test("puts the data in a folder of its own inside one that has other things in it", () => {
    put(join(root, "Documents", "taxes.pdf"));
    expect(resolveTarget(join(root, "Documents"), { current: current(), name: "Comical" })).toEqual({
      dir: join(root, "Documents", "Comical"),
      holdsData: false,
    });
  });

  test("opens a data folder as one, whether picked itself or its parent", () => {
    dataFolder(join(root, "Drive", "Comical"), "theirs");
    put(join(root, "Drive", "films", "a.mkv"));
    const picked = { dir: join(root, "Drive", "Comical"), holdsData: true };
    expect(resolveTarget(join(root, "Drive", "Comical"), { current: current(), name: "Comical" })).toEqual(picked);
    expect(resolveTarget(join(root, "Drive"), { current: current(), name: "Comical" })).toEqual(picked);
  });

  test("won't take over a folder of that name that isn't Comical's", () => {
    put(join(root, "Drive", "Comical", "issue-1.cbz"));
    expect(resolveTarget(join(root, "Drive"), { current: current(), name: "Comical" })).toEqual({
      problem: "There's already a folder called “Comical” there.",
    });
  });

  test("a drive's root always gets a folder", () => {
    // A real root, not "/": on Windows "/" resolves to the current drive's root, e.g. D:\.
    const drive = parse(root).root;
    const result = resolveTarget(drive, { current: current(), name: "Comical" });
    expect("dir" in result && result.dir).toBe(join(drive, "Comical"));
  });

  test("refuses the folder it's in, and folders inside or around it", () => {
    const here = current();
    expect(checkTarget(here, here)).toEqual({ problem: "Comical already keeps its data there." });
    expect(checkTarget(join(here, "sub"), here)).toEqual({ problem: "That folder is inside the one Comical uses now." });
    expect(checkTarget(root, here)).toEqual({ problem: "The folder Comical uses now is inside that one." });
    // The parent of the folder in use, picked: it has things in it, so the data's own folder inside
    // it — which is the one in use.
    expect(resolveTarget(root, { current: here, name: "current" })).toEqual({ problem: "Comical already keeps its data there." });
  });

  test("sees through a link to the folder in use", () => {
    const here = current();
    symlinkSync(here, join(root, "alias"));
    expect(checkTarget(join(root, "alias"), here)).toEqual({ problem: "Comical already keeps its data there." });
  });
});

describe("copyData", () => {
  test("copies everything but the caches, locks and pointer, and leaves the source alone", async () => {
    const from = dataFolder(join(root, "from"));
    put(join(from, POINTER_FILE), "{}");
    put(join(from, "Cache", "Cache_Data", "f_000001"), "big");
    put(join(from, SCRATCH_DIR, "Local State"), "{}");
    symlinkSync("host-1234", join(from, "SingletonLock"));
    symlinkSync(join(from, HOST_DIR, "library", "library.json"), join(from, "link-to-library"));

    const progress: [number, number][] = [];
    await copyData(from, join(root, "to"), { onProgress: (done, total) => progress.push([done, total]) });

    const to = join(root, "to");
    expect(readdirSync(to).sort()).toEqual(["Preferences", "Local Storage", HOST_DIR, "link-to-library"].sort());
    expect(readFileSync(join(to, HOST_DIR, "library", "library.json"), "utf8")).toBe("mine");
    expect(readFileSync(join(to, "Local Storage", "leveldb", "000003.log"), "utf8")).toBe("prefs");
    expect(readFileSync(join(to, "link-to-library"), "utf8")).toBe("mine");
    expect(existsSync(join(from, "Cache"))).toBe(true);
    expect(isDataFolder(to)).toBe(true);
    const total = 2 + 14 + 5 + 4 + 10;
    expect(progress[0]).toEqual([0, total]);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(await dataSize(from)).toBe(total);
  });

  test("replaces what the target shares with the source and keeps the rest", async () => {
    const from = dataFolder(join(root, "from"), "mine");
    const to = dataFolder(join(root, "to"), "theirs");
    put(join(to, HOST_DIR, "only-theirs.json"));
    put(join(to, "IndexedDB", "x.leveldb", "LOG"));

    await copyData(from, to);

    expect(readFileSync(join(to, HOST_DIR, "library", "library.json"), "utf8")).toBe("mine");
    // Whole entries are replaced, never merged: a library folder half one and half the other is no library.
    expect(existsSync(join(to, HOST_DIR, "only-theirs.json"))).toBe(false);
    expect(existsSync(join(to, "IndexedDB", "x.leveldb", "LOG"))).toBe(true);
    expect(readdirSync(to).filter((name) => name.startsWith(".comical"))).toEqual([]);
  });

  test("stopped part way, leaves the target as it was", async () => {
    const from = dataFolder(join(root, "from"), "mine");
    const to = dataFolder(join(root, "to"), "theirs");
    const before = readdirSync(to).sort();
    const stop = new AbortController();

    const copying = copyData(from, to, {
      signal: stop.signal,
      onProgress: (done) => {
        if (done > 0) stop.abort();
      },
    });

    expect(copying).rejects.toThrow();
    await copying.catch(() => {});
    expect(readdirSync(to).sort()).toEqual(before);
    expect(readFileSync(join(to, HOST_DIR, "library", "library.json"), "utf8")).toBe("theirs");
  });

  test("fails on a source that isn't there, without touching the target", async () => {
    const to = dataFolder(join(root, "to"), "theirs");
    expect(copyData(join(root, "gone"), to)).rejects.toThrow();
    await copyData(join(root, "gone"), to).catch(() => {});
    expect(readFileSync(join(to, HOST_DIR, "library", "library.json"), "utf8")).toBe("theirs");
  });
});
