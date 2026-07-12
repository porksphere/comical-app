// Keep the DEV-only Hermes profiler native module out of production builds.
//
// `react-native-release-profiler` is a regular dependency so Metro can resolve
// its JS during development, but its native pod must NOT ship in the public
// ios-latest / production app — only in the dev-client shell, which the CI build
// marks with COMICAL_DEVCLIENT=1 (job-wide, so both `expo prebuild` and
// `pod install` see it). React Native autolinking (`use_native_modules!` at
// pod-install) reads this file; setting a dependency's platform config to `null`
// drops it from the native build. So: linked in the dev-client build, excluded
// everywhere else. (Local `expo run:ios` without the flag also excludes it,
// which is fine — profiling is done via the CI dev-client build.)
// Linked in the dev-client shell (COMICAL_DEVCLIENT=1) AND in the special "profiling release" build
// (COMICAL_PROFILING=1) — the latter is a Release binary that carries the profiler so we can capture
// a Hermes trace with the dev-mode instrumentation gone. Excluded from the public ios-latest /
// production app, where neither flag is set.
const devClient = process.env.COMICAL_DEVCLIENT === '1';
const profiling = process.env.COMICAL_PROFILING === '1';

module.exports = {
  dependencies:
    devClient || profiling
      ? {}
      : {
          'react-native-release-profiler': { platforms: { ios: null, android: null } },
        },
};
