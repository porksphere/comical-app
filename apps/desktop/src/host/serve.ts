/**
 * The loopback listener that fronts the desktop host.
 *
 * The demo deliberately keeps the renderer *unmodified*: it's the same `expo export --platform web`
 * bundle the container image ships, and it talks HTTP to `window.__COMICAL_SERVER__`. So one
 * listener serves both halves, same-origin (no CORS anywhere):
 *
 *   GET /api/*   → `host.router.fetch` (path rewritten to drop the prefix) — the same REST surface
 *                  `@comical/host-server` exposes over the network, and the same `/api` prefix the
 *                  hosted deployment already uses behind its reverse proxy.
 *   GET /*       → the static export from `apps/mobile/dist`, with `window.__COMICAL_SERVER__`
 *                  injected into each .html at request time (what `docker-entrypoint.sh` does with
 *                  `sed` at container start).
 *
 * Bound to 127.0.0.1 on an ephemeral port, and every request must carry a per-launch bearer token
 * that Electron injects into the renderer's own requests (`main.ts`'s `onBeforeSendHeaders`). That
 * keeps other local processes — and any browser pointed at the port — out. The token is a stopgap
 * for the port existing at all. The fix is to drop the socket entirely: `ipcMain.handle` →
 * `host.fetch(path, init)` plus a `startup.electron.ts` calling the app's own `setTransport()` —
 * the shape `@comical/host-rn` already uses on device.
 */
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { stat, readFile } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import type { DesktopHost } from "./create-host.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export interface LoopbackServer {
  /** e.g. `http://127.0.0.1:51234` — the renderer's origin *and* its API base. */
  origin: string;
  /** The port actually bound — `opts.port` when it was free, otherwise whatever the OS handed out. */
  port: number;
  /** Per-launch secret every request must present as `Authorization: Bearer …`. */
  token: string;
  close(): Promise<void>;
}

export interface ServeOptions {
  /** Late-bound: the listener binds first so the host can be built with the real origin as its
   *  `hostUrl` / OAuth callback base, then this starts returning it. Requests that arrive in the
   *  gap (there shouldn't be any — no window is open yet) get a 503. */
  getHost: () => DesktopHost | null;
  /** Directory holding the Expo web export (`apps/mobile/dist`). */
  webRoot: string;
  /** Dev only: a Metro dev server (`http://localhost:8081`) to proxy the renderer from instead of
   *  `webRoot`, so the window hot-reloads. Proxied rather than loaded directly so the renderer keeps
   *  the one origin it has when packaged — `/api` stays same-origin and the bearer injection is
   *  unchanged. */
  devServer?: string;
  /** Fixed port instead of an ephemeral one. The origin keys the renderer's localStorage, so a
   *  port that changes every launch starts every launch with empty preferences. */
  port?: number;
}

export async function startLoopbackServer(opts: ServeOptions): Promise<LoopbackServer> {
  const token = randomBytes(32).toString("hex");
  let origin = "";

  const handler = async (req: Request): Promise<Response> => {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });

    const url = new URL(req.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const host = opts.getHost();
      if (!host) return new Response("starting", { status: 503 });
      const rest = url.pathname.slice("/api".length) || "/";
      return host.router.fetch(new Request(`${origin}${rest}${url.search}`, req));
    }

    if (opts.devServer) return proxyToDevServer(opts.devServer, req, url, origin);
    return serveStaticFile(opts.webRoot, url.pathname, origin);
  };

  let server: Server;
  try {
    server = await listen(handler, opts.port ?? 0);
  } catch (err) {
    // Windows can refuse a port nothing visible is listening on (WSL and Hyper-V hold ports that
    // netstat never shows, and EACCES is how it refuses one Hyper-V reserved), so a fixed port is
    // a preference, not a requirement.
    const code = (err as NodeJS.ErrnoException).code;
    if (!opts.port || (code !== "EADDRINUSE" && code !== "EACCES")) throw err;
    console.warn(`[serve] port ${opts.port} is unavailable; falling back to an ephemeral one`);
    server = await listen(handler, 0);
  }
  if (opts.devServer) forwardUpgrades(server, opts.devServer);
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    port,
    token,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => resolve()),
      ),
  };
}

/** A bind failure has to reject here: left as an unhandled 'error' event it becomes Electron's modal
 *  "JavaScript error in the main process" dialog, and the process hangs on it instead of exiting. */
export function listen(
  handler: (req: Request) => Promise<Response>,
  port: number,
  hostname = "127.0.0.1",
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: handler, hostname, port }) as unknown as Server;
    if (server.listening) return resolve(server);
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/** Serve one file out of the export, refusing anything that escapes the root. */
async function serveStaticFile(root: string, pathname: string, origin: string): Promise<Response> {
  const decoded = decodeURIComponent(pathname);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  let target = join(root, rel);
  if (!target.startsWith(root + sep) && target !== root) return new Response("forbidden", { status: 403 });

  let info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    target = join(target, "index.html");
    info = await stat(target).catch(() => null);
  }
  // Expo's static export emits one prerendered .html per route; `/settings` → `settings.html`.
  if (!info && !extname(target)) {
    const asHtml = `${target}.html`;
    info = await stat(asHtml).catch(() => null);
    if (info) target = asHtml;
  }
  if (!info) return new Response("not found", { status: 404 });

  const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";

  // The one rewrite: point the unmodified bundle at our own origin, exactly as the container's
  // entrypoint does at start-up — only here it's per-request, so the ephemeral port is fine.
  if (type.startsWith("text/html")) {
    const html = await readFile(target, "utf8");
    return new Response(injectServerUrl(html, `${origin}/api`), {
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  }

  return new Response(Readable.toWeb(createReadStream(target)) as unknown as ReadableStream, {
    headers: { "content-type": type, "content-length": String(info.size) },
  });
}

async function proxyToDevServer(devServer: string, req: Request, url: URL, origin: string): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("authorization");
  headers.delete("host");
  // undici decompresses the body but passes `content-encoding` through, so the renderer would decode
  // it a second time. Asking for none is simpler than reconciling the two.
  headers.set("accept-encoding", "identity");
  const upstream = await fetch(new URL(url.pathname + url.search, devServer), {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
    duplex: "half",
  } as RequestInit);

  const out = new Headers(upstream.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  if ((upstream.headers.get("content-type") ?? "").startsWith("text/html")) {
    out.set("cache-control", "no-store");
    return new Response(injectServerUrl(await upstream.text(), `${origin}/api`), { status: upstream.status, headers: out });
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/** Metro's HMR and dev-menu channels are WebSockets opened against the page's own origin, which here
 *  is the loopback listener, so they have to be tunnelled through to Metro as raw sockets. */
function forwardUpgrades(server: Server, devServer: string): void {
  const target = new URL(devServer);
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const upstream = connect(Number(target.port || 80), target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]!;
        const lower = name.toLowerCase();
        const value = lower === "host" ? target.host : lower === "origin" ? target.origin : req.rawHeaders[i + 1];
        lines.push(`${name}: ${value}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const drop = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", drop);
    socket.on("error", drop);
  });
}

export function injectServerUrl(html: string, serverUrl: string): string {
  const stripped = html.replace(/<script>window\.__COMICAL_SERVER__=[^<]*<\/script>/g, "");
  const snippet = `<script>window.__COMICAL_SERVER__=${JSON.stringify(serverUrl)};</script>`;
  return stripped.includes("<head>")
    ? stripped.replace("<head>", `<head>${snippet}`)
    : `${snippet}${stripped}`;
}
