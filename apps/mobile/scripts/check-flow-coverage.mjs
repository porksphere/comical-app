#!/usr/bin/env node
// Advisory-only e2e flow coverage check. Never fails the job — this is a nudge, not a gate (unlike
// assert-testids.mjs's mandatory testID rule). It re-derives a small set of "anchor" testIDs
// straight from source (tab bar entries, screen titles, Settings category rows) and warns
// (`::warning::`, so it surfaces on the PR's Checks tab / Files view) about any anchor that isn't
// referenced by ANY committed Maestro flow under apps/mobile/e2e/{mobile,web}/*.yaml.
//
// This can only catch a missing flow for a NEW anchor (a tab, a screen, a Settings category) that
// showed up in source but never got a flow written for it — a coarse, cheap proxy for "did someone
// forget to add e2e coverage for a new top-level screen." It CANNOT tell whether an *existing* flow
// is still accurate for a screen it already covers (a selector could've moved, an assertion could be
// stale) — that's the PR template checklist's job, not this script's.
//
// Usage: node scripts/check-flow-coverage.mjs   (run from apps/mobile)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

const read = (relPath) => {
  try {
    return readFileSync(join(ROOT, relPath), 'utf8');
  } catch {
    return null;
  }
};

// Same slugging rule as src/lib/test-id.ts's `testId()` helper -- kept in sync by hand, since this
// script can't import TS source directly. Only used for the handful of testId('screen-title', ...)
// calls below.
const slugSegment = (part) =>
  String(part)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const anchors = []; // { id, source }

// --- Tab bar: app-tabs.tsx's TABS array, `{ name: 'browse', ... }` entries -> tab.<name> ---
const appTabsSrc = read('src/components/app-tabs.tsx');
if (appTabsSrc) {
  for (const m of appTabsSrc.matchAll(/\{\s*name:\s*'([a-z-]+)'/g)) {
    anchors.push({ id: `tab.${m[1]}`, source: 'src/components/app-tabs.tsx' });
  }
} else {
  console.warn('[check-flow-coverage] could not read src/components/app-tabs.tsx -- skipping tab.* anchors');
}

// --- Screen titles: literal <TabTitleBar title="..."> props -> screen-title.<slug> ---
// Only literal string titles are discoverable statically; screens that build a custom `titleSlot`
// (e.g. library.tsx's search bar) have no single title string and are skipped, not flagged.
const screenTitleFiles = ['src/app/(tabs)/activity.tsx', 'src/app/(tabs)/history.tsx', 'src/app/(tabs)/settings.tsx'];
for (const file of screenTitleFiles) {
  const src = read(file);
  if (!src) continue;
  for (const m of src.matchAll(/<TabTitleBar\s+title="([^"{}]+)"/g)) {
    anchors.push({ id: `screen-title.${slugSegment(m[1])}`, source: file });
  }
}

// --- Settings categories: literal testID="settings.category.*" rows in the Settings screen ---
const settingsSrc = read('src/app/(tabs)/settings.tsx');
if (settingsSrc) {
  for (const m of settingsSrc.matchAll(/testID="(settings\.category\.[a-z-]+)"/g)) {
    anchors.push({ id: m[1], source: 'src/app/(tabs)/settings.tsx' });
  }
} else {
  console.warn('[check-flow-coverage] could not read src/app/(tabs)/settings.tsx -- skipping settings.category.* anchors');
}

// --- Collect every committed flow's raw text (mobile + web) ---
const flowDirs = ['e2e/mobile', 'e2e/web'];
let flowText = '';
for (const dir of flowDirs) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.yaml')) continue;
    flowText += read(join(dir, entry)) ?? '';
  }
}

const missing = anchors.filter((a) => !flowText.includes(a.id));

if (missing.length === 0) {
  console.log(`[check-flow-coverage] ✔ all ${anchors.length} tracked anchors (tab.*, screen-title.*, settings.category.*) are referenced by a flow.`);
  process.exit(0);
}

for (const { id, source } of missing) {
  console.log(`::warning file=${source}::e2e coverage: no flow under apps/mobile/e2e/{mobile,web} references anchor "${id}" -- consider adding one if this is a new screen/tab/category.`);
}
console.log(
  `[check-flow-coverage] ${missing.length}/${anchors.length} anchor(s) unreferenced by any flow (advisory only, does not fail this job). See apps/mobile/e2e/README.md.`,
);
process.exit(0);
