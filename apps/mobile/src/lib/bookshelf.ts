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

/** `form` is what the book is, where that changes how it stands (`shelvedProud`); a book without
 *  one is taken for a bound volume. */
export type ShelfBook = { width: number; height: number; depth: number; binding: CoverBinding; form?: CoverForm };

/** `ink` is how far the book is from the one in front, 0 to 1: what the shelf draws in tone. `tip`
 *  is degrees the book leans toward the reader about the shelf's run, after its yaw, and `y` how far
 *  its foot is raised to keep it on the shelf as it does. `roll` is degrees it leans along the
 *  shelf, toward +x, after the tip. */
export type ShelfPlace = { x: number; z: number; yaw: number; ink: number; y?: number; tip?: number; roll?: number };

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

/** A spine under the pointer is drawn part way out, as a finger hooked over its head would: `pull`
 *  toward the reader, well short of the front book's `SHELF.pull`, and tipped `tip` degrees. */
export const HOVER = { pull: 16, tip: 5 } as const;

/** A book's place with the pointer's pull `amount` of the way on (0 to 1). It tips on the front
 *  edge of its foot, so the back of the foot lifts and nothing sinks into the shelf. */
export function hoveredPlace(place: ShelfPlace, book: ShelfBook, amount: number): ShelfPlace {
  if (!amount) return place;
  const turn = rad(place.yaw);
  const reach = Math.abs((book.width / 2) * Math.sin(turn)) + Math.abs((book.depth / 2) * Math.cos(turn));
  const tip = rad(HOVER.tip * amount);
  return {
    ...place,
    z: place.z + HOVER.pull * amount + reach * (1 - Math.cos(tip)),
    y: (place.y ?? 0) + reach * Math.sin(tip),
    tip: (place.tip ?? 0) + HOVER.tip * amount,
  };
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

/** Where a spine's number stands, as fractions of the spine's length: the middle of its slot at
 *  the foot, under the title and over the foot's rule, and the slot's length. */
export const SPINE_FOOT = { middle: 0.902, length: 0.09 } as const;

/**
 * How a spine's number is set so that all of it shows, in the spine picture's pixels: across the
 * spine as large as its width allows, or, where that would be smaller than turning it, down the
 * spine the way a thin volume's number is printed. `em` is the number's width at a size of 1, `cap`
 * the largest it is ever set, and `least` the smallest worth drawing — under it, `null`.
 */
export function spineNumberFit({ em, width, length, cap, least }: { em: number; width: number; length: number; cap: number; least: number }): {
  size: number;
  turned: boolean;
} | null {
  if (!(em > 0)) return null;
  const slot = length * SPINE_FOOT.length;
  const across = Math.min(cap, width * 0.44, slot * 0.8, (width * 0.8) / em);
  const along = Math.min(cap, width * 0.6, (slot * 0.9) / em);
  // Across reads without turning the head, so it is kept until turning is clearly larger.
  const turned = along > across * 1.15;
  const size = turned ? along : across;
  return size < least ? null : { size, turned };
}

/** A cover's width for a stage this wide: about a third of a phone, and no larger on a wide one. */
export function shelfCoverWidth(stageWidth: number): number {
  return clamp(stageWidth * 0.34, 96, 136);
}

/** Covers are drawn between these shapes (width / height); a picture outside them is cropped to
 *  the nearer one, so one odd cover never sets the height of the row. */
export const SHELF_ASPECT = { tall: 0.64, wide: 0.8, unknown: 2 / 3 } as const;

/** The stage's height in points for a stage this wide, its scene drawn `zoom` times life size. */
export function shelfStageHeight(stageWidth: number, zoom = 1): number {
  return Math.round((shelfCoverWidth(stageWidth / zoom) / SHELF_ASPECT.tall + SHELF.floor + SHELF.headroom) * zoom);
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

/** How far a hard cover's rounded back bulges past its boards. */
export function spineBulge(depth: number): number {
  return clamp(depth * 0.24, 2, 6);
}

/** How a set's two prints stand: each one's lean in degrees, and how far the one behind sits
 *  toward the binding's side, of the width. The card's own picture of a set (`PRINT.tilt`) turned
 *  further and pulled apart, since on a shelf it has a row of books to be told from. */
export const PRINT_LEAN = { front: -3, behind: 8.5, aside: 0.07 } as const;

/**
 * How far a book standing spine out reaches in front of the line of spines: a hard cover by its
 * rounded back, and a CG set by the corner of a print, since a print leaning across the shelf
 * leans toward the reader. The rest stand flush.
 */
export function shelvedProud(book: ShelfBook): number {
  switch (book.form ?? 'volume') {
    case 'volume':
      return spineBulge(book.depth);
    case 'sheets':
      return Math.max(
        ...[
          [PRINT_LEAN.front, 0],
          [PRINT_LEAN.behind, PRINT_LEAN.aside],
        ].map(([lean, aside]) => {
          const turn = rad(lean);
          return book.width * aside + (book.width / 2) * Math.cos(turn) + (book.height / 2) * Math.abs(Math.sin(turn)) - book.width / 2;
        }),
      );
    default:
      return 0;
  }
}

/** A book's turn, how far forward it stands and the room it takes along the shelf at that turn,
 *  with `pos` in front. */
function stance(book: ShelfBook, index: number, pos: number) {
  const offset = index - pos;
  const away = Math.abs(offset);
  const side = offset < 0 ? -1 : 1;
  // A spine faces the reader at +90 for a book bound on its left and -90 for one bound on its right.
  const spine = book.binding === 'left' ? 90 : -90;
  const front = smoothstep(1 - away);
  const yaw =
    away >= 1
      ? spine + side * SHELF.peel * Math.exp(-(away - 1) / 1.3)
      : (spine + side * SHELF.peel) * (1 - front) + Math.sign(spine) * SHELF.coverYaw * front;
  return {
    yaw,
    front,
    foot: book.width * Math.abs(Math.cos(rad(yaw))) + book.depth * Math.abs(Math.sin(rad(yaw))),
    z: (-book.width / 2) * (1 - front) + (SHELF.pull + book.depth / 2) * front,
  };
}

/** The air kept between two books that would otherwise touch as they turn. */
const CLEARANCE = 1.5;

/**
 * How far two placed books run into each other, seen from above (0 when they are clear): the
 * least of their overlaps along each one's own two axes. `air` is a margin added round both.
 */
export function shelfOverlap(a: ShelfBook, at: ShelfPlace, b: ShelfBook, bt: ShelfPlace, air = 0): number {
  const box = (book: ShelfBook, place: ShelfPlace) => {
    const c = Math.cos(rad(place.yaw));
    const s = Math.sin(rad(place.yaw));
    const across = [c, -s] as const;
    const through = [s, c] as const;
    const w = (book.width + air) / 2;
    const d = (book.depth + air) / 2;
    const corners = [-1, 1].flatMap((i) => [-1, 1].map((j) => [place.x + i * w * across[0] + j * d * through[0], place.z + i * w * across[1] + j * d * through[1]] as const));
    return { corners, axes: [across, through] };
  };
  const one = box(a, at);
  const other = box(b, bt);
  let least = Infinity;
  for (const axis of [...one.axes, ...other.axes]) {
    const along = (corners: readonly (readonly [number, number])[]) => corners.map(([x, z]) => x * axis[0] + z * axis[1]);
    const p = along(one.corners);
    const q = along(other.corners);
    const shared = Math.min(Math.max(...p), Math.max(...q)) - Math.max(Math.min(...p), Math.min(...q));
    if (shared <= 0) return 0;
    least = Math.min(least, shared);
  }
  return least;
}

/**
 * Every book's place with `pos` in front (a fraction between two books mid-drag).
 *
 * Books stand spine out, the one in front turned to show its cover and its neighbours leaning away
 * from it. The room each is given along the shelf is the room it takes AT REST: what it has with
 * the book before `pos` in front, and with the book after, and the share of each that `pos` is
 * between them. So as the shelf steps along, every book beside the two that are trading places
 * moves once, one way, by the difference between two rests.
 *
 * It was the room a book takes at its own angle at that instant, and that is not a steady thing: a
 * turning book takes more half way round than at either end, and the one leaving the front turns a
 * little past edge-on, so it takes least exactly edge-on. The spines beside it were pushed out,
 * drawn back in and pushed out again on every step, three times as far as they ended up moving.
 *
 * Two books turning toward each other (bound on opposite sides) would meet inside the room of two
 * rests, so a turning book is moved along just far enough to clear the two before it. The front
 * book is held a little toward the side that has no more books, so the first and the last don't
 * stand beside an empty half.
 */
export function placeShelf(books: readonly ShelfBook[], pos: number): ShelfPlace[] {
  const n = books.length;
  const places = new Array<ShelfPlace>(n);
  if (n === 0) return places;
  const held = clamp(pos, 0, n - 1);
  const lower = Math.min(Math.max(0, n - 2), Math.floor(held));
  const between = held - lower;
  const upper = Math.min(n - 1, lower + 1);
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const now = stance(books[i], i, pos);
    const foot = stance(books[i], i, lower).foot * (1 - between) + stance(books[i], i, upper).foot * between;
    const place = { x: cursor + foot / 2, z: now.z, yaw: now.yaw, ink: 1 - now.front };
    // Only a book that is turning reaches past its room, and only as far as the two before it.
    if (now.front > 0 || (i > 0 && places[i - 1].ink < 1)) {
      const meets = (x: number) => [i - 1, i - 2].some((j) => j >= 0 && shelfOverlap(books[j], places[j], books[i], { ...place, x }, CLEARANCE) > 0);
      if (meets(place.x)) {
        let clear = place.x + now.foot;
        let touching = place.x;
        for (let step = 0; step < 14; step++) {
          const middle = (clear + touching) / 2;
          if (meets(middle)) touching = middle;
          else clear = middle;
        }
        place.x = clear;
      }
    }
    places[i] = place;
    cursor = place.x + foot / 2 + SHELF.gap;
  }
  const lean = n > 1 ? 46 * ((2 * held) / (n - 1) - 1) : 0;
  // Past either end the whole shelf follows the finger, at the resistance `rubberBand` gave it.
  const focus = places[lower].x * (1 - between) + places[upper].x * between - lean + (pos - held) * 110;
  for (let i = 0; i < n; i++) places[i].x -= focus;
  return places;
}

/**
 * How the carousel's spines knock into each other: a spine shoved along the shelf to make room for
 * the book in front leans back against the push, swings past upright as the push stops and rocks
 * to rest, and pulls on the ones beside it, so a knock runs a few books down the row. `gain` is
 * degrees of lean for each point a second it is shoved, `max` the most it leans, `coupling` how
 * hard it pulls its neighbours, and `follow` how quickly the speed it leans by follows its own.
 */
export const KNOCK = { gain: 0.028, max: 4, stiffness: 170, damping: 6, coupling: 90, follow: 18 } as const;

/** Each book's lean along the shelf in degrees and how fast it is rocking, how fast it is being
 *  shoved, and where it stood last frame (none before the first). */
export type Knocks = { x: number[] | null; speed: number[]; lean: number[]; spin: number[] };

export function restingKnocks(count: number): Knocks {
  return { x: null, speed: new Array<number>(count).fill(0), lean: new Array<number>(count).fill(0), spin: new Array<number>(count).fill(0) };
}

/**
 * One frame of the knocks, `dt` seconds on, the books at `places` and the shelf at `pos`; whether
 * every book has come to rest. Only the room round the book in front knocks: the row's own slide,
 * read off the books three and more from the front, which only ever slide, is taken out, or every
 * move would rock the whole shelf like a carriage. The front book is shoved in its tone's measure
 * (`ink`), so the one turned to the reader stands still.
 */
export function stepKnocks(knocks: Knocks, places: readonly ShelfPlace[], pos: number, dt: number): boolean {
  const n = places.length;
  const was = knocks.x;
  knocks.x = places.map((p) => p.x);
  if (!was || was.length !== n || dt <= 0) return knocks.lean.every((lean) => lean === 0);
  const moved = places.map((p, i) => p.x - was[i]);
  const far = moved.filter((_, i) => Math.abs(i - pos) >= 3);
  const ride = far.length ? far : moved;
  const slide = ride.reduce((sum, d) => sum + d, 0) / ride.length;
  const follow = 1 - Math.exp(-dt * KNOCK.follow);
  for (let i = 0; i < n; i++) knocks.speed[i] += ((moved[i] - slide) / dt - knocks.speed[i]) * follow;
  for (let i = 0; i < n; i++) {
    const want = clamp(-KNOCK.gain * knocks.speed[i], -KNOCK.max, KNOCK.max) * clamp(places[i].ink, 0, 1);
    const beside = (i > 0 ? knocks.lean[i - 1] : 0) + (i < n - 1 ? knocks.lean[i + 1] : 0) - 2 * knocks.lean[i];
    knocks.spin[i] += (-KNOCK.stiffness * (knocks.lean[i] - want) - KNOCK.damping * knocks.spin[i] + KNOCK.coupling * beside) * dt;
  }
  let rest = true;
  for (let i = 0; i < n; i++) {
    knocks.lean[i] += knocks.spin[i] * dt;
    if (Math.abs(knocks.speed[i]) < 0.5) knocks.speed[i] = 0;
    if (knocks.speed[i] === 0 && Math.abs(knocks.lean[i]) < 0.002 && Math.abs(knocks.spin[i]) < 0.01) {
      knocks.lean[i] = 0;
      knocks.spin[i] = 0;
    } else rest = false;
  }
  return rest;
}

/** A book leaning `degrees` along the shelf, on the edge of its foot it leans toward, so nothing
 *  sinks into the shelf: the foot's run along the shelf at its turn. */
export function leanedPlace(place: ShelfPlace, book: ShelfBook, degrees: number): ShelfPlace {
  if (!degrees) return place;
  const turn = rad(place.yaw);
  const run = book.width * Math.abs(Math.cos(turn)) + book.depth * Math.abs(Math.sin(turn));
  const fall = rad(Math.abs(degrees));
  return {
    ...place,
    x: place.x + Math.sign(degrees) * (run / 2) * (1 - Math.cos(fall)),
    y: (place.y ?? 0) + (run / 2) * Math.sin(fall),
    roll: (place.roll ?? 0) + degrees,
  };
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

/**
 * How the shelf answers a swipe (Settings → General → Bookshelf motion). `carousel` turns every
 * book it passes to face the reader and stands the row round the one in front (`placeShelf`).
 * The other two leave the row spine out and bring a book off it, face out and leaning back on the
 * spines (`placeDisplay`): `display` only the book the swipe lands on, once it has landed, each
 * spine sliding a little way out as the swipe passes over it; `display-swipe` every book the swipe
 * passes, as it passes, the display following the swipe the way the carousel's turn does.
 */
export type ShelfMotion = 'carousel' | 'display' | 'display-swipe';

export const DISPLAY = {
  /** How far a spine comes out under the swipe. */
  nudge: 24,
  /** How far the book in front stands clear of whatever stands proudest of the line of spines
   *  behind it (`shelvedProud`), and the least it stands clear of the line itself. */
  air: 2,
  clear: 8,
  /** Its turn short of square on, so its spine still shows, and how far back it leans. */
  yaw: 4,
  lean: 8,
  /** How far the books on either side settle into the gap it left, in degrees. */
  settle: 3.2,
  /** Seconds it takes to come out, and to go back. */
  out: 0.5,
  back: 0.3,
  /** How near the shelf has to be to the book it is landing on for that book to start coming out. */
  landing: 0.4,
} as const;

/** Where each book stands along a display row, spine out and packed: its middle, from the row's start. */
export function displayRow(books: readonly ShelfBook[]): number[] {
  const row: number[] = [];
  let cursor = 0;
  for (const book of books) {
    row.push(cursor + book.depth / 2);
    cursor += book.depth + SHELF.gap;
  }
  return row;
}

/** The point along the row a place on the shelf stands at, carried on past either end. A finger's
 *  travel is measured in it, so under a swipe the row moves exactly as far as the finger does. */
export function rowAt(row: readonly number[], pos: number): number {
  if (row.length < 2) return row[0] ?? 0;
  const k = clamp(Math.floor(pos), 0, row.length - 2);
  return row[k] + (row[k + 1] - row[k]) * (pos - k);
}

export function posAtRow(row: readonly number[], at: number): number {
  if (row.length < 2) return 0;
  let k = 0;
  while (k < row.length - 2 && at > row[k + 1]) k++;
  return k + (at - row[k]) / (row[k + 1] - row[k]);
}

/** Points of row per book where `pos` stands, for turning a fling's speed into books. */
export function rowSpacing(row: readonly number[], pos: number): number {
  if (row.length < 2) return 1;
  const k = clamp(Math.floor(pos), 0, row.length - 2);
  return row[k + 1] - row[k];
}

const backOut = (t: number) => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/**
 * A book on a display row: `near` how close the swipe is to it (0 to 1), `shown` how far its
 * display has played (0 to 1). The display is three moves run as one: it slides straight out
 * until it is clear of the row, swings round to face the reader, and leans back on the spines,
 * pivoting on the back of its foot. The swing leaves the top of the slide already moving and the
 * lean starts before the swing ends: eased to a stop between them, the three read as three moves.
 */
export function displayPose(book: ShelfBook, near: number, shown: number, x: number, clear: number = DISPLAY.clear): ShelfPlace {
  const spine = book.binding === 'left' ? 90 : -90;
  const pulled = -book.width / 2 + DISPLAY.nudge * near;
  if (shown <= 0) return { x, z: pulled, yaw: spine, ink: 1 - near };
  const slide = smoothstep(shown / 0.36);
  const along = clamp((shown - 0.36) / 0.42, 0, 1);
  const turn = 1 - (1 - along) * (1 - along);
  const lean = backOut(clamp((shown - 0.64) / 0.36, 0, 1));
  const ink = Math.min(1 - near, 1 - slide);
  if (turn <= 0) return { x, z: pulled + slide * (clear + book.width / 2 - pulled), yaw: spine, ink };
  const yaw = spine * (1 - turn) + Math.sign(spine) * DISPLAY.yaw * turn;
  // Half its footprint toward the row at this turn: its back stays that far clear.
  const reach = (book.width / 2) * Math.abs(Math.sin(rad(yaw))) + (book.depth / 2) * Math.abs(Math.cos(rad(yaw)));
  const back = rad(DISPLAY.lean * lean);
  return {
    x,
    z: clear + book.height * Math.sin(back) + reach * Math.cos(back),
    y: reach * Math.sin(back),
    yaw,
    tip: -DISPLAY.lean * lean,
    ink,
  };
}

/**
 * Under `display-swipe`, the book on display and how far its display has played, from where the
 * swipe is alone: all of it on the book the swipe is over, none half way to the next. Only the
 * book within half a step plays it, so two never stand out at once: two did, and one stood out
 * spine first in front of the other's cover.
 */
export function displayScrubbed(pos: number, count: number): { index: number; amount: number } {
  const index = clamp(Math.round(pos), 0, Math.max(0, count - 1));
  return { index, amount: smoothstep((smoothstep(1 - Math.abs(index - pos)) - 0.5) * 2) };
}

/** A spine-out book leaning `degrees` along the shelf, on the edge of its foot it leans toward. */
export function settledPlace(place: ShelfPlace, book: ShelfBook, degrees: number): ShelfPlace {
  if (!degrees) return place;
  const half = book.depth / 2;
  const fall = rad(Math.abs(degrees));
  return { ...place, x: place.x + Math.sign(degrees) * half * (1 - Math.cos(fall)), y: (place.y ?? 0) + half * Math.sin(fall), roll: degrees };
}

/** How far each book wants to lean, in degrees: the two beside the one on display, into the gap it
 *  left, once it is out of it; none that the swipe is drawing out itself (`nudged`, as for
 *  `placeDisplay`). */
export function displaySettles(count: number, pos: number, shown: { index: number; amount: number }, nudged = true): number[] {
  const settles = new Array<number>(count).fill(0);
  const gap = smoothstep((shown.amount - 0.34) / 0.16) * DISPLAY.settle;
  if (!gap) return settles;
  const free = (j: number) => j >= 0 && j < count && j !== shown.index && (!nudged || Math.abs(j - pos) >= 1);
  if (free(shown.index - 1)) settles[shown.index - 1] = gap;
  if (free(shown.index + 1)) settles[shown.index + 1] = -gap;
  return settles;
}

/**
 * Every book's place on a display row with `pos` under the swipe and `shown` the book on display.
 * The row stands round `pos`, held a little toward the side that has no more books, as
 * `placeShelf` holds it; `settles` is each book's lean along the shelf, which the driver springs.
 * `nudged` slides out the spines the swipe passes over; not under `display-swipe`, where the
 * display itself follows the swipe and plays within half a step of spines it would draw out.
 */
export function placeDisplay(
  books: readonly ShelfBook[],
  row: readonly number[],
  pos: number,
  shown: { index: number; amount: number },
  settles: readonly number[],
  nudged = true,
): ShelfPlace[] {
  const n = books.length;
  const held = clamp(pos, 0, Math.max(0, n - 1));
  const toward = n > 1 ? 46 * ((2 * held) / (n - 1) - 1) : 0;
  const focus = rowAt(row, pos) - toward;
  const clear = displayClear(books, row, shown.index);
  return books.map((book, i) => {
    const near = nudged ? smoothstep(1 - Math.abs(i - pos)) : 0;
    const place = displayPose(book, near, i === shown.index ? shown.amount : 0, row[i] - focus, clear);
    return settledPlace(place, book, settles[i] ?? 0);
  });
}

/** How far in front of the line of spines the book on display stands: clear of all that stands
 *  proud of it behind the book (a CG set's print reaches a good way out), and never nearer than
 *  `DISPLAY.clear`. */
export function displayClear(books: readonly ShelfBook[], row: readonly number[], index: number): number {
  const shown = books[index];
  if (!shown) return DISPLAY.clear;
  let proud = 0;
  books.forEach((book, j) => {
    if (j !== index && Math.abs(row[j] - row[index]) < shown.width / 2 + book.depth / 2 + SHELF.gap) proud = Math.max(proud, shelvedProud(book));
  });
  return Math.max(DISPLAY.clear, proud + DISPLAY.air);
}

/** `centre` is where along the stage's width the shelf's middle stands: its own middle unless the
 *  stage runs under something the selection should not sit behind (a bar down one side). `yaw` and
 *  `pitch` are the view's drift, in degrees: the shelf turned a little about the stage's middle. */
/** The stage in points. `zoom` draws the scene that many times life size: the shelf is built in
 *  points of a phone's stage, and a stage `zoom` times as large in every direction shows the same
 *  shelf, books, gaps and camera all scaled together. */
export type ShelfStage = { width: number; height: number; centre?: number; yaw?: number; pitch?: number; zoom?: number };

/** How far the view drifts by itself while the shelf stands, in degrees each way, and how much a
 *  tipped phone adds. The drift is small on purpose: it is the shelf breathing, not turning, and at
 *  half as much again it read as the shelf swaying. A tip is the reader's own move, so it carries
 *  further. */
export const DRIFT = { yaw: 1.4, pitch: 0.8, tiltYaw: 2.1, tiltPitch: 1.2 } as const;

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
  const zoom = stage.zoom ?? 1;
  const height = stage.height / zoom;
  const centre = (stage.centre ?? stage.width / 2) / zoom;
  const pivot = height / 2 - SHELF.floor;
  const turn = rad(stage.yaw ?? 0);
  const turnedX = x * Math.cos(turn) + z * Math.sin(turn);
  const turnedZ = -x * Math.sin(turn) + z * Math.cos(turn);
  const tip = rad(SHELF.look + (stage.pitch ?? 0));
  const tippedY = (y - pivot) * Math.cos(tip) - turnedZ * Math.sin(tip) + pivot;
  const tippedZ = (y - pivot) * Math.sin(tip) + turnedZ * Math.cos(tip);
  const eye = 0.56 * height - SHELF.floor;
  const scale = SHELF.lens / (SHELF.lens - tippedZ);
  return {
    x: (centre + turnedX * scale) * zoom,
    y: (height - SHELF.floor - (eye + (tippedY - eye) * scale)) * zoom,
    scale: scale * zoom,
  };
}

/** A point of a placed book, given from its base's middle (`along` its width from the middle,
 *  `up` from its foot, `out` from its middle toward its cover), in the shelf's space. */
export function bookPoint(place: ShelfPlace, along: number, up: number, out: number): { x: number; y: number; z: number } {
  const c = Math.cos(rad(place.yaw));
  const s = Math.sin(rad(place.yaw));
  const z = -along * s + out * c;
  const tc = Math.cos(rad(place.tip ?? 0));
  const ts = Math.sin(rad(place.tip ?? 0));
  const x = along * c + out * s;
  const y = up * tc - z * ts;
  const rc = Math.cos(rad(place.roll ?? 0));
  const rs = Math.sin(rad(place.roll ?? 0));
  return { x: place.x + x * rc + y * rs, y: (place.y ?? 0) - x * rs + y * rc, z: place.z + up * ts + z * tc };
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

/** `lead` names the book the callouts stand on and how nearly it has arrived, where that is not
 *  simply the one `pos` is nearest: on a display row, the one on display, as far as it has come out. */
export function shelfCallouts(
  books: readonly ShelfBook[],
  places: readonly ShelfPlace[],
  pos: number,
  stage: ShelfStage,
  lead?: { index: number; settled: number },
): ShelfCallouts {
  const front = clamp(lead?.index ?? Math.round(pos), 0, Math.max(0, books.length - 1));
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
  const settled = clamp(lead?.settled ?? 1 - 2 * Math.abs(pos - front), 0, 1);
  // On a display row the book on display stands across the spines behind it, and their tabs go
  // with them as it comes out.
  const across = lead ? [on(front, -width / 2, height, depth / 2).x, on(front, width / 2, height, depth / 2).x] : null;
  const behind = across ? [Math.min(...across), Math.max(...across)] : null;
  return {
    front,
    settled,
    pop: popIn(settled),
    burst: { x: clamp(corner.x + free * 6, 50, stage.width - 50), y: Math.max(50, corner.y - 8), scale: corner.scale },
    caption: { x: foot.x, y: foot.y, side: free === 1 ? -1 : 1 },
    tabs: books.map((b, i) => {
      const head = on(i, ((b.binding === 'left' ? -1 : 1) * b.width) / 2, b.height, 0);
      const hidden = behind && i !== front && head.x > behind[0] && head.x < behind[1];
      return { x: head.x, y: head.y - 15, shelved: places[i].ink * (hidden ? 1 - settled : 1) };
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
