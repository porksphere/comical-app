/**
 * End-to-end check that the shell really renders the app: launches Electron with `COMICAL_CAPTURE`,
 * which loads the window, dumps a DOM probe, writes a PNG and exits (see `main.ts`). Asserts the
 * probe shows a mounted React tree rather than a blank page or the loopback's 404 body.
 *
 * On a headless machine (CI, a container) run it under a virtual display:
 *   xvfb-run -a bun run scripts/launch-check.ts
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
// The `electron` package's default export IS the absolute path to the binary for this platform
// (electron.exe on Windows, Electron.app/… on macOS). Hard-coding `node_modules/electron/dist/
// electron` only works on Linux.
import electron from "electron";

const DESKTOP = join(import.meta.dir, "..");
const ROOT = join(DESKTOP, "..", "..");
const shot = join(DESKTOP, "build", "launch-check.png");

// The submodule's example bridges give the home screen something to render. `test-sprites` is the
// one that needs no network; the other two are expected to show "couldn't load" offline.
const env = {
  ...process.env,
  COMICAL_CAPTURE: shot,
  COMICAL_CAPTURE_DELAY: process.env.COMICAL_CAPTURE_DELAY ?? "12000",
  COMICAL_BRIDGES_DIR: process.env.COMICAL_BRIDGES_DIR ?? join(ROOT, "external", "comical", "bridges"),
};

// `--no-sandbox` only when asked for: needed to run as root in a container, never in a real build.
const args = [...(process.env.COMICAL_NO_SANDBOX ? ["--no-sandbox"] : []), DESKTOP];

const out = await new Promise<string>((resolve, reject) => {
  const child = spawn(electron as unknown as string, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  child.stdout.on("data", (d: Buffer) => (buf += d.toString()));
  child.stderr.on("data", (d: Buffer) => (buf += d.toString()));
  child.on("error", reject);
  child.on("exit", () => resolve(buf));
});

const line = out.split("\n").find((l) => l.startsWith("[capture] "));
if (!line) {
  console.error(out.split("\n").filter((l) => !l.includes("dbus")).join("\n"));
  throw new Error("no capture probe — the window never finished loading");
}

const probe = JSON.parse(line.slice("[capture] ".length)) as { nodes: number; text: string };
console.log(`nodes: ${probe.nodes}`);
console.log(`text:  ${probe.text.replace(/\n/g, " / ").slice(0, 200)}`);
console.log(`shot:  ${shot}`);

const failures: string[] = [];
if (probe.text.trim() === "not found") failures.push("the loopback served its 404 body — web export missing? run `bun run build:web`");
if (probe.nodes < 20) failures.push(`only ${probe.nodes} DOM nodes — the React tree did not mount`);
if (!/Comical|Home|Search/.test(probe.text)) failures.push("app chrome (Comical / Home / Search) not found in the rendered text");

if (failures.length) {
  for (const f of failures) console.error(` FAIL  ${f}`);
  process.exit(1);
}
console.log("\nlaunch check passed — the desktop shell rendered the app");
