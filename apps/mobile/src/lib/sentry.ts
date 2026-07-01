// DSN is intentionally not secret (write-only, safe to expose client-side per
// Sentry's own docs) — same pattern as API_BASE in data/api.ts.
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? 'TODO-SENTRY-DSN';
