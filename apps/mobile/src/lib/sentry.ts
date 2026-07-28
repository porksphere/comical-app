// DSN is intentionally not secret (write-only, safe to expose client-side per
// Sentry's own docs) — same pattern as API_BASE in data/api.ts.
export const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  'https://940637967e832057b44b527fb1122774@o4511662386446336.ingest.us.sentry.io/4511662559526912';

// Which CI build produced this binary — baked in by each workflow's job-level env (see
// build-ios-reusable.yml / build-android-reusable.yml): ios-devclient, ios-main, ios-pr,
// ios-release, ios-e2e, android-main, android-pr, android-release, android-e2e, web-pages,
// web-docker. Unset outside CI (a local `bun run dev`/`bun start` Metro session), so crashes from
// local iteration are still distinguishable from every shipped build.
//
// Defined HERE, and re-exported by lib/build-info.ts as `BUILD_CHANNEL` (the About screen shows the
// same value), rather than the other way round: this module must stay import-free so `bun test` can
// load sentry.test.ts without dragging in build-info's `react-native` import, whose Flow-typed
// index.js the runner can't parse.
export const SENTRY_BUILD_CHANNEL = process.env.EXPO_PUBLIC_COMICAL_BUILD_CHANNEL || 'local-dev';

// The `*-e2e` channels are Maestro's CI builds (e2e.yml), driven by an XCTest/UIAutomator
// synthetic tap/type harness on top of GitHub's macOS runners — capped at 3 vCPUs for the iOS
// Simulator, versus 6+ on a real device or a developer's own Mac. That contention routinely trips
// the native App Hang watchdog on an ordinary TextInput.focus() (COMICAL-APP-1M/1K/1D: every
// occurrence was build_type "simulator" + this exact channel, none ever seen on a real device or a
// manual dev-client run) — noise, not a reproducible app defect. `enableAppHangTracking` is
// disabled for exactly these channels; every other channel, including a developer's own simulator,
// keeps it, since a real hang there is still actionable.
export const isE2eBuildChannel = (channel: string): boolean => channel.endsWith('-e2e');
