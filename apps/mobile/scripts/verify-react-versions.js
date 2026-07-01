#!/usr/bin/env node

// React Native bundles its own copy of react-native-renderer directly inside
// the react-native package's published files (Libraries/Renderer/implementations/
// ReactNativeRenderer-*.js) — it is NOT a resolvable npm dependency, so nothing
// in the install graph can warn about a mismatch. react-native's package.json
// declares a caret peer dependency on react (e.g. "^19.2.3"), which is too loose
// to catch this: the actual constraint is exact-version equality with whatever
// react the bundled renderer was built against, and a perfectly semver-valid
// bump (19.2.3 -> 19.2.7) silently breaks it. The mismatch doesn't surface until
// the app's very first render, where it crashes immediately and fatally — on
// iOS, in production, with no redbox and no on-screen message, just a hard
// process abort. That cost a full evening chasing it as an app bug across nine
// build/deploy cycles before a native-level crash-handler hook finally
// surfaced the real error.
//
// Catch it at install time instead: grep the version react-native-renderer
// reports itself as out of the bundled file, and compare it to the actually
// installed `react` version.

const fs = require('fs');

function fail(message) {
  console.error(`\nerror: ${message}\n`);
  process.exit(1);
}

let reactVersion;
try {
  reactVersion = require('react/package.json').version;
} catch {
  // react isn't installed (e.g. a partial/filtered install) — nothing to check.
  process.exit(0);
}

let rendererPath;
try {
  rendererPath = require.resolve(
    'react-native/Libraries/Renderer/implementations/ReactNativeRenderer-prod.js',
  );
} catch {
  process.exit(0);
}

const rendererSrc = fs.readFileSync(rendererPath, 'utf8');
// Matches the renderer's own internal version-mismatch check:
//   if ("X.Y.Z" !== isomorphicReactPackageVersion) ... throw "Incompatible React versions..."
const match = rendererSrc.match(/if \("([\d.]+(?:-[\w.]+)?)" !== isomorphicReactPackageVersion\)/);

if (!match) {
  console.warn(
    '[verify-react-versions] Could not locate the bundled react-native-renderer version ' +
      '(react-native internals may have changed) — skipping the react/react-native-renderer ' +
      'match check. Verify manually that `react` matches what this react-native release expects.',
  );
  process.exit(0);
}

const rendererVersion = match[1];

if (rendererVersion !== reactVersion) {
  fail(
    `react (${reactVersion}) and react-native's bundled react-native-renderer ` +
      `(${rendererVersion}) must match EXACTLY — react-native bundles its renderer ` +
      `directly in its own published files, so this can't be expressed as a normal ` +
      `dependency range and nothing else will catch it.\n\n` +
      `  Fix: set "react"/"react-dom" in apps/mobile/package.json to ${rendererVersion} ` +
      `(the version this react-native release was built against), then \`bun install\`.\n\n` +
      `  Mismatches here don't fail to build — they crash the app immediately and fatally ` +
      `on first render, in production, with no on-screen error.`,
  );
}

console.log(`[verify-react-versions] react ${reactVersion} matches react-native-renderer. OK.`);
