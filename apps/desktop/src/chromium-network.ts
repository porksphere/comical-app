/**
 * The desktop host's requests go out through Chromium's network stack, not Node's. Sites behind an
 * anti-bot service check the connection's TLS fingerprint: Node's is turned away where Chromium's
 * is let through, and a clearance a person earned in a web check (a Chromium window) is honoured
 * only from a connection like the one that earned it. Phones get this for free from the OS stack.
 *
 * It's built on `net.request`, not `session.fetch`: the latter follows the Fetch spec and refuses a
 * request that sets `Referer` or `Origin` (nearly every source wants a `Referer`). `net.request`
 * sends the headers a bridge sets as they are, given `referrerPolicy: "unsafe-url"`, shows every
 * `Set-Cookie` (core keeps the jar, so the session keeps no cookies and sends none), and decodes
 * compressed bodies. The session is in memory and bypasses its HTTP cache, so a response is always
 * fresh, as it was from Node.
 *
 * Redirects are followed here, not by Chromium: Chromium drops a caller's `Cookie` header on every
 * hop, and with it the session a page needs (a site that trims a trailing slash would answer as if
 * logged out, or challenge again). As Node's fetch does: headers are kept on same-origin hops, and
 * `Cookie` and `Authorization` dropped on cross-origin ones; 303, and 301/302 after a POST, go on as
 * a GET without the body. A hop's `Set-Cookie`s join the `Cookie` sent on to the same origin, and
 * all of them come back on the final response for core's jar.
 *
 * This file is the fetch adapter, free of Electron so it tests anywhere; `chromium-sender.ts` is
 * the `net.request` half. `COMICAL_CHROMIUM_NETWORK=0` falls back to Node's `fetch`.
 */

/** One request as the sender takes it. */
export type RawRequest = { url: string; method: string; headers: [string, string][]; body?: string | Uint8Array };
/** One response as the sender hands it back: headers as Electron gives them (repeats as arrays). */
export type RawResponse = { url: string; status: number; statusText: string; headers: Record<string, string | string[]>; body: Uint8Array };
export type Sender = (req: RawRequest) => Promise<RawResponse>;

// Headers the network stack sets itself and refuses from a caller.
const STACK_HEADERS = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade", "expect"]);
// Statuses a Response may not carry a body with.
const NULL_BODY = new Set([101, 103, 204, 205, 304]);
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;
// Headers that describe a body, dropped when a redirect drops the body.
const BODY_HEADERS = new Set(["content-type", "content-encoding", "content-language", "content-location"]);

/** The request's headers, less the ones the stack owns. */
export function requestHeaders(headers: HeadersInit | undefined): [string, string][] {
  const out: [string, string][] = [];
  new Headers(headers).forEach((value, name) => {
    if (!STACK_HEADERS.has(name.toLowerCase())) out.push([name, value]);
  });
  return out;
}

/** A header's values, however Electron gave them. */
function values(headers: RawResponse["headers"], name: string): string[] {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const v = key === undefined ? undefined : headers[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/**
 * A sender's answer as a fetch `Response`, with its final URL and every `Set-Cookie` intact;
 * `earlier` are the `Set-Cookie`s of the redirects on the way, which come first.
 */
export function toResponse(raw: RawResponse, earlier: readonly string[] = []): Response {
  const headers = new Headers();
  for (const c of earlier) headers.append("set-cookie", c);
  for (const [name, value] of Object.entries(raw.headers)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, v);
      } catch {
        // A header value Node's Headers won't hold; nothing a bridge could have used.
      }
    }
  }
  const res = new Response(NULL_BODY.has(raw.status) ? null : (raw.body as BodyInit), {
    status: raw.status,
    statusText: raw.statusText.replace(/[^\t\x20-\x7e\x80-\xff]/g, ""),
    headers,
  });
  Object.defineProperty(res, "url", { value: raw.url });
  return res;
}

/** `cookie` (a `Cookie` header) with `setCookies` applied: each sets its value, or removes it when expired. */
export function withSetCookies(cookie: string | undefined, setCookies: readonly string[]): string | undefined {
  const jar = new Map<string, string>();
  for (const pair of (cookie ?? "").split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  for (const sc of setCookies) {
    const [first, ...attrs] = sc.split(";");
    const eq = first!.indexOf("=");
    if (eq <= 0) continue;
    const name = first!.slice(0, eq).trim();
    const gone = attrs.some((a) => {
      const [k, v = ""] = a.split("=").map((x) => x.trim());
      if (k!.toLowerCase() === "max-age") return Number(v) <= 0;
      if (k!.toLowerCase() === "expires") return Date.parse(v) <= Date.now();
      return false;
    });
    if (gone) jar.delete(name);
    else jar.set(name, first!.slice(eq + 1).trim());
  }
  return jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : undefined;
}

/** The request after a redirect from `from` to `location`, as fetch would make it. */
export function nextHop(req: RawRequest, status: number, location: string, setCookies: readonly string[]): RawRequest {
  const to = new URL(location, req.url);
  const sameOrigin = to.origin === new URL(req.url).origin;
  const toGet = (status === 303 && req.method !== "HEAD") || ((status === 301 || status === 302) && req.method === "POST");
  let headers = req.headers.filter(([name]) => {
    const n = name.toLowerCase();
    if (!sameOrigin && (n === "cookie" || n === "authorization")) return false;
    return !(toGet && BODY_HEADERS.has(n));
  });
  if (sameOrigin && setCookies.length) {
    const cookie = withSetCookies(headers.find(([n]) => n.toLowerCase() === "cookie")?.[1], setCookies);
    headers = headers.filter(([n]) => n.toLowerCase() !== "cookie");
    if (cookie) headers.push(["cookie", cookie]);
  }
  const next: RawRequest = { url: to.href, method: toGet ? "GET" : req.method, headers };
  if (!toGet && req.body !== undefined) next.body = req.body;
  return next;
}

/**
 * A `fetch` over `send`, which makes single hops and never follows a redirect itself. Takes what the
 * host's network passes: a URL string and a plain init.
 */
export function fetchOver(send: Sender): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (input instanceof Request) throw new TypeError("chromium network: pass a URL, not a Request");
    const body = init?.body;
    if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) throw new TypeError("chromium network: body must be a string or bytes");
    let req: RawRequest = {
      url: input instanceof URL ? input.href : input,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: requestHeaders(init?.headers),
      ...(body != null ? { body } : {}),
    };
    const earlier: string[] = [];
    for (let hop = 0; ; hop++) {
      const raw = await send(req);
      const location = values(raw.headers, "location")[0];
      if (!REDIRECT.has(raw.status) || !location || init?.redirect === "manual") return toResponse(raw, earlier);
      if (init?.redirect === "error") throw new TypeError(`chromium network: redirected from ${req.url}`);
      if (hop >= MAX_REDIRECTS) throw new TypeError(`chromium network: too many redirects from ${input}`);
      const setCookies = values(raw.headers, "set-cookie");
      earlier.push(...setCookies);
      req = nextHop(req, raw.status, location, setCookies);
    }
  }) as typeof fetch;
}
