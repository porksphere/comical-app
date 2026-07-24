// DSN is intentionally not secret (write-only, safe to expose client-side per
// Sentry's own docs) — same pattern as API_BASE in data/api.ts.
export const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  'https://940637967e832057b44b527fb1122774@o4511662386446336.ingest.us.sentry.io/4511662559526912';

// Which CI build produced this binary — baked in by each workflow's job-level env (see
// build-ios-reusable.yml / build-android-reusable.yml): ios-devclient, ios-main, ios-pr,
// ios-release, ios-e2e, android-main, android-pr, android-release, android-e2e. Unset outside CI
// (a local `bun run dev`/`bun start` Metro session), so crashes from local iteration are still
// distinguishable from every shipped build.
export const SENTRY_BUILD_CHANNEL = process.env.EXPO_PUBLIC_COMICAL_BUILD_CHANNEL || 'local-dev';
