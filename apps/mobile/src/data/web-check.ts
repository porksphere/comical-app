/**
 * Web checks: a source answered with an anti-bot check that only a person can pass (the host's 403
 * `{ challenge: { url, userAgent } }`). The app opens the page in a web view with the request's own
 * User-Agent, the person passes the check, and the cookies the page leaves are imported into the
 * bridge's cookie jar (`POST /bridges/:id/cookies`), so every later request carries them.
 *
 * This module is the coordinator, free of React: the transport asks it to run a check
 * (`runWebCheck`), a platform runner does the web view part (`registerWebCheckRunner`: the mobile
 * `WebCheckHost`, or the desktop shell), and the import goes through the function the caller hands
 * in, so this file doesn't depend on the API module. One check runs per bridge and site at a time;
 * a request that meets the same check while it runs waits for that one.
 */

export type Challenge = { url: string; userAgent?: string; reason: string };

/** A cookie as the host imports it. */
export type ImportedCookie = { name: string; value: string; domain?: string; path?: string; expires?: number };

/** What a runner hands back once the person is through, or null when they gave up. */
export type WebCheckResult = { cookies: ImportedCookie[]; userAgent?: string } | null;

export type WebCheckRunner = (challenge: Challenge) => Promise<WebCheckResult>;

let runner: WebCheckRunner | null = null;
const inFlight = new Map<string, Promise<boolean>>();

/** Install the platform's runner; returns the uninstall. Only one is active. */
export function registerWebCheckRunner(fn: WebCheckRunner): () => void {
  runner = fn;
  return () => {
    if (runner === fn) runner = null;
  };
}

/** Whether this platform can run a check (a web page can't read another site's cookies). */
export function canRunWebCheck(): boolean {
  return runner !== null;
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Run `challenge` for `bridgeId` and import what the person earned. Resolves true when the cookies
 * are in (the caller retries), false when there's no runner, the person gave up, or the import
 * failed.
 */
export function runWebCheck(
  bridgeId: string,
  challenge: Challenge,
  importCookies: (body: { url: string; userAgent?: string; cookies: ImportedCookie[] }) => Promise<void>,
): Promise<boolean> {
  const key = `${bridgeId}\n${siteOf(challenge.url)}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = (async () => {
    const current = runner;
    if (!current) return false;
    try {
      const result = await current(challenge);
      if (!result) return false;
      const userAgent = result.userAgent ?? challenge.userAgent;
      await importCookies({ url: challenge.url, cookies: result.cookies, ...(userAgent ? { userAgent } : {}) });
      return true;
    } catch {
      return false;
    }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/**
 * Cookies from a `Cookie`-style header string (what a web view's store hands out for a URL), as
 * imports for `url`'s site. Such a string carries no domains, so they're scoped to the site's host
 * without a leading `www.`, which covers its other subdomains too.
 */
export function cookiesFromHeader(header: string, url: string): ImportedCookie[] {
  const domain = siteOf(url).replace(/^www\./, '');
  const out: ImportedCookie[] = [];
  const seen = new Set<string>();
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value: pair.slice(eq + 1).trim(), domain });
  }
  return out;
}

/**
 * The cookies anti-bot vendors set once a check is passed. A runner treats any of them changing
 * from its value before the check as "through".
 */
export const CLEARANCE_COOKIES = ['cf_clearance', '__ddg1_', '__ddg2_', '__ddgid_', '__ddgmark_', '__ddg8_', '__ddg9_', '__ddg10_', 'waf_pass'];

/** The clearance cookies in a header string, by name. */
export function clearanceOf(header: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of cookiesFromHeader(header, 'https://x/')) if (CLEARANCE_COOKIES.includes(c.name)) out.set(c.name, c.value);
  return out;
}

/** Whether `now` holds a clearance cookie that's new or changed since `before`. */
export function clearanceChanged(before: Map<string, string>, now: Map<string, string>): boolean {
  for (const [name, value] of now) if (value && before.get(name) !== value) return true;
  return false;
}
