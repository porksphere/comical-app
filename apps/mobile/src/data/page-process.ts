import type { PageImageLayout } from '@comical/contract';

/**
 * A page whose image needs processing (`Page.process`) is drawn from its bytes, never handed to
 * `<Image>` as a URL: the host serves it with a layout (`Comical-Page-Layout`) to draw. Page lists
 * are plain URI strings from the query layer to the reader to downloads, so the page says so with a
 * fragment on its URL, which every one of them carries untouched and no server ever sees. It holds
 * no data; the layout comes with the bytes.
 */

const MARK = 'comical-process';

export function markProcessed(url: string): string {
  return isProcessed(url) ? url : `${url}${url.includes('#') ? '&' : '#'}${MARK}`;
}

export function isProcessed(url: string): boolean {
  const hash = url.indexOf('#');
  return hash >= 0 && url.slice(hash + 1).split('&').includes(MARK);
}

/** The URL without the mark. */
export function unmarked(url: string): string {
  const hash = url.indexOf('#');
  if (hash < 0) return url;
  const rest = url.slice(hash + 1).split('&').filter((p) => p !== MARK);
  return url.slice(0, hash) + (rest.length ? `#${rest.join('&')}` : '');
}

/** One copy, as a client draws it: a source rectangle into a destination rectangle. */
export type DrawCopy = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };

/**
 * The copies of a layout, or undefined when it holds an operation this client can't draw — such a
 * page is shown as it came, which the contract allows (`pageImageOpSchema`).
 */
export function layoutCopies(layout: PageImageLayout): DrawCopy[] | undefined {
  const out: DrawCopy[] = [];
  for (const op of layout.ops as readonly { op: string }[]) {
    if (op.op !== 'copy') return undefined;
    const { src: s, dst: d } = op as PageImageLayout['ops'][number];
    out.push({ sx: s.x, sy: s.y, sw: s.w, sh: s.h, dx: d.x, dy: d.y, dw: d.w, dh: d.h });
  }
  return out;
}
