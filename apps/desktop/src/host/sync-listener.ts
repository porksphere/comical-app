/**
 * The one door other devices get: the host's `/sync` routes on the local network, so a phone can
 * use this computer as its sync hub. Off until asked for (Settings → General).
 *
 * The loopback listener in `serve.ts` can't be it — it is loopback, and its token is made per
 * launch for a renderer that Electron hands it to. This one has to be reachable and has to keep
 * one address, so its secret is a saved key, carried as the first path segment: the phone already
 * takes a server URL with a prefix (`HttpBackend`'s `baseUrl`), so pairing is pasting one address
 * and needs nothing new on the phone.
 *
 * It has to be a secret, and it has to guard only this much. A sync push carries more than reading
 * progress — a registry to add, a bridge to install — and an installed bridge is code this machine
 * runs. Nothing but `/sync` and `/health` is forwarded, so the key never opens the rest of the API.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createSocket } from "node:dgram";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
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
  const expected = digest(opts.key);

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const [, key = "", ...rest] = url.pathname.split("/");
    const path = `/${rest.join("/")}`;
    // A wrong key and a path that isn't served look the same from outside.
    if (!timingSafeEqual(digest(key), expected) || !(path === "/health" || path.startsWith("/sync/"))) {
      return new Response("not found", { status: 404 });
    }
    const host = opts.getHost();
    if (!host) return new Response("starting", { status: 503 });
    return host.router.fetch(new Request(`http://desktop.comical.local${path}${url.search}`, req));
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

// Hashed so the comparison is over equal lengths whatever was sent.
const digest = (key: string): Buffer => createHash("sha256").update(key).digest();

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
