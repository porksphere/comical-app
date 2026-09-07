import type { BridgeSummary } from '@/data/api';

/**
 * Whether one bridge's favorites can be used right now, and if not, why:
 *
 * - `unsupported` — the bridge doesn't do favorites at all (no star anywhere).
 * - `loading` — the bridge summaries haven't resolved yet, so nothing is known.
 * - `login` — favorites need an account this bridge doesn't have yet; the star becomes the way in.
 * - `available` — logged in (or login-less): the star can be checked and toggled.
 */
export type FavoritesStatus = 'unsupported' | 'loading' | 'login' | 'available';

/**
 * The status a resolved `GET /bridges` summary implies. Pure — no React, no data source — so the
 * rule every favorites surface shares can be unit-tested directly (see favorites-status.test.ts).
 *
 * A bridge's favorites need an account, and an account is its `secret` settings. Two things say a
 * bridge has one, both shipped FREE in the summary: no required setting is still unset
 * (`missingRequired`), and — the case that matters — at least one of its secret settings holds a
 * value (`secretsSet`). The second is the whole point: a favorites bridge declares its login as
 * OPTIONAL settings, since browsing works without an account, so `missingRequired` is empty whether
 * or not the user ever logged in. Gating on it alone lit up a star whose every tap failed silently.
 *
 * `secretsSet` is absent from a host-server older than the field; absent reads as "unknown" and falls
 * back to the `missingRequired` rule alone, never as "logged out" — an old server must not grey every
 * star. A bridge with no secret descriptors at all (its credentials are required settings, say) is
 * judged by `missingRequired` alone too.
 */
export function favoritesStatusOf(summary: BridgeSummary): FavoritesStatus {
  if (!summary.info.capabilities.includes('favorites')) return 'unsupported';
  if (summary.missingRequired.length > 0) return 'login';
  const { secretsSet, settings } = summary;
  if (secretsSet && settings) {
    const secretKeys = settings
      .filter((d) => (d.type === 'string' && !!d.secret) || d.type === 'oauth-pin' || d.type === 'oauth-callback')
      .map((d) => d.key);
    if (secretKeys.length > 0 && !secretKeys.some((k) => secretsSet.includes(k))) return 'login';
  }
  return 'available';
}
