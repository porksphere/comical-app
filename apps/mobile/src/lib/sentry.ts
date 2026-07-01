// DSN is intentionally not secret (write-only, safe to expose client-side per
// Sentry's own docs) — same pattern as API_BASE in data/api.ts.
export const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  'https://940637967e832057b44b527fb1122774@o4511662386446336.ingest.us.sentry.io/4511662559526912';
