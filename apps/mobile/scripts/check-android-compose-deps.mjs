/**
 * modules/material-navigation is composed inside @expo/ui's Host, so its Compose and Material 3
 * artifacts have to be the versions @expo/ui builds against: an older Material library on the
 * classpath resolves upward silently, a newer one moves @expo/ui onto a library it was not built
 * for. Each coordinate the module declares must be @expo/ui's, at @expo/ui's version.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const MODULE = 'modules/material-navigation/android/build.gradle';
const EXPO_UI = join(dirname(createRequire(import.meta.url).resolve('@expo/ui/package.json')), 'android', 'build.gradle');

function runtimeDeps(file) {
  const deps = new Map();
  for (const m of readFileSync(file, 'utf8').matchAll(/^\s*implementation\s*\(?\s*["']([^"':]+:[^"':]+):([^"']+)["']/gm)) {
    deps.set(m[1], m[2]);
  }
  return deps;
}

const module = runtimeDeps(MODULE);
const expoUi = runtimeDeps(EXPO_UI);
const problems = [];

for (const [coord, version] of module) {
  const theirs = expoUi.get(coord);
  if (theirs === undefined) problems.push(`${coord}: the module declares it, @expo/ui doesn't`);
  else if (theirs !== version) problems.push(`${coord}: @expo/ui has ${theirs}, the module has ${version}`);
}
if (module.size === 0) problems.push(`no implementation deps parsed from ${MODULE}`);

if (problems.length) {
  console.error(`Compose dependencies out of sync between ${MODULE} and @expo/ui:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-android-compose-deps: ${module.size} Compose deps match @expo/ui`);
