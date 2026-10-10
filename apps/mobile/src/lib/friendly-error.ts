/** Longest an error is shown raw before it is cut — a toast line, not a stack trace. */
export const SHORT_ERROR_MAX = 90;

// A Windows drive path, or a POSIX one of two or more segments that doesn't sit inside a URL.
const ABSOLUTE_PATH = /(?<![\w:/])(?:[A-Za-z]:[\\/][^\s"'`]*|\/[^\s"'`/]+(?:\/[^\s"'`/]+)+\/?)/g;

/** A server's own data directory says nothing to the reader and would fill the toast on its own. */
function shortenPaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, (path) => {
    const sep = path.includes('\\') ? '\\' : '/';
    const last = path.split(/[\\/]/).filter(Boolean).pop();
    return last ? `…${sep}${last}` : path;
  });
}

/**
 * The raw error, cut down to one line that fits a toast: its first line, whitespace collapsed, a
 * leading `Error:` dropped, file paths down to their last segment, and truncated with an ellipsis.
 * Unlike {@link friendlyError} this keeps what actually went wrong — it's for someone who asked to
 * see the failures.
 */
export function shortError(err: unknown, max = SHORT_ERROR_MAX): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const first = (raw.split('\n').find((l) => l.trim()) ?? '').replace(/^\s*Error:\s*/i, '');
  const line = shortenPaths(first).replace(/\s+/g, ' ').trim();
  if (!line) return 'Request failed';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** An error whose message was written for the user — {@link friendlyError} shows it as is. */
export class UserFacingError extends Error {
  override name = 'UserFacingError';
}

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
  if (err instanceof UserFacingError) return err.message;
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
  // A bridge or tracker refused to run without a setting it needs (the SDK's `requireString`) —
  // for a tracker that is the sign-in. Nothing transient about it: the fix is on its settings
  // screen, so don't send the user back to a retry that will fail the same way.
  if (/setting "[^"]*" is required/.test(msg)) {
    return 'A required setting is missing — sign in or fill it in on the settings screen first.';
  }
  // Any other error thrown from inside a bridge (the core wraps these as "<method> threw: …"), or a
  // generic bridge failure — keep it vague rather than leaking a scrape assertion / stack noise.
  if (msg.includes('threw:') || msg.includes('bridge')) {
    return "This bridge couldn't load its content right now. Try again.";
  }
  return fallback;
}
