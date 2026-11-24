const TAIL = 44;

/** The end of a URL that tells one page from the next: the target inside a host route's query when
 *  there is one, without its own query, and a `data:` URI as its type and size. */
export function pageTail(url: string): string {
  if (url.startsWith('data:')) return `${url.slice(0, url.indexOf(';') > 0 ? url.indexOf(';') : 16)} (${url.length} chars)`;
  let text = url;
  try {
    text = decodeURIComponent(url);
  } catch {
    // Left as written.
  }
  if (text.startsWith('/')) {
    const inner = text.search(/https?:\/\//);
    if (inner > 0) text = text.slice(inner);
  }
  if (/^https?:\/\//.test(text)) {
    const query = text.indexOf('?');
    if (query > 0) text = text.slice(0, query);
  }
  return text.length > TAIL ? `…${text.slice(-TAIL)}` : text;
}
