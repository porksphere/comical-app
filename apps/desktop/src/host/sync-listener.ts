/**
 * The one door other devices get: the host's `/sync` routes on the local network, so a phone can
 * use this computer as its sync hub. Off until asked for (Settings → Sync).
 *
 * The loopback listener in `serve.ts` can't be it — it is loopback, and its token is made per
 * launch for a renderer that Electron hands it to. This one has to be reachable by a device that
 * was introduced once and comes back for months, so each device has a key of its own
 * (`@comical/sync`'s `pairingGate`). A phone gets one by scanning `http://<ip>:<port>/<code>`: the
 * code is good once and for a few minutes, and what the phone keeps is the result of a key exchange
 * run under it — never sent, and no other device's. Every body in either direction is sealed under
 * that key, and a request that doesn't open is answered as if the route didn't exist; a stranger
 * and a wrong path look the same from outside.
 *
 * It has to be a secret, and it has to guard only this much. A sync push carries more than reading
 * progress — a registry to add, a bridge to install — and an installed bridge is code this machine
 * runs. Nothing but the `/sync` routes is answered, so a paired device never reaches the rest of
 * the API.
 */
import { createSocket } from "node:dgram";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { pairingGate, type PairedDevice, type PairingGate, type StoredPairing } from "@comical/sync";
import type { DesktopHost } from "./create-host.ts";
import { listen } from "./serve.ts";

/** Outside the range Windows hands out (and Hyper-V reserves from) on its own. */
const DEFAULT_PORT = 3130;

export interface SyncGateOptions {
  getHost: () => DesktopHost | null;
  pairings: StoredPairing[];
  save(pairings: StoredPairing[]): void;
  onDevices?(devices: PairedDevice[]): void;
}

/** Who is paired with this computer, and their way through to the host. It outlives the listener:
 *  the devices are listed, and can be unlinked, while the door is shut. */
export function createSyncGate(opts: SyncGateOptions): PairingGate {
  return pairingGate({
    pairings: opts.pairings,
    save: opts.save,
    onDevices: opts.onDevices,
    forward: async (path, body) => {
      const host = opts.getHost();
      if (!host) return { status: 503, body: JSON.stringify({ error: "starting" }) };
      const res = await host.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body });
      return { status: res.status, body: await res.text() };
    },
  });
}

export interface SyncListener {
  /** Where a phone reaches this computer — null while it is on no network. Asked each time: a
   *  laptop changes networks under a running app. */
  address(): Promise<string | null>;
  close(): Promise<void>;
}

export interface SyncListenerOptions {
  gate: PairingGate;
  port?: number;
}

export async function startSyncListener(opts: SyncListenerOptions): Promise<SyncListener> {
  const handler = async (req: Request): Promise<Response> => {
    const sealed = req.method === "POST" ? await opts.gate.handle(new URL(req.url).pathname, await req.text()) : null;
    if (sealed === null) return new Response("not found", { status: 404 });
    return new Response(sealed, { headers: { "content-type": "application/json" } });
  };

  const port = opts.port ?? DEFAULT_PORT;
  const server = await listen(handler, port, "0.0.0.0").catch((err: unknown) => {
    // Taken, or reserved (EACCES is how Windows refuses a port Hyper-V holds). The address a phone
    // is given is read from what was bound, so it stays true either way.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EADDRINUSE" && code !== "EACCES") throw err;
    console.warn(`[sync] port ${port} is unavailable; falling back to an ephemeral one`);
    return listen(handler, 0, "0.0.0.0");
  });
  const bound = (server.address() as AddressInfo).port;

  return {
    address: async () => {
      const ip = await lanAddress();
      return ip ? `http://${ip}:${bound}` : null;
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
