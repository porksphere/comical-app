// Metro config for use in a workspace monorepo.
//
// watchFolders + nodeModulesPaths let Metro resolve modules from the monorepo root
// and any workspace package, not just apps/mobile/node_modules. This is what lets the
// `@comical/*` packages resolve from the `external/comical` submodule (mapped via
// extraNodeModules below) whose source and node_modules live outside this app dir.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
// The `comical` git submodule — source of the on-device runtime (@comical/*) the embedded transport
// bundles on native (see modules/comical-runtime/SETUP.md). Under monorepoRoot, so watchFolders
// already covers it; its own node_modules (hono/zod/cheerio) is added below.
const comicalRoot = path.resolve(monorepoRoot, 'external/comical');

// getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and also
// injects a Debug ID into the bundle, which the uploaded sourcemap needs to
// correlate against at symbolication time.
const config = getSentryExpoConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
  // The submodule's installed deps (hono, zod, …) that @comical/* import at runtime.
  path.resolve(comicalRoot, 'node_modules'),
];

// Honor the @comical/* packages' `exports` maps so the app can import their Node-free subpaths
// (@comical/host-server/router, @comical/registry/fetcher) without pulling the node:fs barrels.
config.resolver.unstable_enablePackageExports = true;

// Resolve the @comical/* specifiers to the submodule packages (they aren't installed as npm deps —
// only their transitive leaf deps live in the submodule's node_modules, above). The embedded
// transport imports only the Node-free entry points; web never imports them (startup.web.ts no-op).
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  // The reusable RN embedding layer — the app's single runtime entry into the on-device runtime.
  '@comical/host-rn': path.resolve(comicalRoot, 'packages/host-rn'),
  '@comical/host-server': path.resolve(comicalRoot, 'packages/host-server'),
  '@comical/registry': path.resolve(comicalRoot, 'packages/registry'),
  '@comical/core': path.resolve(comicalRoot, 'packages/core'),
  '@comical/library': path.resolve(comicalRoot, 'packages/library'),
  // Bundled on native by host-rn's embedded library wiring (Library + ComicalRuntime over the
  // on-device store); Node-free. Never imported on web (startup.web.ts is a no-op).
  '@comical/runtime': path.resolve(comicalRoot, 'packages/runtime'),
  '@comical/contract': path.resolve(comicalRoot, 'packages/contract'),
};

module.exports = config;
