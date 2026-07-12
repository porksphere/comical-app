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
const devClient = process.env.COMICAL_DEVCLIENT === '1';

module.exports = {
  dependencies: devClient
    ? {}
    : {
        'react-native-release-profiler': { platforms: { ios: null, android: null } },
      },
};
