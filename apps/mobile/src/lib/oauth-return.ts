/**
 * What comes back from a tracker sign-in. Every provider redirects to one hosted relay page
 * (`public/oauth-relay.html`), and the relay forwards its answer to the app as a `comical://` link:
 * `oauth-callback?code=…&state=…` for a code exchange, `oauth-token#access_token=…` for an implicit
 * grant, either with `error=…` instead. On a phone the in-app auth session intercepts that link; in
 * the desktop shell it arrives as an `open` command, and `deliverOAuthReturn` hands it to whoever
 * is waiting in `awaitOAuthReturn`.
 */

export type OAuthReturn = { code?: string; state?: string; token?: string; error?: string };

/** Parsed by hand: `URL` is spotty on Hermes/JSC, and a `comical://` link isn't one it parses well anyway. */
function pairs(part: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of part.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    try {
      out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function parseOAuthReturn(url: string): OAuthReturn {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);
  const p = { ...pairs(hash), ...pairs(query) };
  const r: OAuthReturn = {};
  if (p.code) r.code = p.code;
  if (p.state) r.state = p.state;
  if (p.access_token) r.token = p.access_token;
  // The relay has already folded a provider's description into `error`; a raw provider fragment
  // (the implicit flow is bounced through untouched) still carries the spec's shape.
  if (p.error) r.error = p.error_description || p.message || p.error;
  return r;
}

const RETURN_ROUTE = /^\/oauth-(?:callback|token)(?:[?#]|$)/;

export function isOAuthReturnRoute(route: string): boolean {
  return RETURN_ROUTE.test(route);
}

/** Ten minutes: the router forgets a pending exchange after that, so there's nothing to wait for. */
const RETURN_TIMEOUT_MS = 10 * 60 * 1000;

let waiting: ((r: OAuthReturn | null) => void) | null = null;

/** The next OAuth return the shell delivers; `null` if none comes in time or a newer sign-in
 *  replaces this one. */
export function awaitOAuthReturn(): Promise<OAuthReturn | null> {
  waiting?.(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(null), RETURN_TIMEOUT_MS);
    const settle = (r: OAuthReturn | null) => {
      if (waiting !== settle) return;
      waiting = null;
      clearTimeout(timer);
      resolve(r);
    };
    waiting = settle;
  });
}

/** Consume an OAuth return route. True when it was one — whether or not anything was waiting, since
 *  a sign-in nobody is waiting for is still not a page to navigate to. */
export function deliverOAuthReturn(route: string): boolean {
  if (!isOAuthReturnRoute(route)) return false;
  waiting?.(parseOAuthReturn(route));
  return true;
}
