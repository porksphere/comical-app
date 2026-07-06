#!/usr/bin/env bun
/**
 * One-shot setup for a fresh clone of the Comical app.
 *
 *   bun run setup      (or: bun setup.ts)
 *
 * The app's native bridge runtime lives in the `comical` git submodule at
 * `external/comical`, and pulls three things from it that a fresh clone lacks:
 *
 *   1. the submodule contents themselves (Kotlin host + @comical/* JS sources);
 *   2. the submodule's *hoisted* node_modules — Metro (apps/mobile/metro.config.js)
 *      only searches `external/comical/node_modules`, so hono/zod/cheerio must be
 *      hoisted there, not tucked into per-package node_modules (bun's non-default
 *      layout). Without this Metro fails to bundle: "Unable to resolve module hono";
 *   3. the generated QuickJS harness `comical_harness.js` (built by the submodule's
 *      `build:native`). It's gitignored/generated, and baked into the APK as an
 *      asset — without it every bridge init fails at runtime with
 *      "FileNotFoundException: comical_harness.js".
 *
 * This script runs all of that (plus the app's own `bun install`) so the next
 * step is just `bun run android` (a dev build — see apps/mobile/modules/
 * comical-runtime/SETUP.md). Re-running is safe/idempotent. NOTE: the harness is
 * an APK asset, so if you regenerate it later you must rebuild+reinstall the APK;
 * a Metro reload alone won't pick it up.
 */
import { spawnSync } from "bun";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const COMICAL = join(ROOT, "external", "comical");

/** Run a command, streaming its output; abort the whole setup if it fails. */
function run(cmd: string[], cwd: string, label: string): void {
  console.log(`\n==> ${label}`);
  console.log(`    ${cmd.join(" ")}  (in ${cwd})`);
  const { exitCode } = spawnSync(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  if (exitCode !== 0) {
    console.error(`\n✗ Step failed (exit ${exitCode}): ${label}`);
    process.exit(exitCode ?? 1);
  }
}

// 1. Fetch the comical submodule (pinned commit).
run(["git", "submodule", "update", "--init", "--recursive"], ROOT, "Checking out the external/comical submodule");

// 2. App + workspace deps.
run(["bun", "install"], ROOT, "Installing app dependencies");

// 3. Submodule deps, HOISTED so Metro can resolve hono/zod/cheerio from
//    external/comical/node_modules (see metro.config.js).
run(["bun", "install", "--linker", "hoisted"], COMICAL, "Installing submodule dependencies (hoisted)");

// 4. Generate the QuickJS harness (comical_harness.js / harness.js) the native runtime loads.
run(["bun", "run", "build:native"], COMICAL, "Generating the native runtime harness");

console.log("\n✓ Setup complete. Next:");
console.log("    bun run android      # Android dev build on an emulator/device");
console.log("    bun run dev          # Expo web dev server");
console.log("  (Remember to start the backend: cd ../comical-web && bun run dev)\n");
