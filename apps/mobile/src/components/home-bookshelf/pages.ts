const PAGE = { width: 192, height: 288 } as const;
const PAPER = [241, 235, 221] as const;
const INK = [42, 36, 26] as const;

/**
 * The spread every book opens to: two pages of empty panel frames, drawn once for the whole shelf.
 * Nobody reads it — it is on screen for a quarter of a second, under a page that is about to open —
 * so it only has to read as a comic's page. Frames filled with tone, black and balloons were drawn
 * first and were too much to take in that long: a picture of a page, where its outline was wanted.
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
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, PAPER);
  const frame = (x: number, y: number, w: number, h: number) => {
    const [x0, y0, x1, y1] = [Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h)];
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) if (px - x0 < 2 || py - y0 < 2 || x1 - px <= 2 || y1 - py <= 2) put(px, py, INK);
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
    frame(m, m, w, top - gap);
    frame(m, m + top, w * 0.55 - gap, mid - gap);
    frame(m + w * 0.55, m + top, w * 0.45, mid - gap);
    frame(m, m + top + mid, w, h - top - mid);
  }
  {
    // The inside of the cover, facing it: two tall panels over a strip over two more.
    const x = PAGE.width + m;
    const top = h * 0.46;
    const mid = h * 0.22;
    frame(x, m, w * 0.45 - gap, top - gap);
    frame(x + w * 0.45, m, w * 0.55, top - gap);
    frame(x, m + top, w, mid - gap);
    frame(x, m + top + mid, w * 0.6 - gap, h - top - mid);
    frame(x + w * 0.6, m + top + mid, w * 0.4, h - top - mid);
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
