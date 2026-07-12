#!/usr/bin/env bun
/**
 * Iterative native (iOS/Android) dev from a Windows PC — no Mac in the loop.
 *
 *   bun dev-device.ts   (or: bun run dev:device)
 *
 * Starts a Metro dev server bound to this machine's LAN IP and prints a QR code.
 * You install the **development-client build** once (a debug shell with
 * `expo-dev-client`, built on CI's macOS runner and installed via SideStore —
 * see docs/PROFILING.md → "Iterative Expo dev from Windows"), then open it on a
 * phone on the same Wi-Fi and connect to this server from its launcher (scan the
 * QR or type the URL below). Every JS/TS edit hot-reloads on the device; shake
 * for the dev menu. Only native changes need a fresh CI build.
 *
 * This is the native analogue of dev.ts (which serves react-native-web in a
 * browser): same cross-platform port-freeing and LAN-IP detection, but it runs
 * `expo start --dev-client` instead of `--web` so a real device connects.
 *
 * Like dev.ts it presets EXPO_PUBLIC_COMICAL_SERVER to the sibling comical-web
 * dev server (LAN-addressed so the phone can reach the API too); override with
 * COMICAL_SERVER_PORT or by setting EXPO_PUBLIC_COMICAL_SERVER yourself. Override
 * the Metro port with PORT=8090. Ctrl-C tears everything down and sweeps the port.
 */
import { spawn, spawnSync } from "bun";
import { createSocket } from "node:dgram";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const PORT = Number(process.env.PORT ?? 8081);

/** The IP this machine would use to reach the internet, so phones on the LAN can
 *  reach it too — `localhost` only resolves on the machine itself. Connecting a
 *  UDP socket sends no packets, just asks the OS to pick the outbound interface;
 *  more reliable than the first non-internal interface, since virtual adapters
 *  (VirtualBox, Hyper-V, WSL) often enumerate first and aren't phone-reachable. */
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
  // No /api prefix here: that only exists in prod behind SWAG. Direct dev
  // requests hit host-server's routes at the root (see comical-web/CLAUDE.md).
  process.env.EXPO_PUBLIC_COMICAL_SERVER = `http://${HOST}:${COMICAL_SERVER_PORT}`;
}
// Metro must bind the LAN interface (not localhost) so the phone can reach it.
// REACT_NATIVE_PACKAGER_HOSTNAME makes the QR/URL Expo prints use this IP.
process.env.REACT_NATIVE_PACKAGER_HOSTNAME = HOST;

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
console.log(`==> Starting Metro (dev-client) on :${PORT}...`);
const expo = spawn({
  // --dev-client serves the native bundle for a development build (not Expo Go)
  // and prints a QR the installed dev-client launcher can scan.
  cmd: ["bunx", "expo", "start", "--dev-client", "--port", String(PORT)],
  cwd: mobileDir,
  // Bun.spawn's default env doesn't reflect runtime mutations to process.env
  // (EXPO_PUBLIC_COMICAL_SERVER / REACT_NATIVE_PACKAGER_HOSTNAME above) — pass
  // it explicitly or the child silently falls back to its own defaults.
  env: { ...process.env },
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

console.log("\nMetro dev-client server running. Ctrl-C stops it.");
console.log(`  On your phone: open the Comical (dev) build → scan the QR above,`);
console.log(`  or enter this URL in its launcher:`);
console.log(`      exp://${HOST}:${PORT}\n`);

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down Metro dev-client server...");
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
