/**
 * Starting the app over. `app.relaunch` hands the restart to a helper process Electron launches
 * under no_new_privs, and an AppImage can't start there: its runtime mounts itself through the
 * setuid `fusermount`, which no_new_privs reduces to an ordinary binary that isn't allowed to
 * mount ("Cannot mount AppImage, please check your FUSE setup"). So an AppImage is started
 * directly, and the new launch does the one thing the helper was for: waiting until this one is
 * gone, since it holds the single-instance lock until it exits.
 */
import { app } from "electron";
import { spawn } from "node:child_process";

const PREDECESSOR = "COMICAL_RELAUNCHED_FROM";
const PREDECESSOR_TIMEOUT_MS = 15_000;

/** Chromium holds its paks, ICU data and the asar open without close-on-exec, and spawn hands them
 *  on: the new launch would pin this one's mount, so its runtime could never unmount it. AppRun is
 *  bash, so bash is there to close them. */
const WITHOUT_INHERITED_FDS = `for fd in /proc/self/fd/*; do n=\${fd##*/}; [ "$n" -gt 2 ] && eval "exec $n<&-"; done; exec "$@"`;

export function relaunch(args: string[]): void {
  const appImage = process.env.APPIMAGE;
  if (!appImage) return app.relaunch({ args });
  spawn("bash", ["-c", WITHOUT_INHERITED_FDS, "relaunch", appImage, ...args], {
    detached: true,
    stdio: "ignore",
    env: relaunchEnv(),
  })
    .on("error", (err) => console.error("[relaunch] failed:", err))
    .unref();
}

/** The runtime and AppRun point the environment into this launch's mount, which goes with it, and
 *  the next launch's runtime prepends its own again. */
function relaunchEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, [PREDECESSOR]: String(process.pid) };
  const mount = process.env.APPDIR;
  if (!mount) return env;
  const inMount = (entry: string) => entry === mount || entry.startsWith(`${mount}/`);
  for (const [key, value] of Object.entries(env)) {
    if (!value?.includes(mount)) continue;
    const kept = value.split(":").filter((entry) => !inMount(entry));
    if (kept.length > 0) env[key] = kept.join(":");
    else delete env[key];
  }
  return env;
}

/** Blocks until the launch that started this one has exited. It runs before `ready`, so there is
 *  nothing to keep responsive, and the lock can't be taken before then anyway. */
export function awaitPredecessor(): void {
  const pid = Number(process.env[PREDECESSOR]);
  delete process.env[PREDECESSOR];
  if (!Number.isInteger(pid) || pid <= 0) return;
  const tick = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + PREDECESSOR_TIMEOUT_MS;
  while (alive(pid) && Date.now() < deadline) Atomics.wait(tick, 0, 0, 50);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
