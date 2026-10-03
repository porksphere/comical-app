/**
 * The one door other devices get: the host's `/sync` routes on the local network, so a phone can
 * use this computer as its sync hub. Off until asked for (Settings → Sync).
 *
 * The loopback listener in `serve.ts` can't be it — it is loopback, and its token is made per
 * launch for a renderer that Electron hands it to. This one has to be reachable and has to keep
 * one address, so its secret is a saved key. The phone is given it as the last segment of the
 * address it scans (`http://<ip>:<port>/<key>`), which it keeps to itself: every body in either
 * direction is sealed under the key (`@comical/sync`'s `sealedChannel`), and the key never crosses
 * the network — not in a path, not in a header. A request that doesn't open is answered as if the
 * route didn't exist; a wrong key and a wrong path look the same from outside.
 *
 * It has to be a secret, and it has to guard only this much. A sync push carries more than reading
 * progress — a registry to add, a bridge to install — and an installed bridge is code this machine
 * runs. Nothing but the two `/sync` routes is forwarded, so the key never opens the rest of the API.
 */
import { randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { sealedChannel, SYNC_PULL_PATH, SYNC_PUSH_PATH } from "@comical/sync";
import type { DesktopHost } from "./create-host.ts";
import { listen } from "./serve.ts";

/** Outside the range Windows hands out (and Hyper-V reserves from) on its own. */
const DEFAULT_PORT = 3130;

/** Typed on a phone, so no pairs that read alike. */
const KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const KEY_LENGTH = 12;

export function newSyncKey(): string {
  return Array.from({ length: KEY_LENGTH }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join("");
}

export interface SyncListener {
  /** What a phone is given as its sync server — null while this machine is on no network. Asked
   *  each time: a laptop changes networks under a running app. */
  address(): Promise<string | null>;
  close(): Promise<void>;
}

export interface SyncListenerOptions {
  getHost: () => DesktopHost | null;
  key: string;
  port?: number;
}

export async function startSyncListener(opts: SyncListenerOptions): Promise<SyncListener> {
  const channel = sealedChannel(opts.key);
  const notFound = () => new Response("not found", { status: 404 });

  const handler = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method !== "POST" || !(path === SYNC_PUSH_PATH || path === SYNC_PULL_PATH)) return notFound();
    const request = channel.openRequest(path, await req.text());
    if (!request) return notFound();
    const reply = (status: number, body: string) =>
      new Response(channel.sealResponse(request.nonce, status, body), { headers: { "content-type": "application/json" } });
    const host = opts.getHost();
    if (!host) return reply(503, JSON.stringify({ error: "starting" }));
    const res = await host.router.fetch(
      new Request(`http://desktop.comical.local${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: request.body,
      }),
    );
    return reply(res.status, await res.text());
  };

  const port = opts.port ?? DEFAULT_PORT;
  const server = await listen(handler, port, "0.0.0.0").catch((err: unknown) => {
    // Taken, or reserved (EACCES is how Windows refuses a port Hyper-V holds). The address shown
    // in Settings is read from what was bound, so it stays true either way.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EADDRINUSE" && code !== "EACCES") throw err;
    console.warn(`[sync] port ${port} is unavailable; falling back to an ephemeral one`);
    return listen(handler, 0, "0.0.0.0");
  });
  const bound = (server.address() as AddressInfo).port;

  return {
    address: async () => {
      const ip = await lanAddress();
      return ip ? `http://${ip}:${bound}/${opts.key}` : null;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * This machine's address on the network it routes out through. Connecting a UDP socket sends
 * nothing; it only makes the OS pick the interface it would use, which is the one a phone on the
 * same network can reach. The first interface in the list is often a virtual adapter instead
 * (Hyper-V, VirtualBox, WSL), so that is only the fallback for a network with no route out.
 */
function lanAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const done = (address: string | null) => {
      socket.close();
      resolve(address ?? firstInterface());
    };
    socket.once("error", () => done(null));
    socket.connect(80, "8.8.8.8", () => {
      const { address } = socket.address();
      done(address && address !== "0.0.0.0" ? address : null);
    });
  });
}

function firstInterface(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    const found = addrs?.find((a) => a.family === "IPv4" && !a.internal);
    if (found) return found.address;
  }
  return null;
}
