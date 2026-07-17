// Keep the Hermes profiler native module out of the clean PUBLIC release build.
//
// `react-native-release-profiler` is a regular dependency so Metro can resolve
// its JS during development, but its native pod must NOT ship in the public
// tagged-release app (ios-release / release.yml). React Native autolinking
// (`use_native_modules!` at pod-install) reads this file; setting a dependency's
// platform config to `null` drops it from the native build.
//
// It IS linked in two kinds of build, gated by env flags the CI sets job-wide
// (so both `expo prebuild` and `pod install` see them):
//   - the dev-client shell               (COMICAL_DEVCLIENT=1, build-ios-devclient.yml)
//   - the rolling profiling builds        (COMICAL_PROFILING=1, build-ios.yml — every
//     ios-main and ios-pr build is a Release binary carrying the profiler so we can
//     capture a Hermes trace with the dev-mode instrumentation gone).
// Excluded from the public tagged release (neither flag set) and from a plain
// local `expo run:ios` (also fine — profile via a CI profiling build instead).
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
