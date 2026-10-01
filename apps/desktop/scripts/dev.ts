/**
 * Desktop dev loop: the Electron shell on a live Metro dev server.
 *
 *   bun run dev        (from apps/desktop)
 *
 * The renderer hot-reloads like `bun run dev` at the repo root does in a browser — the window loads
 * Metro through the loopback listener (`COMICAL_DEV_SERVER`, see `src/host/serve.ts`) rather than a
 * static export. The main process can't hot-reload, so a change under `src/` or in the `@comical/*`
 * packages it bundles rebuilds it and relaunches Electron. Closing the window ends the session.
 *
 * An already-running Metro on the port (the repo root's `bun run dev`) is reused rather than
 * killed: it serves the web bundle just the same.
 *
 * The listener gets a FIXED port here: the renderer's localStorage is keyed by origin, so an
 * ephemeral port would start every relaunch with empty preferences.
 */
import { spawn, spawnSync, type Subprocess } from "bun";
import { statSync, watch } from "node:fs";
import { join } from "node:path";
import electron from "electron";

const DESKTOP = join(import.meta.dir, "..");
const ROOT = join(DESKTOP, "..", "..");
const MOBILE = join(ROOT, "apps", "mobile");
const METRO_PORT = Number(process.env.METRO_PORT ?? 8081);
const METRO = `http://localhost:${METRO_PORT}`;
const isWindows = process.platform === "win32";

function killTree(pid: number): void {
  if (isWindows) spawnSync(["taskkill", "/F", "/T", "/PID", String(pid)]);
  else spawnSync(["kill", "-9", String(pid)]);
}

async function metroUp(): Promise<boolean> {
  try {
    return (await (await fetch(`${METRO}/status`)).text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

let metro: Subprocess | null = null;
if (await metroUp()) {
  console.log(`==> Reusing the Metro already on :${METRO_PORT}`);
} else {
  console.log(`==> Starting Metro on :${METRO_PORT}`);
  metro = spawn({
    cmd: ["bunx", "expo", "start", "--port", String(METRO_PORT)],
    cwd: MOBILE,
    env: { ...process.env },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  while (!(await metroUp())) {
    if (metro.exitCode !== null) throw new Error(`Metro exited (${metro.exitCode})`);
    await Bun.sleep(500);
  }
}

let builtAt = 0;

function buildMain(): boolean {
  builtAt = Date.now();
  const { exitCode } = spawnSync(["bun", "run", "scripts/build-main.ts"], {
    cwd: DESKTOP,
    stdout: "inherit",
    stderr: "inherit",
  });
  return exitCode === 0;
}

let app: Subprocess | null = null;
let restarting = false;

function launch(): void {
  app = spawn({
    cmd: [electron as unknown as string, DESKTOP],
    cwd: DESKTOP,
    env: {
      ...process.env,
      COMICAL_DEV_SERVER: METRO,
      COMICAL_PORT: process.env.COMICAL_PORT ?? "38100",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const self = app;
  void self.exited.then(() => {
    if (!restarting && app === self) shutdown();
  });
}

async function relaunch(): Promise<void> {
  restarting = true;
  if (app?.pid) {
    killTree(app.pid);
    await app.exited;
  }
  if (buildMain()) launch();
  else console.error("==> main-process build failed; fix it and save again");
  restarting = false;
}

/** Windows reports a file being READ as a change too (libuv watches last-access time), and bundling
 *  the main process reads every file under both roots — so without the mtime test each build would
 *  schedule the next. A deleted file has nothing to stat, and is a real change. */
function editedSinceBuild(path: string): boolean {
  try {
    return statSync(path).mtimeMs > builtAt;
  } catch {
    return true;
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;
const onChange = (root: string) => (_event: string, file: string | null): void => {
  if (file && (!/\.tsx?$/.test(file) || file.includes("node_modules"))) return;
  if (file && !editedSinceBuild(join(root, file))) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    console.log(`\n==> ${file ?? "main process"} changed — rebuilding and relaunching`);
    void relaunch();
  }, 200);
};

const watchers = [join(DESKTOP, "src"), join(ROOT, "external", "comical", "packages")].map((root) =>
  watch(root, { recursive: true }, onChange(root)),
);

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const w of watchers) w.close();
  if (app?.pid) killTree(app.pid);
  if (metro?.pid) killTree(metro.pid);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (!buildMain()) process.exit(1);
launch();
console.log(`==> Electron up on ${METRO}. Renderer edits hot-reload; main-process edits relaunch.`);
