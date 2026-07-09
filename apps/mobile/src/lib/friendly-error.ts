/**
 * Maps a raw fetch/bridge error into a short, user-facing sentence for a RetryBlock.
 *
 * Bridges scrape third-party sites, so their failures surface as low-level noise that means nothing
 * to a reader: a bridge method that `threw:` a `JSON.parse` error because the site returned an HTML
 * rate-limit / challenge / error page (`Unrecognized token '<'`), a request timeout, a dropped
 * network. Collapse the common shapes into plain language; the retry affordance stays either way.
 * The raw message is still visible in the network log for debugging — this only changes what the
 * user sees.
 */
export function friendlyError(err: unknown, fallback = "This couldn't load right now. Try again."): string {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (!msg) return fallback;
  // The bridge got HTML / non-JSON back from the source — almost always a transient rate-limit,
  // bot-challenge, or error page from the scraped site (this is the `Unrecognized token '<'` case).
  if (
    msg.includes('json parse') ||
    msg.includes('unexpected token') ||
    msg.includes('unrecognized token') ||
    msg.includes('not valid json')
  ) {
    return 'The source returned an unexpected response — it may be busy or rate-limiting. Try again in a moment.';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'The source took too long to respond. Try again.';
  }
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('networkerror')
  ) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  // Any other error thrown from inside a bridge (the core wraps these as "<method> threw: …"), or a
  // generic bridge failure — keep it vague rather than leaking a scrape assertion / stack noise.
  if (msg.includes('threw:') || msg.includes('bridge')) {
    return "This bridge couldn't load its content right now. Try again.";
  }
  return fallback;
}
