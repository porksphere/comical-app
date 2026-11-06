/**
 * The colours of a book's dark-mode glow. Apple Books doesn't put a shadow under a cover on a dark
 * page — a shadow on black is no shadow — but a glow in the cover's own colours: under the foot about
 * a quarter of its bottom colour, along the rim about a tenth of a paler top colour (measured off its
 * screenshots). So the glow is two white pictures tinted per cover (`BookShadow`), and these are the
 * tints, worked out from a picture of the cover a few pixels big.
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

const BASE83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const decode83 = (s: string) => [...s].reduce((v, c) => v * 83 + BASE83.indexOf(c), 0);
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};
const signPow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

/**
 * A cover's top and bottom colour out of its BlurHash, read down the middle at the top and bottom
 * bands. Any number of components decodes; one column by two rows is all this needs. `null` for a
 * string that isn't a well-formed hash.
 */
export function tonesFromBlurhash(hash: string): { top: Rgb; bottom: Rgb } | null {
  if (hash.length < 6 || [...hash].some((c) => !BASE83.includes(c))) return null;
  const size = decode83(hash[0]);
  const rows = Math.floor(size / 9) + 1;
  const cols = (size % 9) + 1;
  if (hash.length !== 4 + 2 * rows * cols) return null;
  const max = (decode83(hash[1]) + 1) / 166;
  const dc = decode83(hash.slice(2, 6));
  const components: Rgb[] = [[toLinear(dc >> 16), toLinear((dc >> 8) & 255), toLinear(dc & 255)]];
  for (let k = 1; k < rows * cols; k++) {
    const v = decode83(hash.slice(4 + k * 2, 6 + k * 2));
    components.push([Math.floor(v / 361), Math.floor(v / 19) % 19, v % 19].map((q) => signPow((q - 9) / 9, 2) * max) as unknown as Rgb);
  }
  const at = (y: number): Rgb => {
    const out = [0, 0, 0];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const basis = Math.cos((Math.PI * i) / 2) * Math.cos(Math.PI * y * j);
        const c = components[j * cols + i];
        for (let ch = 0; ch < 3; ch++) out[ch] += c[ch] * basis;
      }
    }
    return [toSrgb(out[0]), toSrgb(out[1]), toSrgb(out[2])];
  };
  return { top: at(0.08), bottom: at(0.92) };
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
