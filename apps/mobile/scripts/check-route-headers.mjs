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

/**
 * Every directory holding a `_layout.tsx` is its own navigator, so the check recurses rather than
 * reading the root layout alone. It used to look only at top-level files, which meant moving the
 * settings screens into a stack inside the Settings TAB silently dropped five routes from its count
 * — the check passed by no longer looking at them, which is the failure mode a check is for.
 *
 * A layout that registers NOTHING is not an omission: `(tabs)/settings/_layout.tsx` is a bare
 * `<Stack screenOptions={{ headerShown: false }} />`, which hides the header for every screen in it
 * without naming any. Only a layout that registers some of its screens is expected to register all
 * of them.
 */
function scan(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const layoutFile = entries.find((e) => e.isFile() && /^_layout(\.web)?\.tsx$/.test(e.name));
  if (!layoutFile) return { checked: 0, missing: [] };

  const layout = readFileSync(join(dir, layoutFile.name), 'utf8');
  const registered = new Set([...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]));
  const declaresAny = registered.size > 0;
  // A group directory — `(tabs)` — is not a route name; its own layout is the navigator for what's
  // inside it, and the PARENT registers the group. Directories with a layout are routes to their
  // parent and navigators to their children, so they count as both.
  const isGroup = (name) => name.startsWith('(') && name.endsWith(')');

  const routes = new Set();
  const missing = [];
  let checked = 0;

  for (const e of entries) {
    if (e.isFile()) {
      if (!e.name.endsWith('.tsx') || e.name.startsWith('_') || e.name.startsWith('+')) continue;
      routes.add(e.name.replace(/(\.web)?\.tsx$/, ''));
    } else if (e.isDirectory()) {
      const nested = scan(join(dir, e.name));
      checked += nested.checked;
      missing.push(...nested.missing);
      if (!isGroup(e.name)) routes.add(e.name);
    }
  }

  checked += routes.size;
  if (declaresAny) {
    for (const r of [...routes].sort()) if (!registered.has(r)) missing.push({ dir, layout: layoutFile.name, route: r });
  }
  return { checked, missing };
}

const { checked, missing } = scan(APP_DIR);
if (missing.length) {
  console.error(
    `[check-route-headers] ✖ not registered, so ${missing.length === 1 ? 'it renders' : 'they render'} the default navigator header:`,
  );
  for (const m of missing) console.error(`    ${join(m.dir, m.layout)}: <Stack.Screen name="${m.route}" options={{ headerShown: false }} />`);
  process.exit(1);
}
console.log(`[check-route-headers] ✔ all ${checked} screens in ${APP_DIR} are registered by their navigator.`);
