/**
 * What a scanned pairing code has to hold to become this app's server: the address the desktop
 * shows beside its QR code, `http://<computer>:<port>/<key>` — or a plain server origin. Anything
 * else is some other QR code, and is refused rather than saved as a server that can't answer.
 */
export function parseSyncAddress(text: string): string | null {
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
  return `${url.origin}${segments.length === 1 ? `/${segments[0]}` : ''}`;
}

/** The desktop's key shape (`newSyncKey` in the desktop shell): twelve of an unambiguous alphabet. */
const KEY_SEGMENT = /^\/[a-z2-9]{12}$/;

/**
 * What a saved address is for the sync client: where to send, and the secret the two sides seal
 * under. The key is never part of a URL that leaves the phone — the desktop answers the sealed
 * `/sync` routes at its origin. A path that isn't key-shaped is a server's prefix and stays.
 */
export function splitSyncAddress(address: string): { baseUrl: string; secret?: string } {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { baseUrl: address };
  }
  return KEY_SEGMENT.test(url.pathname) ? { baseUrl: url.origin, secret: url.pathname.slice(1) } : { baseUrl: address };
}

/**
 * The address for a settings row: the key is the whole secret, so it is not left on screen where
 * a glance reads it. A path that isn't key-shaped — a `/api` prefix behind a proxy — is kept.
 */
export function displaySyncAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  return KEY_SEGMENT.test(url.pathname) ? `${url.origin}/••••` : address;
}
