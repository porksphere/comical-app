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

    return serveStaticFile(opts.webRoot, url.pathname, origin);
  };

  const server = serve({ fetch: handler, hostname: "127.0.0.1", port: 0 });
  const address = await new Promise<{ port: number }>((resolve) => {
    // @hono/node-server returns the underlying http.Server; it may already be listening.
    const addr = (server as unknown as { address(): { port: number } | null }).address();
    if (addr) return resolve(addr);
    (server as unknown as { once(e: string, cb: () => void): void }).once("listening", () =>
      resolve((server as unknown as { address(): { port: number } }).address()),
    );
  });
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    token,
    close: () =>
      new Promise<void>((resolve) =>
        (server as unknown as { close(cb: () => void): void }).close(() => resolve()),
      ),
  };
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

export function injectServerUrl(html: string, serverUrl: string): string {
  const stripped = html.replace(/<script>window\.__COMICAL_SERVER__=[^<]*<\/script>/g, "");
  const snippet = `<script>window.__COMICAL_SERVER__=${JSON.stringify(serverUrl)};</script>`;
  return stripped.includes("<head>")
    ? stripped.replace("<head>", `<head>${snippet}`)
    : `${snippet}${stripped}`;
}
