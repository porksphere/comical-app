/**
 * The layout of Comical Home's flat heroes, the splash and the poster: how tall each stands, where
 * a book of the poster's row sits for a place along it, and where a drag comes to rest. Pure — no
 * react-native imports — so the rules can be tested; `components/home-hero` draws them.
 *
 * Lengths are points. A place along a hero is counted in series: 0 is the first, and a place
 * between two whole numbers is part way from one to the next.
 */

/** The feed width from which a hero lays its words beside its picture instead of under it. */
export const HERO_WIDE_FROM = 700;

export const heroIsWide = (width: number): boolean => width >= HERO_WIDE_FROM;

/** A volume's cover, width over height: what a hero is sized for before any picture has loaded. */
export const HERO_COVER_ASPECT = 2 / 3;

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
};

/** The share of the window's height the splash's cover may reach down to, so the heading of the
 *  first rail still shows under it. */
const SPLASH_WINDOW_SHARE = 0.72;
const SPLASH_MIN = 300;

/**
 * How much of the splash's cover stands in the feed's flow: the cover whole at the stage's width
 * where the window is tall enough for it, and no further down the window than
 * `SPLASH_WINDOW_SHARE`. `top` is where the feed's content starts, and `bleed` how far above that
 * the cover begins: all of it, under a bar that is bare over the page.
 */
export function splashArtHeight({ width, windowHeight, top, bleed }: { width: number; windowHeight: number; top: number; bleed: number }): number {
  const foot = Math.min(top - bleed + width / HERO_COVER_ASPECT, windowHeight * SPLASH_WINDOW_SHARE);
  return Math.max(SPLASH_MIN, Math.round(foot - top));
}

/** A wide hero's height: about half the window, within what its book and its words both need. */
export function wideHeroHeight(windowHeight: number): number {
  return clamp(Math.round(windowHeight * 0.52), 340, 480);
}

/** Room over and under a wide hero's book. */
export const WIDE_BOOK_MARGIN = 40;

/** The box a poster's cover is fitted in: on a phone a little over half the stage, in a wide hero
 *  what its height leaves. */
export function posterBookBox(width: number, wideHeight?: number): { width: number; height: number } {
  if (wideHeight !== undefined) {
    const height = wideHeight - 2 * WIDE_BOOK_MARGIN;
    return { width: Math.round(height * HERO_COVER_ASPECT), height };
  }
  const bookWidth = clamp(Math.round(width * 0.55), 150, 240);
  return { width: bookWidth, height: Math.round(bookWidth / HERO_COVER_ASPECT) };
}

/** A cover of this shape as large as fits in `box`. */
export function fitCover(aspect: number, box: { width: number; height: number }): { width: number; height: number } {
  const width = Math.min(box.width, box.height * aspect);
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

/** `y` for `x` along a line through the points (`xs[i]`, `ys[i]`), held at its ends. */
function along(x: number, xs: readonly number[], ys: readonly number[]): number {
  'worklet';
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
}

/** How small a book of the poster's row is drawn when it is not the one in front. */
export const POSTER_SIDE_SCALE = 0.8;

/** The clear space between the front book and the one beside it, in points. A share of the book's
 *  width was less than nothing on a phone: the side books stood a little way in behind the front
 *  one, and on a narrow screen the row read as covers lying over each other. */
const POSTER_GAP = 15;

/**
 * How far the book beside the front one stands from it, middle to middle, in book widths: half the
 * front book, half a side one, and the gap between them. It is also a finger's travel for one book.
 */
export function posterStep(bookWidth: number): number {
  return (1 + POSTER_SIDE_SCALE) / 2 + POSTER_GAP / bookWidth;
}

/**
 * Where a book of the poster's row sits, `away` places from the one in front (negative before
 * it): `x` in book widths from the front book's place, its scale and its opacity. `step` is
 * `posterStep`, which the first book either side stands at; those past it are between two small
 * books and stand closer, a third of the gap apart. On a phone the row runs both ways from the
 * middle of the stage. In a wide hero the front book stands beside the words, so the row runs on to
 * the right of it only, and a book that has been passed is gone by the time it would reach them.
 */
export function posterPlace(away: number, wide: boolean, step: number): { x: number; scale: number; opacity: number } {
  'worklet';
  const far = Math.abs(away);
  const scale = 1 - (1 - POSTER_SIDE_SCALE) * Math.min(1, far);
  const gap = step - (1 + POSTER_SIDE_SCALE) / 2;
  const x = far <= 1 ? away * step : Math.sign(away) * (step + (far - 1) * (POSTER_SIDE_SCALE + gap / 3));
  const opacity = wide ? along(away, [-1, 0, 1, 2, 3, 4], [0, 1, 0.62, 0.36, 0.18, 0]) : along(far, [0, 1, 2, 3], [1, 0.55, 0.28, 0]);
  return { x, scale, opacity };
}

/** Where a wide hero's one book sits, with no row beside it: each gives way to the next as it comes,
 *  drifting a little the way the finger went. */
export function lonePlace(away: number): { x: number; scale: number; opacity: number } {
  'worklet';
  return { x: away * 0.25, scale: 1, opacity: 1 - Math.min(1, Math.abs(away)) };
}

/** How many books either side of the front one the poster draws: those `posterPlace` shows. */
export const posterReach = (wide: boolean) => (wide ? 4 : 3);

/**
 * How opaque the splash's cover for series `index` is at `position`. The covers lie one over the
 * next in order and each fades in over the one before it, so two covers part way through a swipe
 * never show the page between them, as two fading against each other would.
 */
export function splashLayerOpacity(index: number, position: number): number {
  'worklet';
  return clamp(position - (index - 1), 0, 1);
}

/** How much of a pull past either end of the row the finger gets. */
const PAST_END = 0.3;

/** Where a drag has the row, for where the finger has it: as asked between the ends, and held back
 *  past them. */
export function draggedPosition(asked: number, count: number): number {
  'worklet';
  const last = Math.max(0, count - 1);
  if (asked < 0) return asked * PAST_END;
  if (asked > last) return last + (asked - last) * PAST_END;
  return asked;
}

/** How long a release's speed is carried for, in seconds. */
const CARRY = 0.18;

/**
 * The series a released drag comes to rest on: the nearest to where its speed would carry it, no
 * more than `reach` series from where the drag began. `velocity` is in series a second.
 */
export function restingPosition({ from, position, velocity, count, reach }: { from: number; position: number; velocity: number; count: number; reach: number }): number {
  'worklet';
  const carried = Math.round(position + velocity * CARRY);
  return clamp(clamp(carried, from - reach, from + reach), 0, Math.max(0, count - 1));
}

/**
 * Which series is in front once the hero's series change. One the reader brought forward is kept by
 * what it is, wherever it now stands; until they have moved the hero, or once that series has gone,
 * a new set opens where it opens (`opens`).
 */
export function keptFront(was: { keys: readonly string[]; index: number; moved: boolean }, keys: readonly string[], opens: number): { index: number; moved: boolean } {
  const kept = was.moved ? keys.indexOf(was.keys[was.index] ?? '') : -1;
  return kept >= 0 ? { index: kept, moved: true } : { index: Math.min(opens, Math.max(0, keys.length - 1)), moved: false };
}
