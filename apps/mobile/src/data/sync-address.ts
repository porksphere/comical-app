/**
 * What a desktop shows a phone is one string — it is what a QR holds, and what sits beside it to
 * type — but what it names is two things: where the computer is, and the one-time code this phone
 * pairs with. `http://<computer>:<port>/<code>` is split here, once. A plain origin is a server on
 * a trusted link, synced with in the clear; a path that isn't code-shaped — `/api` behind a proxy —
 * is the server's own.
 */
export type SyncAddress = { url: string; code?: string };

/** `newPairingCode`'s shape in `@comical/sync`: twelve of an alphabet with nothing to misread. */
const CODE_SEGMENT = /^[a-hjkmnp-z2-9]{12}$/;

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
  return CODE_SEGMENT.test(segment) ? { url: url.origin, code: segment } : { url: `${url.origin}/${segment}` };
}
