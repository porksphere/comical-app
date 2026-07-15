/**
 * Tier-1 hub `SyncBackend` — an HTTP client against a self-hosted `@comical/host-server`. This is
 * the *trusted-hub* shape: the server merges records for an account and serves deltas by cursor.
 * (The *untrusted* shape — public relay or third-party blob — uses `encryptedBackend` + a
 * `BlobBackend` instead, so the server only ever sees opaque ciphertext. See crypto.ts.)
 *
 * Endpoint contract the server must implement (to be added to `@comical/host-server`):
 *
 *   POST  {base}/sync/push
 *         headers: Authorization: Bearer <token>?   ·   X-Comical-Account: <accountId>
 *         body:    SyncRecord[]  (JSON)
 *         effect:  merge each record into the account's state via the same CRDT join
 *         → 200
 *
 *   GET   {base}/sync/pull?cursor=<hlc|empty>
 *         headers: Authorization: Bearer <token>?   ·   X-Comical-Account: <accountId>
 *         → 200  { records: SyncRecord[], cursor: string | null }   // records with hlc > cursor
 *
 * The account id comes from device pairing; the optional bearer token is host-server's existing
 * `COMICAL_TOKEN`. A non-2xx response throws, so the engine keeps the outbox queued for retry.
 */
import type { SyncBackend, PullResult, SyncRecord } from '@comical/sync';

export type HttpBackendOptions = {
  baseUrl: string;
  /** Account partition on the hub (from pairing). */
  account: string;
  /** Optional bearer token (host-server `COMICAL_TOKEN`). */
  token?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
};

export function httpSyncBackend(opts: HttpBackendOptions): SyncBackend {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'X-Comical-Account': opts.account };
    if (opts.token) h.Authorization = `Bearer ${opts.token}`;
    return h;
  };

  return {
    async push(records: SyncRecord[]): Promise<void> {
      if (records.length === 0) return;
      const res = await doFetch(`${base}/sync/push`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(records),
      });
      if (!res.ok) throw new Error(`sync push failed: ${res.status} ${res.statusText}`);
    },

    async pull(cursor: string | null): Promise<PullResult> {
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const res = await doFetch(`${base}/sync/pull${q}`, { headers: headers() });
      if (!res.ok) throw new Error(`sync pull failed: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as PullResult;
      return { records: body.records ?? [], cursor: body.cursor ?? null };
    },
  };
}
