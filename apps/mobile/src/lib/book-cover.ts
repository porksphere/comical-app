/**
 * Book covers: a series card drawn as the object it is rather than as a flat tile. Pure geometry and
 * decisions only — no react-native imports — so the rules can be tested; `components/book-chrome.tsx`
 * draws them and `hooks/use-book-covers.ts` decides which ones apply to a card.
 *
 * Four forms, each the quietest take of its kind — the contract's `coverForm`:
 *  - `volume` — a bound book: a hinge on the binding side.
 *  - `issue` — a saddle-stitched booklet (doujinshi, oneshots): a narrow fold and a band of gloss.
 *  - `scroll` — nothing bound (webtoons): even corners and a glass highlight, no spine.
 *  - `sheets` — loose pictures (CG sets): the front one with another sheet showing behind it.
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

/**
 * How much of the cover's width the spine-side treatment covers, as a fraction. Anything laid over
 * the cover on that side (badges, the library ribbon) starts past it rather than on the crease.
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

/** Where a CG set's front sheet sits in the cover box, as fractions: down from the top and in from the
 *  right, leaving the sheet behind it showing above and beside. About the same in points both ways
 *  on a 2:3 box. */
export const SHEET_OFFSET = { top: 0.04, right: 0.06 } as const;

/** A bound book's corner: Apple Books' own, measured on an iPhone at about 1.2 pt whatever the book's
 *  size. A rounder corner is the quickest way to make a book read as an app tile. (These were once
 *  fitted against the web build, whose squircle cuts far less than iOS's continuous corner, and came
 *  out two and a half times rounder on a device.) */
export const BOUND_CORNER = { phone: 1.5, desktop: 2 } as const;

/** Loose pages — a webtoon pane, a CG set's sheets — round further, as Apple Books rounds a square
 *  audiobook cover (about 3 pt) against its books. */
export const LOOSE_CORNER = { phone: 3, desktop: 5 } as const;

/**
 * One radius for all four corners. A book is squarer at the spine than at the fore-edge, but on iOS a
 * clipping view whose corners differ gets a mask layer instead of `cornerRadius`, and a mask is an
 * offscreen pass on every card in every frame of a scroll. The hinge already says which side is bound.
 */
export function bookRadius(cover: BookCover, desktop: boolean): number {
  const corner = cover.form === 'volume' || cover.form === 'issue' ? BOUND_CORNER : LOOSE_CORNER;
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
 * through grey.
 */
export const SPINE: Shade = {
  colors: [
    'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)',
    'rgba(0,0,0,0)', 'rgba(0,0,0,0.13)', 'rgba(0,0,0,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)',
  ],
  locations: [0, 0.01, 0.011, 0.011, 0.012, 0.016, 0.023, 0.026, 0.037, 0.048, 0.048, 0.054, 0.065, 0.988, 1],
};

/** A saddle-stitched issue: no board, so one crease where the staples are, inside 4% of the width,
 *  and the same lip at the fore-edge. */
export const FOLD: Shade = {
  colors: [
    'rgba(0,0,0,0.18)', 'rgba(0,0,0,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)',
    'rgba(0,0,0,0)', 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0)',
    'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)',
  ],
  locations: [0, 0.008, 0.008, 0.012, 0.02, 0.022, 0.028, 0.038, 0.988, 1],
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

/** The library ribbon: hangs from the head of the spine, just past the hinge. */
export function ribbonSize(desktop: boolean): { width: number; height: number } {
  return desktop ? { width: 11, height: 28 } : { width: 8, height: 20 };
}
