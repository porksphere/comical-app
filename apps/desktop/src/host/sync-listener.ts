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
 * runs. Besides the `/sync` routes a paired device may READ what this computer has downloaded
 * (`READABLE`), so a phone on the same network takes a chapter's pages from here instead of the
 * source; those are GETs of routes that change nothing, and nothing else of the API is answered.
 *
 * The pages themselves are the one thing sent in the clear. A phone's reader loads a page as a
 * plain URL (`<Image source={{ uri }}>`), so the bytes can't ride the sealed channel; instead the
 * phone asks, sealed, for a ticket (`TICKET_PATH`), and a page GET carries it as `?t=`. The ticket
 * is random, lasts an hour, belongs to the device that asked and dies with its pairing. Downloaded
 * pages are the whole of what it opens.
 */
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { pairingGate, type PairedDevice, type PairingGate, type StoredPairing } from "@comical/sync";
import type { DesktopHost } from "./create-host.ts";
import { listen } from "./serve.ts";

/** Outside the range Windows hands out (and Hyper-V reserves from) on its own. */
const DEFAULT_PORT = 3130;

/** Read-only download routes a paired device may ask for through the gate: what is downloaded
 *  (`/downloads`, the `StorageUsage` every client already parses) and one series' entry. Not the
 *  preferences, the queue, or the event stream (an SSE body never ends, and the gate buffers). */
const READABLE = [/^\/downloads$/, /^\/downloads\/entries\/[^/]+\/[^/]+$/];
/** Where a device asks for its page ticket. Answered by the gate itself, never the host. */
export const TICKET_PATH = "/sync/ticket";
export const TICKET_TTL_MS = 60 * 60_000;
const PAGE_FILE = /^\/downloads\/entries\/[^/]+\/[^/]+\/chapters\/[^/]+\/pages\/\d+\/file$/;

export interface SyncGateOptions {
  getHost: () => DesktopHost | null;
  pairings: StoredPairing[];
  save(pairings: StoredPairing[]): void;
  onDevices?(devices: PairedDevice[]): void;
  now?: () => number;
}

/** The pairing gate plus the page tickets it hands out. */
export interface SyncGate extends PairingGate {
  /** The device a live ticket belongs to, or null for one that is unknown, expired or unlinked. */
  ticketHolder(ticket: string): string | null;
}

/** Who is paired with this computer, and their way through to the host. It outlives the listener:
 *  the devices are listed, and can be unlinked, while the door is shut. */
export function createSyncGate(opts: SyncGateOptions): SyncGate {
  const now = opts.now ?? Date.now;
  const tickets = new Map<string, { device: string; expiresAt: number }>();
  const issue = (device: string): string => {
    // One live ticket per device: a phone asking again (it forgot, or the hour is nearly up) gets
    // a new one and the old stops working, so the live set is never larger than the paired set.
    for (const [t, held] of tickets) if (held.device === device) tickets.delete(t);
    const ticket = randomBytes(24).toString("base64url");
    tickets.set(ticket, { device, expiresAt: now() + TICKET_TTL_MS });
    return ticket;
  };
  const gate = pairingGate({
    pairings: opts.pairings,
    save: opts.save,
    now,
    onDevices: (devices) => {
      const paired = new Set(devices.map((d) => d.id));
      for (const [t, held] of tickets) if (!paired.has(held.device)) tickets.delete(t);
      opts.onDevices?.(devices);
    },
    reads: (path) => path === TICKET_PATH || READABLE.some((r) => r.test(path)),
    forward: async ({ method, path, body, device }) => {
      if (path === TICKET_PATH) return { status: 200, body: JSON.stringify({ ticket: issue(device), expiresInMs: TICKET_TTL_MS }) };
      const host = opts.getHost();
      if (!host) return { status: 503, body: JSON.stringify({ error: "starting" }) };
      const res =
        method === "GET"
          ? await host.fetch(path)
          : await host.fetch(path, { method, headers: { "content-type": "application/json" }, body });
      return { status: res.status, body: await res.text() };
    },
  });
  return {
    ...gate,
    ticketHolder: (ticket) => {
      const held = tickets.get(ticket);
      if (!held) return null;
      if (held.expiresAt <= now()) {
        tickets.delete(ticket);
        return null;
      }
      return held.device;
    },
  };
}

export interface SyncListener {
  /** Where a phone reaches this computer — null while it is on no network. Asked each time: a
   *  laptop changes networks under a running app. */
  address(): Promise<string | null>;
  close(): Promise<void>;
}

export interface SyncListenerOptions {
  gate: SyncGate;
  getHost: () => DesktopHost | null;
  port?: number;
}

export async function startSyncListener(opts: SyncListenerOptions): Promise<SyncListener> {
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET") return pageFile(opts, url);
    const sealed = req.method === "POST" ? await opts.gate.handle(url.pathname, await req.text()) : null;
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

/** A downloaded page, to the device whose ticket is on the request. Anything else is "not found",
 *  the same as a stranger at any other path. Only the bytes are passed on, not the host's headers;
 *  `Cache-Control: immutable` is kept, since a downloaded page never changes. */
export async function pageFile(opts: Pick<SyncListenerOptions, "gate" | "getHost">, url: URL): Promise<Response> {
  const ticket = url.searchParams.get("t");
  if (!ticket || !PAGE_FILE.test(url.pathname) || !opts.gate.ticketHolder(ticket)) return new Response("not found", { status: 404 });
  const host = opts.getHost();
  if (!host) return new Response("starting", { status: 503 });
  const res = await host.fetch(url.pathname);
  if (!res.ok) return new Response("not found", { status: 404 });
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "cache-control"]) {
    const value = res.headers.get(name);
    if (value) headers[name] = value;
  }
  return new Response(res.body, { status: 200, headers });
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
