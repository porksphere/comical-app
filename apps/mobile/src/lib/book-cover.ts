/**
 * Book covers: a series card drawn as the object it is rather than as a flat tile. Pure geometry and
 * decisions only — no react-native imports — so the rules can be tested; `components/book-chrome.tsx`
 * draws them and `hooks/use-book-covers.ts` decides which ones apply to a card.
 *
 * Four forms, each the quietest take of its kind — the contract's `coverForm`:
 *  - `volume` — a bound book: a spine on the binding side.
 *  - `issue` — a saddle-stitched booklet (doujinshi, oneshots): a crease and two staples on the fold.
 *  - `scroll` — nothing bound (webtoons): rounder corners, no spine.
 *  - `sheets` — loose pictures (CG sets): a print in a white paper border, another tipped behind it.
 */
import type { CoverForm, ReadingDirection } from '@comical/contract';

export type { CoverForm, ReadingDirection };
export type CoverBinding = 'left' | 'right';
export type BookCover = { form: CoverForm; binding: CoverBinding };

/**
 * A bound form on a cover wider than this is drawn unbound. A hinge on a square reads as a board book,
 * and the survey behind this found nothing that wide on a bound form that was a real book's shape:
 * square crops, single wide illustrations and front-and-back scans, which shape alone can't tell
 * apart — so the whole picture is kept and only the spine goes.
 */
export const BOUND_MAX_ASPECT = 0.8;

/**
 * How a card is drawn. What the bridge says wins — the series' own hint, then its bridge's default —
 * and the app only guesses what neither said: a series the reader reads vertically is unbound, a
 * direct (page-gallery) series is an issue, anything else a volume. The binding follows the declared
 * direction, else the reader's own setting.
 */
export function resolveCover({
  form,
  direction,
  readsVertically,
  readerRightToLeft,
  direct,
  aspect,
}: {
  /** The series' `coverForm`, else its bridge's. */
  form?: CoverForm;
  /** The series' `readingDirection`, else its bridge's. */
  direction?: ReadingDirection;
  /** The reader shows this series vertically: its own mode, or the reader's when it has none. */
  readsVertically: boolean;
  readerRightToLeft: boolean;
  direct: boolean;
  /** The cover's own shape (width / height). */
  aspect: number;
}): BookCover {
  const vertical = direction ? direction === 'vertical' : readsVertically;
  let resolved: CoverForm = form ?? (vertical ? 'scroll' : direct ? 'issue' : 'volume');
  if ((resolved === 'volume' || resolved === 'issue') && aspect > BOUND_MAX_ASPECT) resolved = 'scroll';
  const rightToLeft = direction === 'rtl' || (direction !== 'ltr' && readerRightToLeft);
  return BOOK_COVERS[resolved][rightToLeft ? 'right' : 'left'];
}

const FORMS: readonly CoverForm[] = ['volume', 'issue', 'scroll', 'sheets'];

/**
 * A form and a binding picked for a series out of nowhere but its key (Settings → Developer → Shuffle
 * book covers), so every style shows up on real covers. Stable per series — a card keeps its book
 * while a list scrolls and recycles — and handed to `resolveCover` as a bridge's hint would be, so a
 * wide cover still drops its spine.
 */
export function shuffledHints(key: string): { form: CoverForm; direction: ReadingDirection } {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h >>>= 0;
  return { form: FORMS[h % FORMS.length], direction: (h >>> 8) & 1 ? 'rtl' : 'ltr' };
}

/**
 * How much of the cover's width the spine-side treatment covers, as a fraction. Anything laid over
 * the cover on that side (badges) starts past it rather than on the crease.
 */
export const SPINE_FRACTION: Record<CoverForm, number> = { volume: 0.065, issue: 0.04, scroll: 0, sheets: 0 };

/** One object per form and binding, so a card's `book` prop is the same object from render to render
 *  and nothing below it re-renders for a new-but-equal value while a list recycles. */
export const BOOK_COVERS: Readonly<Record<CoverForm, Readonly<Record<CoverBinding, BookCover>>>> = {
  volume: { left: { form: 'volume', binding: 'left' }, right: { form: 'volume', binding: 'right' } },
  issue: { left: { form: 'issue', binding: 'left' }, right: { form: 'issue', binding: 'right' } },
  scroll: { left: { form: 'scroll', binding: 'left' }, right: { form: 'scroll', binding: 'right' } },
  sheets: { left: { form: 'sheets', binding: 'left' }, right: { form: 'sheets', binding: 'right' } },
};

/**
 * A CG set is a print: its picture in a white paper border, with a second print tipped behind it.
 * Fractions of the cover box for the front print's place, of the print's width for its border, and
 * degrees for the one behind. Nearly the whole box: a fan of prints with clear space beside it gave a
 * twelfth of the card's width to nothing.
 */
export const PRINT = { left: 0.015, top: 0.02, width: 0.97, height: 0.96, border: 0.025, tilt: -3.5 } as const;

/** A print's picture inside its border, as fractions of the print: the border is the same width all
 *  round, so its top and bottom are the side border scaled by the print's own shape. */
export function printWindow(aspect: number): { left: number; right: number; top: number; bottom: number } {
  const ends = PRINT.border * ((PRINT.width * aspect) / PRINT.height);
  return { left: PRINT.border, right: PRINT.border, top: ends, bottom: ends };
}

/** A bound book's corner: Apple Books' own, measured on an iPhone at about 1.2 pt whatever the book's
 *  size. A rounder corner is the quickest way to make a book read as an app tile. (These were once
 *  fitted against the web build, whose squircle cuts far less than iOS's continuous corner, and came
 *  out two and a half times rounder on a device.) */
export const BOUND_CORNER = { phone: 1.5, desktop: 2 } as const;

/** An unbound webtoon pane rounds further, as Apple Books rounds a square audiobook cover (about 3 pt)
 *  against its books. */
export const LOOSE_CORNER = { phone: 3, desktop: 5 } as const;

/** A photo print's corner: barely rounded, as paper is. */
export const PRINT_CORNER = { phone: 2, desktop: 3 } as const;

/**
 * One radius for all four corners. A book is squarer at the spine than at the fore-edge, but on iOS a
 * clipping view whose corners differ gets a mask layer instead of `cornerRadius`, and a mask is an
 * offscreen pass on every card in every frame of a scroll. The hinge already says which side is bound.
 */
export function bookRadius(cover: BookCover, desktop: boolean): number {
  const corner = cover.form === 'sheets' ? PRINT_CORNER : cover.form === 'scroll' ? LOOSE_CORNER : BOUND_CORNER;
  return desktop ? corner.desktop : corner.phone;
}

export type Shade = { colors: readonly [string, string, ...string[]]; locations: readonly [number, number, ...number[]] };

/**
 * A bound book's shading across its width, read from the spine to the fore-edge. Measured off Apple
 * Books, whose books read as books on any art because every cue is narrow and crisp and kept to the
 * edges: the board rolling away at the spine, a highlight, one groove and a lip, all inside the first
 * 6.5% of the width, then nothing until a catch of light on the fore-edge. A wide, soft hinge (which
 * this was) loses to busy cover art: on manga it was simply gone.
 *
 * Each colour fades to transparent in its own hue before the next begins, so no stop interpolates
 * through grey. The spine's cues sit a third stronger than Apple's: at their measured strength busy
 * manga art still swallowed the groove.
 */
export const SPINE: Shade = {
  colors: [
    'rgba(0,0,0,0.38)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.135)', 'rgba(255,255,255,0)',
    'rgba(0,0,0,0)', 'rgba(0,0,0,0.175)', 'rgba(0,0,0,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)',
  ],
  locations: [0, 0.01, 0.011, 0.011, 0.012, 0.016, 0.023, 0.026, 0.037, 0.048, 0.048, 0.054, 0.065, 0.988, 1],
};

/** A saddle-stitched issue: no board, but its cover bent round the staples — a bright lip where the
 *  fold catches the light and a crease behind it, inside 4.2% of the width — and the same lip at the
 *  fore-edge. Deeper than a volume's cues, so the fold itself reads on busy art. */
export const FOLD: Shade = {
  colors: [
    'rgba(255,255,255,0.3)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0)',
    'rgba(0,0,0,0)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)',
  ],
  locations: [0, 0.006, 0.0085, 0.0085, 0.011, 0.026, 0.042, 0.988, 1],
};

/**
 * An issue's two saddle staples, a fifth of the way in from each end, as fractions: `at` and `length`
 * of the cover's height, `width` of its width (never under `minWidth` points), and `inset` from the
 * binding edge — a thin flat wire lying in the crease. The crease alone made an issue a slightly
 * thinner volume, which real cover art erased; a staple is the one thing a book never has. Drawn far
 * bigger than a real staple (whose wire is about 0.3% of a B5's width) or it vanishes at card size,
 * but kept to a wire: glossy pills standing past the edge read as plastic, not metal.
 */
export const STAPLES = { at: [0.205, 0.725], length: 0.07, inset: 0.009, width: 0.011, minWidth: 1.2 } as const;

/** A staple's wire, lit from the left and falling away across its width; its shadow on the paper is a
 *  hard offset copy (`BookStaples`), since a `boxShadow` would be a layer per card. */
export const STAPLE: Shade = {
  colors: ['#EEF1F5', '#A7AEB8'],
  locations: [0, 1],
};

/** Every form's top and bottom, read downward: the top edge catches the light and the bottom edge
 *  turns away from it, each inside the last 1.5–2% — Apple's +13% and −28%. These, not an outline,
 *  are what hold a cover's edge on a page of its own colour. */
export const EDGES: Shade = {
  colors: ['rgba(255,255,255,0.13)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.28)'],
  locations: [0, 0.014, 0.98, 1],
};

/**
 * The shadow's picture (`assets/images/book-shadow-*.png`, drawn by `scripts/generate-book-shadow.py`)
 * is laid out for a 2:3 cover with this much margin around it, in units of the cover's width. It must
 * match the script's SIDE / TOP / FOOT.
 */
export const SHADOW_BOX = { side: 0.15, top: 0.12, foot: 0.32, coverHeight: 1.5 } as const;

/** Where the shadow's picture lies, in fractions of the cover's box, under a cover filling it or a
 *  print at `PRINT`. The pictures stretch with the cover, so this holds at any shape. */
export function shadowPlacement(sheets: boolean): { left: number; top: number; width: number; height: number } {
  const cast = sheets ? PRINT : { left: 0, top: 0, width: 1, height: 1 };
  const { side, top, foot, coverHeight } = SHADOW_BOX;
  return {
    left: cast.left - side * cast.width,
    top: cast.top - (top / coverHeight) * cast.height,
    width: (1 + 2 * side) * cast.width,
    height: ((top + coverHeight + foot) / coverHeight) * cast.height,
  };
}

export type LiftShade = { rim: string; foot: string };

/** The shadow's two layers in light mode, and the glow's before a cover's own tints are read — the
 *  alphas of generate-book-shadow.py, the glow's neutral tints those of `NEUTRAL_GLOW`. */
export const LIFT_SHADE: LiftShade = { rim: 'rgba(0,0,0,0.16)', foot: 'rgba(0,0,0,0.22)' };
export const NEUTRAL_LIFT_GLOW: LiftShade = { rim: 'rgba(200,200,200,0.3)', foot: 'rgba(138,138,138,0.3)' };

/**
 * The shadow's picture as two live shadows, its rim and its foot, for a thumbnail `width` wide: a list
 * row's rounded thumbnail, too round for the picture, whose cleared middle has square corners, and few
 * enough on screen to afford a live shadow each. The script's rects and sigmas in the thumbnail's
 * width; a CSS blur radius is twice the sigma.
 */
export function liftShadows(width: number, { rim, foot }: LiftShade) {
  return [
    { offsetX: 0, offsetY: 0.02 * width, blurRadius: 0.096 * width, color: rim },
    { offsetX: 0, offsetY: 0.2 * width, blurRadius: 0.16 * width, spreadDistance: -0.12 * width, color: foot },
  ];
}
