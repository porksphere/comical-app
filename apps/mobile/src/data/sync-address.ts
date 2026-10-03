/**
 * A pairing code is one string — it is what a QR holds, and what the desktop shows beside it to
 * type — but what it names is two things: the server, and the secret the two sides seal the sync
 * channel under. `http://<computer>:<port>/<key>` is split here, once, and the phone keeps the
 * parts apart from then on. A plain origin pairs with no secret (a server on a trusted link, in
 * the clear); a path that isn't key-shaped — `/api` behind a proxy — is the server's own.
 */
export type SyncAddress = { url: string; secret?: string };

/** The desktop's key shape (`newSyncKey` in the desktop shell): twelve of an unambiguous alphabet. */
const KEY_SEGMENT = /^[a-z2-9]{12}$/;

/** `null` for anything that isn't a server address — some other QR code, refused rather than
 *  saved as a server that can't answer. */
export function parseSyncAddress(text: string): SyncAddress | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length > 1) return null;
  const [segment] = segments;
  if (segment === undefined) return { url: url.origin };
  return KEY_SEGMENT.test(segment) ? { url: url.origin, secret: segment } : { url: `${url.origin}/${segment}` };
}

/**
 * A pairing code for a settings row: the key is the whole secret, so it is not left on screen
 * where a glance reads it.
 */
export function displaySyncAddress(address: string): string {
  const parsed = parseSyncAddress(address);
  return parsed?.secret ? `${parsed.url}/••••` : address;
}
