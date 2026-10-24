/**
 * Pages from the computer this phone syncs with. A paired phone's sync hub is a desktop that may
 * already hold a chapter's pages (its own downloads); on the same network they are a faster, kinder
 * source than the site — and still there when the site isn't. This is the tier between the phone's
 * own downloads and the bridge in `source.ts`, and the first thing the download engine tries
 * (`hubFirst`). Covers are never taken from it: the hub holds chapters.
 *
 * It must cost nothing when the hub can't be reached — a phone reads on the bus more than on the
 * sofa. So the hub is taken to be reachable OPTIMISTICALLY: any word from it (a sync round that
 * landed, a read that answered) sets the latch, and only a failure clears it. While it's clear a
 * chapter opens straight from the bridge, with no request made; coming back online (a network
 * change, the app returning to the foreground) sets it again, so the next chapter asks once. The
 * one request this ever puts in a chapter's way is a probe bounded to `PROBE_MS`, and only when the
 * hub hasn't been heard from for `RECENT_MS` — a sync round runs after every page turn, so while
 * reading at home that is never. A time-based gate ("synced in the last few seconds") was
 * considered and rejected: the first chapter opened after an idle hour would never qualify.
 *
 * What the hub has is read from its `/downloads` (the same `StorageUsage` a remote-mode client
 * parses) and refreshed at most every `HAVE_TTL_MS`; a stale "have" is caught by the probe, which
 * re-reads that one series. Pages are plain `GET`s of the hub's `/downloads/.../pages/:i/file`
 * carrying a per-device ticket the hub issued through the sealed channel — the reader loads a page
 * as a URL, so the bytes can't be sealed, and the ticket is what keeps the door shut to anyone else.
 */
import type { DownloadedChapter, FetchedPage, PageFetcher, StorageUsage } from '@comical/downloads';
import { HttpBackend } from '@comical/sync';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { logDiagnostic } from '@/lib/diagnostics';
import { getApiBase, getSyncPairing } from '../api';
import { getResolvedModeSync } from '../embedded/preference';
import type { SyncStatus } from '../sync/controller';
import { getDownloadPrefsSync } from './prefs';

/** Where a device asks the hub for its page ticket; answered by the hub's gate, never its API. */
export const HUB_TICKET_PATH = '/sync/ticket';
/** A probe, or a first "have" read, may hold a chapter open this long and no longer. */
export const PROBE_MS = 1000;
/** Heard from within this long, the hub is used without asking first. */
export const RECENT_MS = 5 * 60_000;
/** How often `/downloads` is re-read on the back of a sync round. */
export const HAVE_TTL_MS = 60_000;
/** A ticket this close to expiry is replaced before it is used. */
const TICKET_MARGIN_MS = 10 * 60_000;

type Ticket = { value: string; expiresAt: number };

const key = (bridgeId: string, seriesId: string, chapterId: string) => `${bridgeId}:${seriesId}:${chapterId}`;

/** chapterKey → pageCount, for complete whole chapters the hub holds. */
let have = new Map<string, number>();
let haveLoaded = false;
let haveAt = 0;
let reachable = true;
let lastContactAt = 0;
let ticket: Ticket | null = null;
let inflight: Promise<void> | null = null;
let prevStatus: SyncStatus | null = null;
let installed = false;

function eligible(): boolean {
  return getDownloadPrefsSync().fromHub && getSyncPairing() !== null && getResolvedModeSync() === 'embedded';
}

function heard(): void {
  reachable = true;
  lastContactAt = Date.now();
}

function lost(why: string): void {
  if (reachable) logDiagnostic('hub', `Not reading from the computer: ${why}`);
  reachable = false;
}

function backend(signal?: AbortSignal): HttpBackend | null {
  const pairing = getSyncPairing();
  if (!pairing) return null;
  return new HttpBackend({ baseUrl: getApiBase(), fetch: (url, init) => fetch(url, { ...init, signal }), pairing });
}

/** Run `work` against the hub for at most `PROBE_MS`; past that it is abandoned and counts as a failure. */
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_MS);
  try {
    return await work(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

function setHave(chapters: readonly DownloadedChapter[], bridgeId: string, seriesId: string, into: Map<string, number>): void {
  for (const c of chapters) {
    if (c.state === 'complete' && !c.onlyPages && c.pageCount > 0) into.set(key(bridgeId, seriesId, c.chapterId), c.pageCount);
  }
}

function ticketLive(at = Date.now()): boolean {
  return ticket !== null && ticket.expiresAt - at > TICKET_MARGIN_MS;
}

async function readTicket(b: HttpBackend): Promise<void> {
  const reply = await b.read(HUB_TICKET_PATH);
  const body = reply.body as { ticket?: unknown; expiresInMs?: unknown } | undefined;
  if (reply.status !== 200 || typeof body?.ticket !== 'string') throw new Error(`hub gave no ticket (${reply.status})`);
  const ttl = typeof body.expiresInMs === 'number' ? body.expiresInMs : 60 * 60_000;
  ticket = { value: body.ticket, expiresAt: Date.now() + ttl };
}

/** Re-read everything the hub has, and take a ticket if this device needs one. One at a time. */
function refreshHave(signal?: AbortSignal): Promise<void> {
  if (inflight) return inflight;
  const run = async (): Promise<void> => {
    const b = backend(signal);
    if (!b) throw new Error('not paired');
    const reply = await b.read('/downloads');
    if (reply.status !== 200) throw new Error(`hub refused /downloads (${reply.status})`);
    const next = new Map<string, number>();
    for (const s of (reply.body as StorageUsage).bySeries ?? []) setHave(s.chapters, s.bridgeId, s.seriesId, next);
    if (!ticketLive()) await readTicket(b);
    have = next;
    haveLoaded = true;
    haveAt = Date.now();
    heard();
  };
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** One series' entry, fresh from the hub: proves it is there and corrects what we hold for it. */
async function probe(bridgeId: string, seriesId: string, signal: AbortSignal): Promise<void> {
  const b = backend(signal);
  if (!b) throw new Error('not paired');
  const reply = await b.read(`/downloads/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`);
  if (reply.status !== 200 && reply.status !== 404) throw new Error(`hub refused the series entry (${reply.status})`);
  const prefix = `${bridgeId}:${seriesId}:`;
  for (const k of have.keys()) if (k.startsWith(prefix)) have.delete(k);
  if (reply.status === 200) setHave((reply.body as { chapters?: DownloadedChapter[] }).chapters ?? [], bridgeId, seriesId, have);
  if (!ticketLive()) await readTicket(b);
  heard();
}

function pageUrls(bridgeId: string, seriesId: string, chapterId: string, count: number, t: string): string[] {
  const base = `${getApiBase()}/downloads/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages`;
  return Array.from({ length: count }, (_, i) => `${base}/${i}/file?t=${encodeURIComponent(t)}`);
}

/**
 * The hub's URLs for a chapter it holds complete, or `undefined` — not paired, turned off, the hub
 * doesn't have it, or the hub can't be reached (decided within `PROBE_MS`, and remembered).
 */
export async function hubChapterPages(bridgeId: string, seriesId: string, chapterId: string): Promise<string[] | undefined> {
  if (!eligible() || !reachable) return undefined;
  try {
    if (!haveLoaded) await bounded((signal) => refreshHave(signal));
    const count = have.get(key(bridgeId, seriesId, chapterId));
    if (!count) return undefined;
    if (Date.now() - lastContactAt > RECENT_MS || !ticketLive()) {
      await bounded((signal) => probe(bridgeId, seriesId, signal));
    }
    const n = have.get(key(bridgeId, seriesId, chapterId));
    return n && ticket ? pageUrls(bridgeId, seriesId, chapterId, n, ticket.value) : undefined;
  } catch (e) {
    lost(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

/** One page of the above, for the download engine. */
export async function hubPageUrl(bridgeId: string, seriesId: string, chapterId: string, index: number): Promise<string | undefined> {
  return (await hubChapterPages(bridgeId, seriesId, chapterId))?.[index];
}

/**
 * The download engine's fetcher with the hub in front: a page the hub holds is taken from it, and a
 * hub copy that doesn't arrive falls through to `fetcher`, never to an error. A hub that answers
 * without the page is not "gone" — it is simply not asked for that one.
 */
export function hubFirst(fetcher: PageFetcher): PageFetcher {
  return async (ctx, page) => {
    const url = await hubPageUrl(ctx.bridgeId, ctx.seriesId, ctx.chapterId, page.index);
    if (url) {
      const got = await fromHub(url);
      if (got) return got;
    }
    return fetcher(ctx, page);
  };
}

async function fromHub(url: string): Promise<FetchedPage | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get('Content-Type');
    return contentType ? { data, contentType } : { data };
  } catch (e) {
    lost(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

/**
 * Each sync status, from `sync/index.ts`. A round that landed is word from the hub (and the moment
 * to re-read what it has); a round that failed says it is out of reach.
 */
export function noteSyncStatus(status: SyncStatus): void {
  const prev = prevStatus;
  prevStatus = status;
  if (status.lastSyncAt && status.lastSyncAt !== prev?.lastSyncAt) {
    heard();
    if (eligible() && (Date.now() - haveAt > HAVE_TTL_MS || !ticketLive())) {
      refreshHave().catch((e: unknown) => lost(e instanceof Error ? e.message : String(e)));
    }
  } else if (status.lastError && status.lastError !== prev?.lastError) {
    lost(status.lastError);
  }
}

/** Set the latch again whenever the phone's situation changes: a network change, or coming back to the foreground. */
export function installHubDownloads(): void {
  if (installed) return;
  installed = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') reachable = true;
  });
  try {
    Network.addNetworkStateListener((state) => {
      if (state.isConnected !== false) reachable = true;
    });
  } catch {
    // expo-network unavailable: the foreground and sync rounds still set the latch.
  }
}

/** Tests only. */
export function resetHubDownloads(): void {
  have = new Map();
  haveLoaded = false;
  haveAt = 0;
  reachable = true;
  lastContactAt = 0;
  ticket = null;
  inflight = null;
  prevStatus = null;
}

/** Tests only: what this module currently believes. */
export function hubState(): { reachable: boolean; have: number; ticket: string | null } {
  return { reachable, have: have.size, ticket: ticket?.value ?? null };
}
