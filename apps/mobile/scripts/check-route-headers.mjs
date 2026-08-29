/**
 * Every screen in src/app must be registered in _layout.tsx's Stack.
 *
 * An unregistered route still ROUTES — expo-router finds the file — so nothing fails and no test
 * notices. It just renders with the navigator's default header: a second bar above the screen's own
 * TopBar, captioned with the raw route name ("settings-whats-new"). That is exactly how it shipped
 * once, past a typecheck, a lint, 195 tests and a rendered screenshot, which is why this is a check
 * and not a note in AGENTS.md.
 *
 * Unlike check-flow-coverage this FAILS the build. There is no judgement call in it: the repo
 * registers all 24 of its routes with `headerShown: false`, so a missing one is an omission, never
 * a decision.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = 'src/app';
const LAYOUT = join(APP_DIR, '_layout.tsx');

const layout = readFileSync(LAYOUT, 'utf8');
const registered = new Set([...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]));

// Top-level screen files only. `_layout`/`+not-found` are expo-router's own, and a `.web.tsx` is a
// platform variant of a route already named by its base file.
const routes = new Set(
  readdirSync(APP_DIR)
    .filter((f) => f.endsWith('.tsx') && !f.startsWith('_') && !f.startsWith('+'))
    .map((f) => f.replace(/(\.web)?\.tsx$/, '')),
);

const missing = [...routes].filter((r) => !registered.has(r)).sort();
if (missing.length) {
  console.error(
    `[check-route-headers] ✖ not registered in ${LAYOUT}, so ${missing.length === 1 ? 'it renders' : 'they render'} the default navigator header:`,
  );
  for (const r of missing) console.error(`    <Stack.Screen name="${r}" options={{ headerShown: false }} />`);
  process.exit(1);
}
console.log(`[check-route-headers] ✔ all ${routes.size} screens in ${APP_DIR} are registered in the Stack.`);
