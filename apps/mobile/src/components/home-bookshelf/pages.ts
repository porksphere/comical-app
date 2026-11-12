import { bayer4 } from '@/lib/bookshelf';

const PAGE = { width: 192, height: 288 } as const;
const PAPER = [241, 235, 221] as const;
const INK = [42, 36, 26] as const;

/**
 * The spread every book opens to: two pages of panels, drawn once for the whole shelf. Nobody
 * reads it — it is on screen for a quarter of a second, under a page that is about to open — so it
 * only has to read as a comic: frames, tone, a black panel, balloons with lines for lettering.
 *
 * Plain arithmetic into a buffer, so the scene needs nothing of the platform to have it. The first
 * page is the buffer's left half and the inside of the cover its right; each has its binding edge
 * on its own left, shaded as a gutter. Rows run from the bottom, as a data texture reads them.
 */
export function spreadPixels(): { pixels: Uint8Array; width: number; height: number } {
  const width = PAGE.width * 2;
  const { height } = PAGE;
  const pixels = new Uint8Array(width * height * 4);
  const put = (x: number, y: number, [r, g, b]: readonly [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = ((height - 1 - y) * width + x) * 4;
    pixels[at] = r;
    pixels[at + 1] = g;
    pixels[at + 2] = b;
    pixels[at + 3] = 255;
  };
  const each = (x: number, y: number, w: number, h: number, draw: (px: number, py: number) => void) => {
    for (let py = Math.round(y); py < Math.round(y + h); py++) for (let px = Math.round(x); px < Math.round(x + w); px++) draw(px, py);
  };
  each(0, 0, width, height, (x, y) => put(x, y, PAPER));

  type Fill = 'bare' | 'black' | 'tone' | 'fade';
  const panel = (x: number, y: number, w: number, h: number, fill: Fill) => {
    each(x, y, w, h, (px, py) => {
      const edge = px - x < 2 || py - y < 2 || x + w - px <= 2 || y + h - py <= 2;
      // The app's own tone: the page curl's matrix, two texels to a cell.
      const level = fill === 'tone' ? 0.3 : fill === 'fade' ? 0.55 * (1 - (py - y) / h) : 0;
      if (edge || fill === 'black' || bayer4(px >> 1, py >> 1) < level) put(px, py, INK);
    });
  };
  const balloon = (cx: number, cy: number, rx: number, ry: number, lines: number) => {
    each(cx - rx - 1, cy - ry - 1, 2 * rx + 2, 2 * ry + 2, (px, py) => {
      const d = Math.hypot((px - cx) / rx, (py - cy) / ry);
      if (d <= 1) put(px, py, d > 1 - 2.4 / Math.min(rx, ry) ? INK : PAPER);
    });
    for (let i = 0; i < lines; i++) {
      const y = cy + (i - (lines - 1) / 2) * 5;
      const reach = rx * (i % 2 ? 0.42 : 0.56);
      each(cx - reach, y, 2 * reach, 1.5, (px, py) => put(px, py, INK));
    }
  };

  const m = 16;
  const gap = 6;
  const w = PAGE.width - 2 * m;
  const h = PAGE.height - 2 * m;
  {
    // The first page: a wide establishing panel, two beats, a wide close.
    const top = h * 0.4;
    const mid = h * 0.3;
    panel(m, m, w, top - gap, 'fade');
    balloon(m + w * 0.7, m + top * 0.3, 30, 18, 3);
    panel(m, m + top, w * 0.55 - gap, mid - gap, 'black');
    balloon(m + w * 0.26, m + top + mid * 0.42, 22, 13, 2);
    panel(m + w * 0.55, m + top, w * 0.45, mid - gap, 'bare');
    panel(m, m + top + mid, w, h - top - mid, 'tone');
    balloon(m + w * 0.3, m + top + mid + (h - top - mid) * 0.5, 34, 17, 3);
  }
  {
    // The inside of the cover, facing it: two tall panels over a strip over two more.
    const x = PAGE.width + m;
    const top = h * 0.46;
    const mid = h * 0.22;
    panel(x, m, w * 0.45 - gap, top - gap, 'tone');
    panel(x + w * 0.45, m, w * 0.55, top - gap, 'bare');
    balloon(x + w * 0.72, m + top * 0.24, 28, 16, 3);
    panel(x, m + top, w, mid - gap, 'black');
    balloon(x + w * 0.62, m + top + (mid - gap) * 0.5, 30, 12, 2);
    panel(x, m + top + mid, w * 0.6 - gap, h - top - mid, 'bare');
    balloon(x + w * 0.28, m + top + mid + (h - top - mid) * 0.36, 26, 15, 3);
    panel(x + w * 0.6, m + top + mid, w * 0.4, h - top - mid, 'fade');
  }
  // The gutter: each page falls away into its binding.
  for (const from of [0, PAGE.width]) {
    for (let x = 0; x < 22; x++) {
      const shade = 0.72 + 0.28 * (x / 22) ** 0.6;
      for (let y = 0; y < height; y++) {
        const at = (y * width + from + x) * 4;
        pixels[at] *= shade;
        pixels[at + 1] *= shade;
        pixels[at + 2] *= shade;
      }
    }
  }
  return { pixels, width, height };
}
