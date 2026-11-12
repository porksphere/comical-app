/**
 * The home bookshelf's geometry: where each book stands for a place along the shelf, and where a
 * point of that space lands on the screen. Pure — no react-native or three imports — so the rules
 * can be tested; `components/home-bookshelf` draws them.
 *
 * Lengths are points. `x` runs right, `y` up from the shelf's top, `z` toward the reader, and a
 * yaw is degrees about the vertical, positive turning a book's right edge away.
 */
import type { CoverBinding, CoverForm } from '@/lib/book-cover';
import { leadingChapterNumber } from '@/lib/chapter-label';

export type ShelfBook = { width: number; height: number; depth: number; binding: CoverBinding };

/** `ink` is how far the book is from the one in front, 0 to 1: what the shelf draws in tone. */
export type ShelfPlace = { x: number; z: number; yaw: number; ink: number };

export const SHELF = {
  /** The front book's turn toward the reader, short of square on so its spine still shows. */
  coverYaw: 12,
  /** How far the front book's neighbours lean away from it, easing off over the next few. */
  peel: 9,
  gap: 3,
  /** How far the front book comes out past the line of spines. */
  pull: 40,
  /** The eye's distance from the shelf, and the angle it looks down from. */
  lens: 760,
  look: 9,
  /** The shelf's top, up from the stage's bottom edge: room under it for the caption that hangs off
   *  the front book's foot. */
  floor: 58,
  /** Room over the tallest book, for the callout that stands on its corner. */
  headroom: 76,
  /** A finger's travel for one book. */
  dragUnit: 64,
} as const;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (v: number) => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A book under a finger gives: it goes `back` as it is pressed and comes `forward` of where it
 * stood as it is let go, further than it went back for the same push, since coming toward the
 * reader is the part that is seen.
 */
export const PRESS = { back: 16, forward: 40 } as const;

/** A book's place pressed `depth` of the way in (1 is fully; below 0 it has sprung out past rest). */
export function pressedPlace(place: ShelfPlace, depth: number): ShelfPlace {
  if (!depth) return place;
  return { ...place, z: place.z - (depth > 0 ? PRESS.back : PRESS.forward) * depth };
}

/**
 * What is lettered at the foot of a spine: the number of the chapter the book opens at, two
 * digits at the least as a volume's number is printed ("07", "12", "104", "12.5"). None for a
 * chapter whose name leads with words.
 */
export function spineNumber(chapterName: string | undefined): string | undefined {
  const number = chapterName ? leadingChapterNumber(chapterName) : undefined;
  if (!number) return undefined;
  const [whole, part] = number.split('.');
  return whole.padStart(2, '0') + (part ? `.${part}` : '');
}

/** A cover's width for a stage this wide: about a third of a phone, and no larger on a wide one. */
export function shelfCoverWidth(stageWidth: number): number {
  return clamp(stageWidth * 0.34, 96, 136);
}

/** Covers are drawn between these shapes (width / height); a picture outside them is cropped to
 *  the nearer one, so one odd cover never sets the height of the row. */
export const SHELF_ASPECT = { tall: 0.64, wide: 0.8, unknown: 2 / 3 } as const;

export function shelfStageHeight(stageWidth: number): number {
  return Math.round(shelfCoverWidth(stageWidth) / SHELF_ASPECT.tall + SHELF.floor + SHELF.headroom);
}

/**
 * A book's thickness. A bound volume's grows with how much of it there is to read, from a slim
 * tankobon to an omnibus; the unbound forms are as thin as the things they are.
 */
export function bookDepth(form: CoverForm, width: number, chapters: number | undefined): number {
  switch (form) {
    case 'volume':
      return width * (0.15 + 0.13 * Math.min(1, (chapters ?? 60) / 200));
    case 'issue':
      return Math.max(3, width * 0.035);
    case 'scroll':
      return Math.max(4, width * 0.055);
    case 'sheets':
      return 6;
  }
}

/**
 * Every book's place with `pos` in front (a fraction between two books mid-drag).
 *
 * Books stand spine out and are packed by the room each takes AT ITS OWN ANGLE, so the one turning
 * to show its cover pushes its neighbours aside as it turns rather than passing through them, and
 * a neighbour leaning away from it takes the little more room its lean needs. The front book is
 * held a little toward the side that has no more books, so the first and the last don't stand
 * beside an empty half.
 */
export function placeShelf(books: readonly ShelfBook[], pos: number): ShelfPlace[] {
  const n = books.length;
  const centres = new Array<number>(n);
  const places = new Array<ShelfPlace>(n);
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const { width, depth, binding } = books[i];
    const offset = i - pos;
    const away = Math.abs(offset);
    const side = offset < 0 ? -1 : 1;
    // A spine faces the reader at +90 for a book bound on its left and -90 for one bound on its right.
    const spine = binding === 'left' ? 90 : -90;
    const front = smoothstep(1 - away);
    const yaw =
      away >= 1
        ? spine + side * SHELF.peel * Math.exp(-(away - 1) / 1.3)
        : (spine + side * SHELF.peel) * (1 - front) + Math.sign(spine) * SHELF.coverYaw * front;
    const foot = width * Math.abs(Math.cos(rad(yaw))) + depth * Math.abs(Math.sin(rad(yaw)));
    centres[i] = cursor + foot / 2;
    cursor += foot + SHELF.gap;
    places[i] = { x: 0, z: (-width / 2) * (1 - front) + (SHELF.pull + depth / 2) * front, yaw, ink: 1 - front };
  }
  if (n === 0) return places;
  const held = clamp(pos, 0, n - 1);
  const lower = Math.min(Math.max(0, n - 2), Math.floor(held));
  const between = held - lower;
  const upper = Math.min(n - 1, lower + 1);
  const lean = n > 1 ? 46 * ((2 * held) / (n - 1) - 1) : 0;
  // Past either end the whole shelf follows the finger, at the resistance `rubberBand` gave it.
  const focus = centres[lower] * (1 - between) + centres[upper] * between - lean + (pos - held) * 110;
  for (let i = 0; i < n; i++) places[i].x = centres[i] - focus;
  return places;
}

/** A drag carried past either end of the shelf: it follows, less and less. */
export function rubberBand(raw: number, count: number): number {
  const last = Math.max(0, count - 1);
  if (raw < 0) return (-0.5 * -raw) / (1 - raw);
  if (raw > last) return last + (0.5 * (raw - last)) / (1 + raw - last);
  return raw;
}

/** The book a release lands on: where the fling was headed, no more than three books on. */
export function settleOn(pos: number, velocity: number, count: number): number {
  const near = Math.round(pos);
  return clamp(clamp(Math.round(pos + velocity * 0.2), near - 3, near + 3), 0, Math.max(0, count - 1));
}

/** `centre` is where along the stage's width the shelf's middle stands: its own middle unless the
 *  stage runs under something the selection should not sit behind (a bar down one side). `yaw` and
 *  `pitch` are the view's drift, in degrees: the shelf turned a little about the stage's middle. */
export type ShelfStage = { width: number; height: number; centre?: number; yaw?: number; pitch?: number };

/** How far the view drifts by itself while the shelf stands, in degrees each way, and how much of
 *  that again a tipped phone adds. Small on purpose: it is the shelf breathing, not turning. */
export const DRIFT = { yaw: 2.1, pitch: 1.2, tiltYaw: 1.4, tiltPitch: 0.8 } as const;

/** The view's drift at `now` milliseconds, with the device tipped `tilt` (-1 to 1 each way). */
export function driftAt(now: number, tilt: { x: number; y: number }): { yaw: number; pitch: number } {
  return {
    yaw: Math.sin(now / 2300) * DRIFT.yaw + tilt.x * DRIFT.tiltYaw,
    pitch: Math.sin(now / 3100 + 1) * DRIFT.pitch + tilt.y * DRIFT.tiltPitch,
  };
}

/**
 * Where a point of the shelf's space lands on the stage, from its top left, and the scale things
 * are drawn at there. The one camera the scene renders through (`ShelfScene.resize`): the eye
 * `lens` back, level with 44% down the stage, the shelf tipped `look` degrees about the stage's
 * middle.
 */
export function projectToStage(stage: ShelfStage, x: number, y: number, z: number): { x: number; y: number; scale: number } {
  const pivot = stage.height / 2 - SHELF.floor;
  const turn = rad(stage.yaw ?? 0);
  const turnedX = x * Math.cos(turn) + z * Math.sin(turn);
  const turnedZ = -x * Math.sin(turn) + z * Math.cos(turn);
  const tip = rad(SHELF.look + (stage.pitch ?? 0));
  const tippedY = (y - pivot) * Math.cos(tip) - turnedZ * Math.sin(tip) + pivot;
  const tippedZ = (y - pivot) * Math.sin(tip) + turnedZ * Math.cos(tip);
  const eye = 0.56 * stage.height - SHELF.floor;
  const scale = SHELF.lens / (SHELF.lens - tippedZ);
  return { x: (stage.centre ?? stage.width / 2) + turnedX * scale, y: stage.height - SHELF.floor - (eye + (tippedY - eye) * scale), scale };
}

/** A point of a placed book, given from its base's middle (`along` its width from the middle,
 *  `up` from its foot, `out` from its middle toward its cover), in the shelf's space. */
export function bookPoint(place: ShelfPlace, along: number, up: number, out: number): { x: number; y: number; z: number } {
  const c = Math.cos(rad(place.yaw));
  const s = Math.sin(rad(place.yaw));
  return { x: place.x + along * c + out * s, y: up, z: place.z - along * s + out * c };
}

/** Where the callouts drawn over the shelf stand, in the stage's points. */
export type ShelfCallouts = {
  /** The book in front, and how nearly it has arrived: 0 half way between two books, 1 at rest. */
  front: number;
  settled: number;
  /** `settled` as a scale that overshoots as it arrives, so a callout lands with a pop. */
  pop: number;
  /** The burst on the front book's top corner, at the scale that corner is drawn at. */
  burst: { x: number; y: number; scale: number };
  /** The caption on its bottom corner; `side` is the side of the book it hangs off. */
  caption: { x: number; y: number; side: 1 | -1 };
  /** Over each book's spine, and how much that book is still on the shelf. */
  tabs: { x: number; y: number; shelved: number }[];
};

export function popIn(settled: number): number {
  const overshoot = 1.70158;
  const u = settled - 1;
  return Math.max(0, 1 + (overshoot + 1) * u * u * u + overshoot * u * u);
}

export function shelfCallouts(books: readonly ShelfBook[], places: readonly ShelfPlace[], pos: number, stage: ShelfStage): ShelfCallouts {
  const front = clamp(Math.round(pos), 0, Math.max(0, books.length - 1));
  const none = { x: 0, y: 0 };
  if (!books.length) return { front, settled: 0, pop: 0, burst: { ...none, scale: 0 }, caption: { ...none, side: 1 }, tabs: [] };
  const on = (i: number, along: number, up: number, out: number) => {
    const point = bookPoint(places[i], along, up, out);
    return projectToStage(stage, point.x, point.y, point.z);
  };
  const { width, height, depth, binding } = books[front];
  // A book opens away from its binding, so its fore-edge corner is the free one.
  const free = binding === 'left' ? 1 : -1;
  const corner = on(front, (free * width) / 2, height, depth / 2);
  const foot = on(front, (-free * width) / 2, height * 0.05, depth / 2);
  const settled = clamp(1 - 2 * Math.abs(pos - front), 0, 1);
  return {
    front,
    settled,
    pop: popIn(settled),
    burst: { x: clamp(corner.x + free * 6, 50, stage.width - 50), y: Math.max(50, corner.y - 8), scale: corner.scale },
    caption: { x: foot.x, y: foot.y, side: free === 1 ? -1 : 1 },
    tabs: books.map((b, i) => {
      const head = on(i, ((b.binding === 'left' ? -1 : 1) * b.width) / 2, b.height, 0);
      return { x: head.x, y: head.y - 15, shelved: places[i].ink };
    }),
  };
}

/** The 4×4 Bayer threshold of a dither cell, 1/32 to 31/32 — the matrix the reader's page curl
 *  tones its shadows with (`page-curl-shader.ts`), so the shelf's tone is the app's own. */
export function bayer4(x: number, y: number): number {
  const x0 = x & 1;
  const y0 = y & 1;
  const x1 = (x >> 1) & 1;
  const y1 = (y >> 1) & 1;
  return (((x0 ^ y0) << 3) + (y0 << 2) + ((x1 ^ y1) << 1) + y1) / 16 + 1 / 32;
}

export type Rgb = readonly [number, number, number];

/**
 * A book's cloth, read off its cover: the average of the strip beside its binding, darkened, since
 * a spine is the cover's own colour wrapped round. `pixels` are RGBA rows from the top.
 */
export function boardColour(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, binding: CoverBinding): Rgb {
  const strip = Math.max(1, Math.round(width * 0.06));
  const from = binding === 'left' ? 0 : width - strip;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = from; x < from + strip; x++) {
      const at = (y * width + x) * 4;
      r += pixels[at];
      g += pixels[at + 1];
      b += pixels[at + 2];
      count++;
    }
  }
  if (!count) return NEUTRAL_BOARD;
  return [Math.round((r / count) * 0.82), Math.round((g / count) * 0.82), Math.round((b / count) * 0.82)];
}

export const NEUTRAL_BOARD: Rgb = [58, 58, 61];

/** Lettering that reads on a cloth of this colour. */
export function inkOn(board: Rgb): Rgb {
  const luminance = (0.2126 * board[0] + 0.7152 * board[1] + 0.0722 * board[2]) / 255;
  return luminance > 0.58 ? [28, 28, 30] : [244, 242, 236];
}

export const cssRgb = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`;

/**
 * Which series stand on the shelf, and in what order. `read` is what was read, most recent first,
 * and `news` what has chapters waiting, as the Activity tab orders it: half the shelf from each, and
 * where one has too few the other makes up the number. A series in both is one book, counted with
 * the news. The answer is in order of how much each matters: the one read most recently, whichever
 * half it came from, then the two halves alternating, news first. `arrangeShelf` stands them.
 */
export function pickShelf(read: readonly string[], news: readonly string[], count: number): string[] {
  const take = (newsCount: number) => {
    const fromNews = news.slice(0, newsCount);
    const taken = new Set(fromNews);
    return { fromNews, fromRead: read.filter((key) => !taken.has(key)).slice(0, count - fromNews.length) };
  };
  let picked = take(Math.min(news.length, Math.floor(count / 2)));
  const short = count - picked.fromNews.length - picked.fromRead.length;
  if (short > 0) picked = take(Math.min(news.length, picked.fromNews.length + short));
  const { fromNews, fromRead } = picked;
  const order: string[] = [];
  for (let i = 0; i < Math.max(fromNews.length, fromRead.length); i++) {
    if (i < fromNews.length) order.push(fromNews[i]);
    if (i < fromRead.length) order.push(fromRead[i]);
  }
  const chosen = new Set(order);
  const last = read.find((key) => chosen.has(key));
  return last === undefined ? order : [last, ...order.filter((key) => key !== last)];
}

/**
 * Books in order of how much they matter, stood along the shelf: the first in the middle and the
 * rest to either side of it by turns, so what matters least is furthest out whichever way the
 * reader goes. `shelfMiddle` is where the first one stands, which is where the shelf opens.
 */
export function arrangeShelf<T>(ranked: readonly T[]): T[] {
  const stood: T[] = [];
  ranked.forEach((book, i) => {
    if (i % 2) stood.push(book);
    else stood.unshift(book);
  });
  return stood;
}

export const shelfMiddle = (count: number) => Math.max(0, (count - 1) >> 1);
