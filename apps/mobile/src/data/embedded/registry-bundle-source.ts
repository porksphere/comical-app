/**
 * A `BundleSource` backed by a Comical registry: the installed set + bundle code come from a
 * registry `index.json`, with bundles downloaded, integrity/authenticity-verified, and cached.
 *
 * The registry index already carries each bridge's full `BridgeInfo` (capabilities, nsfw, icon), so
 * `installed()` needs no bundle load. `resolveBundle` returns cached code when present, else
 * downloads + verifies (SHA-256 always; Ed25519 when the index is signed) and caches it.
 *
 * The `fetchIndex`/`downloadBundle` implementations are injected (a `RegistryFetcher`) rather than
 * imported, so this module stays free of `@comical/registry`'s runtime code and typechecks under the
 * app's tsc. At runtime the caller wires the real functions from the built `@comical/registry`
 * package (whose verify.ts is pure WebCrypto — on-device it needs a `crypto.subtle` polyfill).
 */
import type { BridgeInfo } from '@comical/contract';
import type { RegistryBridgeEntry, RegistryIndex } from '@comical/registry';
import type { BundleSource, InstalledBridge } from './types';

/** Minimal entry shape `downloadBundle` needs (mirrors `@comical/registry`'s `BundleEntryLike`). */
export interface BundleEntryLike {
  id: string;
  url: string;
  sha256: string;
  signature?: string | undefined;
}

/** The subset of `@comical/registry`'s fetcher this source uses — injected at construction. */
export interface RegistryFetcher {
  fetchIndex(url: string): Promise<RegistryIndex>;
  downloadBundle(
    entry: BundleEntryLike,
    opts?: { publicKey?: string; requireSignature?: boolean },
  ): Promise<{ text: string }>;
}

/** Persistent bundle cache keyed by (bridge id, sha256) so a changed bundle re-downloads. */
export interface BundleCache {
  read(id: string, sha256: string): Promise<string | null>;
  write(id: string, sha256: string, code: string): Promise<void>;
}

/** In-memory `BundleCache` — the default/fallback and what tests use. */
export class MemoryBundleCache implements BundleCache {
  private readonly store = new Map<string, string>();
  private key(id: string, sha256: string): string {
    return `${id}@${sha256}`;
  }
  async read(id: string, sha256: string): Promise<string | null> {
    return this.store.get(this.key(id, sha256)) ?? null;
  }
  async write(id: string, sha256: string, code: string): Promise<void> {
    this.store.set(this.key(id, sha256), code);
  }
}

export interface RegistryBundleSourceOptions {
  /** Absolute URL of the registry `index.json`. */
  indexUrl: string;
  fetcher: RegistryFetcher;
  cache?: BundleCache;
  /** Refuse unsigned bundles (defaults to false — SHA-256 integrity is always enforced). */
  requireSignature?: boolean;
}

function entryToInfo(e: RegistryBridgeEntry): BridgeInfo {
  return {
    id: e.id,
    name: e.name,
    version: e.version,
    contractVersion: e.contractVersion,
    languages: e.languages,
    nsfw: e.nsfw,
    capabilities: e.capabilities as BridgeInfo['capabilities'],
    ...(e.iconUrl !== undefined ? { iconUrl: e.iconUrl } : {}),
  };
}

export class RegistryBundleSource implements BundleSource {
  private readonly cache: BundleCache;
  private index?: RegistryIndex;

  constructor(private readonly opts: RegistryBundleSourceOptions) {
    this.cache = opts.cache ?? new MemoryBundleCache();
  }

  /** Fetch + memoize the registry index. Call `reload()` to force a refetch. */
  private async loadIndex(): Promise<RegistryIndex> {
    this.index ??= await this.opts.fetcher.fetchIndex(this.opts.indexUrl);
    return this.index;
  }

  /** Drop the memoized index so the next call refetches (e.g. to pick up new/updated bridges). */
  reload(): void {
    this.index = undefined;
  }

  async installed(): Promise<InstalledBridge[]> {
    const idx = await this.loadIndex();
    return idx.bridges.map((e) => ({ info: entryToInfo(e), source: 'registry' as const }));
  }

  async resolveBundle(id: string): Promise<string> {
    const idx = await this.loadIndex();
    const entry = idx.bridges.find((b) => b.id === id);
    if (!entry) throw new Error(`bridge not found: ${id}`);

    const cached = await this.cache.read(id, entry.sha256);
    if (cached !== null) return cached;

    const opts: { publicKey?: string; requireSignature?: boolean } = {};
    if (idx.publicKey !== undefined) opts.publicKey = idx.publicKey;
    if (this.opts.requireSignature !== undefined) opts.requireSignature = this.opts.requireSignature;

    const { text } = await this.opts.fetcher.downloadBundle(entry, opts);
    await this.cache.write(id, entry.sha256, text);
    return text;
  }
}
