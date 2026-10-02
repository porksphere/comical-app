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
