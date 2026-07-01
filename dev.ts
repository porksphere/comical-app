#!/usr/bin/env bun
/**
 * Local web dev for the Comical app (Expo + react-native-web).
 *
 *   bun dev.ts          (or: bun run dev)
 *
 * Frees the Metro/web port (killing any stale `expo start` from a prior run —
 * Metro re-parents a worker that keeps holding the socket, and on Windows a
 * lingering listener makes `expo start` drop into an interactive "use another
 * port?" prompt), then starts the Expo web dev server with hot reload and opens
 * it in the browser at http://<lan-ip>:<PORT>. Ctrl-C — or killing this
 * process — tears everything down cleanly via a final port sweep.
 *
 * Also presets EXPO_PUBLIC_COMICAL_SERVER to the sibling comical-web dev
 * server (see comical-web/CLAUDE.md — `bun run dev` there serves on :3100),
 * addressed by LAN IP rather than localhost so a phone on the same network can
 * reach both the Expo web page and the API it calls. Override either half
 * with COMICAL_SERVER_PORT or by setting EXPO_PUBLIC_COMICAL_SERVER yourself
 * before running this script.
 *
 * Mirrors the workspace-root dev.ts (the comical-web orchestrator): same
 * cross-platform port handling, no bash/awk/netstat shell glue. The app is its
 * own stack (Metro, not the comical-web bridge/tracker pipeline), so it runs
 * from its own entry point rather than being folded into that orchestrator.
 *
 * Override the port with PORT=8090 bun run dev.
 */
import { spawn, spawnSync } from "bun";
import { createSocket } from "node:dgram";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const PORT = Number(process.env.PORT ?? 8081);

/** The IP this machine would use to reach the internet, so phones on the LAN
 *  can reach it too — `localhost` only resolves on the machine itself.
 *  Connecting a UDP socket sends no packets, just asks the OS to pick the
 *  outbound interface for that route; this is more reliable than taking the
 *  first non-internal interface, since virtual adapters (VirtualBox, Hyper-V,
 *  WSL) often enumerate before the real Wi-Fi/Ethernet one and aren't
 *  reachable from other devices. */
function lanIp(): Promise<string> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    socket.on("error", () => {
      socket.close();
      resolve("localhost");
    });
    socket.connect(80, "8.8.8.8", () => {
      const { address } = socket.address();
      socket.close();
      resolve(address);
    });
  });
}

const HOST = await lanIp();
const COMICAL_SERVER_PORT = Number(process.env.COMICAL_SERVER_PORT ?? 3100);
if (!process.env.EXPO_PUBLIC_COMICAL_SERVER) {
  process.env.EXPO_PUBLIC_COMICAL_SERVER = `http://${HOST}:${COMICAL_SERVER_PORT}/api`;
}
console.log(`==> API backend: ${process.env.EXPO_PUBLIC_COMICAL_SERVER}`);
console.log(`    (start it with: cd ../comical-web && bun run dev)`);

/** PIDs LISTENING on an exact local port. Metro spawns a child that also holds
 *  the socket and old runs can leave several — so we collect every one. */
function pidsOnPort(port: number): number[] {
  if (isWindows) {
    const out = spawnSync(["netstat", "-ano"]).stdout.toString();
    const pids = new Set<number>();
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // proto local foreign STATE pid
      if (cols.length >= 5 && cols[3] === "LISTENING" && cols[1].endsWith(`:${port}`)) {
        const pid = Number(cols[4]);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  }
  // POSIX
  const out = spawnSync(["lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"]).stdout.toString();
  return out.split(/\s+/).map(Number).filter((p) => Number.isInteger(p) && p > 0);
}

/** Kill a process tree by PID, cross-platform. */
function killTree(pid: number): void {
  if (isWindows) spawnSync(["taskkill", "/F", "/T", "/PID", String(pid)]);
  else spawnSync(["kill", "-9", String(pid)]);
}

function freePort(port: number): void {
  for (const pid of pidsOnPort(port)) {
    console.log(`Killing PID ${pid} on :${port}`);
    killTree(pid);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

freePort(PORT);

const mobileDir = join(ROOT, "apps", "mobile");
console.log(`==> Starting Expo web dev server on :${PORT}...`);
const expo = spawn({
  cmd: ["bunx", "expo", "start", "--web", "--port", String(PORT)],
  cwd: mobileDir,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

console.log("\nExpo web dev server running. Ctrl-C stops it.");
console.log(`  http://${HOST}:${PORT}  (phone-reachable)`);
console.log(`  http://localhost:${PORT}\n`);

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down Expo web dev server...");
  try {
    if (expo.pid) killTree(expo.pid);
  } catch {}
  // Metro re-parents its worker, so the tree-kill above can miss it — sweep the port too.
  freePort(PORT);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Stay alive until the dev server dies (e.g. a crash) or we're signalled.
await expo.exited;
shutdown();
