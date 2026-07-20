#!/usr/bin/env node
/**
 * Generates `src/data/embedded/tracker-bundles.generated.json` — the id → built-source-code map the
 * app ships as its v1 on-device tracker install model (see `TrackerBundles`'s doc comment in
 * `@comical/host-rn`'s types.ts: trackers are bundled into the app build rather than
 * registry-installed like bridges, since `comical-trackers`'s registry isn't fully published yet).
 *
 * Sourced from the standalone `comical-trackers` repo (built there via `bun run build`, producing
 * `.build/{id}/dist/tracker.js` per tracker) — same "Comical(-app) sources an external repo, nothing
 * site-specific lives in this tree" pattern `comical/sandbox/demo-server.ts` uses for bridges/trackers
 * server-side. Point at a different checkout with COMICAL_TRACKERS_REPO=/path/to/comical-trackers.
 *
 * Always exits 0 and always leaves a valid (possibly `{}`) JSON file behind — this file is a static
 * Metro import (`startup.ts`), so it must exist and parse even when comical-trackers isn't checked
 * out (e.g. a standalone `comical-app` clone with no workspace siblings, or CI before trackers are
 * published). That case just means zero built-in trackers on-device, the same "start empty" shape
 * already used for registries/installed bridges (see `stores.ts`).
 *
 * Run:  cd comical-trackers && bun run build   (produces the tracker bundles)
 *       cd apps/mobile && bun run build:tracker-bundles
 * Also run by the repo-root `setup.ts` as a best-effort step.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// apps/mobile/scripts -> apps/mobile -> apps -> comical-app -> workspace root.
const WORKSPACE_ROOT = join(SCRIPT_DIR, '..', '..', '..', '..');
const TRACKERS_REPO = process.env.COMICAL_TRACKERS_REPO ?? join(WORKSPACE_ROOT, 'comical-trackers');
const OUT_FILE = join(SCRIPT_DIR, '..', 'src', 'data', 'embedded', 'tracker-bundles.generated.json');
const TRACKER_IDS = ['anilist', 'mal'];

const bundles = {};
for (const id of TRACKER_IDS) {
  const bundlePath = join(TRACKERS_REPO, '.build', id, 'dist', 'tracker.js');
  if (existsSync(bundlePath)) {
    bundles[id] = readFileSync(bundlePath, 'utf8');
    console.log(`✓ ${id} tracker ← ${bundlePath}`);
  }
}

if (Object.keys(bundles).length === 0) {
  console.warn(
    `• No tracker bundles found under ${TRACKERS_REPO}/.build\n` +
      '  Build them:  cd comical-trackers && bun run build   (or set COMICAL_TRACKERS_REPO)\n' +
      '  Writing an empty tracker-bundles.generated.json — the app will show no built-in trackers on-device.',
  );
}

writeFileSync(OUT_FILE, `${JSON.stringify(bundles, null, 2)}\n`);
console.log(`Wrote ${OUT_FILE} (${Object.keys(bundles).length} tracker${Object.keys(bundles).length === 1 ? '' : 's'})`);
