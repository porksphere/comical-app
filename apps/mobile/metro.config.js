// Metro config for use in a workspace monorepo.
//
// watchFolders + nodeModulesPaths let Metro resolve `@porksphere/core` whether it
// comes from the workspace stub (packages/core), the published GitHub Packages
// version (apps/mobile/node_modules), or a locally `npm link`-ed checkout of the
// real core repo (it will be symlinked into node_modules and its source is under
// the monorepo root, both of which are covered here).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

// getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and also
// injects a Debug ID into the bundle, which the uploaded sourcemap needs to
// correlate against at symbolication time.
const config = getSentryExpoConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
