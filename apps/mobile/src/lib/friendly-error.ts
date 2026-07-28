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
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (!raw) return fallback;
  // Match against the message with URLs removed. Several of the checks below key off a bare word
  // ("bridge"), and registry/bundle errors embed the URL they failed on — a registry hosted at
  // …/comical-bridges/… made every one of its failures match the bridge catch-all and report
  // "this bridge couldn't load its content", hiding a plain HTTP 404 behind a wrong diagnosis.
  const msg = raw.replace(/https?:\/\/\S+/g, ' ');
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
  // A registry/bundle URL that answered with a status. Unlike the bridge failures below this is a
  // precise, actionable fact about an address the user typed or followed, so say which one it is.
  const status = /\bhttp (\d{3})\b/.exec(msg)?.[1];
  if (status) {
    if (status === '404' || status === '410') {
      return "That address doesn't exist anymore (404). It may have moved or been taken down.";
    }
    if (status === '401' || status === '403') return 'The server refused that request. Check the address and any credentials.';
    if (status.startsWith('5')) return `The server had a problem (HTTP ${status}). Try again in a moment.`;
    return `The server returned an error (HTTP ${status}). Try again.`;
  }
  // A refused registry move: the target index doesn't list anything that's installed here, so
  // following it would silently repoint the library at an unrelated publisher.
  if (msg.includes('refusing to move')) {
    return "The new address doesn't list the bridges installed from this registry, so the move wasn't followed.";
  }
  // Any other error thrown from inside a bridge (the core wraps these as "<method> threw: …"), or a
  // generic bridge failure — keep it vague rather than leaking a scrape assertion / stack noise.
  if (msg.includes('threw:') || msg.includes('bridge')) {
    return "This bridge couldn't load its content right now. Try again.";
  }
  return fallback;
}
