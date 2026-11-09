/**
 * The colours of a book's dark-mode glow. Apple Books doesn't put a shadow under a cover on a dark
 * page — a shadow on black is no shadow — but a glow in the cover's own colours: under the foot about
 * a quarter of its bottom colour, along the rim about a tenth of a paler top colour (measured off its
 * screenshots). So the glow is two white pictures tinted per cover (`BookShadow`), and these are the
 * tints, worked out from a copy of the cover a few pixels wide.
 *
 * Pure, so it can be tested; the platform readers (`cover-glow-reader`) do the decoding.
 */

export type Rgb = readonly [number, number, number];

/** What a cover's glow is tinted with: the rim from its top, the foot from its bottom. On the web,
 *  also the glow already drawn in those tints (an object URL): tinting there is an SVG filter per
 *  picture, which a fast scroll of a grid can't afford, so each cover's glow is drawn once instead. */
export type CoverGlow = { rim: string; foot: string; picture?: string };

/** How far the rim's tint is lifted toward white. Apple's rim reads half neutral: a pink cover's is a
 *  greyish pink, not the pink. */
const RIM_PALE = 0.55;

const css = ([r, g, b]: Rgb) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

export function glowFromTones(top: Rgb, bottom: Rgb): CoverGlow {
  const pale = top.map((c) => c + (255 - c) * RIM_PALE) as unknown as Rgb;
  return { rim: css(pale), foot: css(bottom) };
}

/** The glow pictures' alpha, which a live shadow carries in its colour instead. */
const GLOW_ALPHA = 0.3;
const translucent = (rgb: string) => rgb.replace(/^rgb\((.*)\)$/, `rgba($1,${GLOW_ALPHA})`);

/** A cover's glow as the colours of a thumbnail's live lift (`liftShadows` in lib/book-cover). */
export function liftGlow({ rim, foot }: CoverGlow): { rim: string; foot: string } {
  return { rim: translucent(rim), foot: translucent(foot) };
}

/** The share of the cover's height each tone is averaged over, from its top and from its bottom. */
const BAND = 0.16;

/**
 * A cover's top and bottom colour out of a small RGBA copy of it, each the average of a band across
 * its full width. `null` for an empty picture.
 */
export function tonesFromPixels(px: ArrayLike<number>, width: number, height: number): { top: Rgb; bottom: Rgb } | null {
  if (width < 1 || height < 1 || px.length < width * height * 4) return null;
  const rows = Math.max(1, Math.round(height * BAND));
  const average = (from: number): Rgb => {
    const sum = [0, 0, 0];
    for (let y = from; y < from + rows; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        sum[0] += px[i];
        sum[1] += px[i + 1];
        sum[2] += px[i + 2];
      }
    }
    const n = rows * width;
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  };
  return { top: average(0), bottom: average(height - rows) };
}

/** At most a few covers decoded at once: a fast scroll mounts dozens of cards, and each one's glow
 *  waits its turn rather than all of them decoding together. */
const MAX_AT_ONCE = 3;
let running = 0;
const waiting: (() => void)[] = [];

export async function oneOfAFew<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
