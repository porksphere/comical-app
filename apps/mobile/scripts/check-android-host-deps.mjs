/**
 * The Expo module compiles comical's host-android SOURCES directly (sourceSets onto the submodule),
 * so host-android's build.gradle.kts is never evaluated here and its runtime dependencies have to be
 * repeated in modules/comical-runtime/android/build.gradle. Two lists, hand-copied, with nothing but
 * a "keep in sync" comment between them: a version bump on either side is invisible to the other
 * until a device build fails to link — or worse, links against an older artifact and misbehaves
 * at runtime. So this FAILS the build when the two disagree.
 *
 * Only `implementation` (runtime) coordinates are compared. host-android's androidTest* deps
 * belong to its own instrumented tests, which the module never compiles.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULE = 'modules/comical-runtime/android/build.gradle';
const HOST = join('..', '..', 'external', 'comical', 'packages', 'host-android', 'build.gradle.kts');

/** `implementation("g:a:v")` (Kotlin DSL) and `implementation "g:a:v"` (Groovy) → Map<"g:a", "v">. */
function runtimeDeps(file) {
  const deps = new Map();
  for (const m of readFileSync(file, 'utf8').matchAll(/^\s*implementation\s*\(?\s*["']([^"':]+:[^"':]+):([^"']+)["']/gm)) {
    deps.set(m[1], m[2]);
  }
  return deps;
}

const module = runtimeDeps(MODULE);
const host = runtimeDeps(HOST);
const problems = [];

for (const [coord, version] of host) {
  const ours = module.get(coord);
  if (ours === undefined) problems.push(`${coord}: host-android needs ${version}, the module doesn't declare it`);
  else if (ours !== version) problems.push(`${coord}: host-android has ${version}, the module has ${ours}`);
}
for (const coord of module.keys()) {
  if (!host.has(coord)) problems.push(`${coord}: the module declares it, host-android doesn't (drop it, or add it there)`);
}

if (host.size === 0) problems.push(`no implementation() deps parsed from ${HOST} — is the submodule checked out?`);

if (problems.length) {
  console.error(`Android host dependencies out of sync between ${MODULE} and comical's host-android:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-android-host-deps: ${host.size} runtime deps match host-android`);
