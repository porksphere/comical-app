/**
 * The desktop host's requests go out through Chromium's network stack, not Node's. Sites behind an
 * anti-bot service check the connection's TLS fingerprint: Node's is turned away where Chromium's
 * is let through, and a clearance a person earned in a web check (a Chromium window) is honoured
 * only from a connection like the one that earned it. Phones get this for free from the OS stack.
 *
 * It's built on `net.request`, not `session.fetch`: the latter follows the Fetch spec and refuses a
 * request that sets `Referer` or `Origin` (nearly every source wants a `Referer`). `net.request`
 * sends the headers a bridge sets as they are, given `referrerPolicy: "unsafe-url"`, shows every
 * `Set-Cookie` (core keeps the jar, so the session keeps no cookies and sends none), follows
 * redirects, and decodes compressed bodies. The session is in memory and bypasses its HTTP cache,
 * so a response is always fresh, as it was from Node.
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

/** The request's headers, less the ones the stack owns. */
export function requestHeaders(headers: HeadersInit | undefined): [string, string][] {
  const out: [string, string][] = [];
  new Headers(headers).forEach((value, name) => {
    if (!STACK_HEADERS.has(name.toLowerCase())) out.push([name, value]);
  });
  return out;
}

/** A sender's answer as a fetch `Response`, with its final URL and every `Set-Cookie` intact. */
export function toResponse(raw: RawResponse): Response {
  const headers = new Headers();
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

/** A `fetch` over `send`. Takes what the host's network passes: a URL string and a plain init. */
export function fetchOver(send: Sender): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (input instanceof Request) throw new TypeError("chromium network: pass a URL, not a Request");
    const body = init?.body;
    if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) throw new TypeError("chromium network: body must be a string or bytes");
    const raw = await send({
      url: input instanceof URL ? input.href : input,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: requestHeaders(init?.headers),
      ...(body != null ? { body } : {}),
    });
    return toResponse(raw);
  }) as typeof fetch;
}
