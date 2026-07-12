/**
 * Build-time flag: is the on-device Hermes profiler present in THIS build?
 *
 * True in any dev build (`__DEV__`), OR in a special "profiling release" build where CI bakes in
 * `EXPO_PUBLIC_COMICAL_PROFILING=1`. That lets us capture a Hermes trace from a RELEASE binary —
 * where the dev-mode instrumentation that dominates (and distorts) a dev profile is gone — while
 * keeping the profiler and its native pod (see `react-native.config.js`) out of the real production
 * app.
 *
 * `process.env.EXPO_PUBLIC_*` is inlined by Expo at build time, so in a normal production build this
 * folds to `false` and Metro dead-code-strips the profiler `require` in `app/_layout.tsx`.
 */
export const PROFILING_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_COMICAL_PROFILING === '1';
