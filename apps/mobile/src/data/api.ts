/**
 * Thin client for the Comical backend API (the same server the legacy web app
 * talks to). Mirrors the reference's `k()` fetch wrapper: `${BASE}${path}`,
 * throw on non-2xx with the server's `error` message, return parsed JSON.
 *
 * Base URL comes from EXPO_PUBLIC_COMICAL_SERVER (inlined by Expo at build
 * time) so it can be overridden per environment, defaulting to the live API.
 *
 * Auth: the backend sits behind SSO. We send `credentials: 'include'` so an
 * already-authenticated browser session's cookie rides along. For the
 * cross-origin web preview the server must return CORS
 * `Access-Control-Allow-Origin: <preview origin>` +
 * `Access-Control-Allow-Credentials: true`, otherwise requests are blocked and
 * callers fall back to local data.
 */

export const API_BASE =
  process.env.EXPO_PUBLIC_COMICAL_SERVER ?? 'https://comical.pork.casa/api';

export type Bridge = { id: string; name: string; nsfw: boolean; capabilities: string[] };
export type BridgeList = { id: string; name: string; page: boolean };

/** True for an aborted-request error, so callers can ignore unmount cancels. */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** GET /bridges → the installed bridges (id, display name, nsfw, capabilities). */
export async function getBridges(signal?: AbortSignal): Promise<Bridge[]> {
  const raw = await fetchJson<{ info: Bridge }[]>('/bridges', signal);
  return raw.map((b) => ({
    id: b.info.id,
    name: b.info.name,
    nsfw: b.info.nsfw ?? false,
    capabilities: b.info.capabilities ?? [],
  }));
}

/** GET /bridges/{id}/lists → the bridge's browse lists (home rails + pages). */
export function getBridgeLists(id: string, signal?: AbortSignal): Promise<BridgeList[]> {
  return fetchJson<BridgeList[]>(`/bridges/${encodeURIComponent(id)}/lists`, signal);
}

/**
 * Page-selector labels for a bridge, matching the reference's `i8`: "home"
 * first, then each page-list (lowercased name), then "favorites" if supported.
 */
export function pageOptions(lists: BridgeList[], capabilities: string[]): string[] {
  const opts = ['home'];
  for (const l of lists) if (l.page && l.id !== 'home') opts.push(l.name.toLowerCase());
  if (capabilities.includes('favorites')) opts.push('favorites');
  return opts;
}
