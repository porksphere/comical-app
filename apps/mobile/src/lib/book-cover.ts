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
export const SPINE_FRACTION: Record<CoverForm, number> = { volume: 0.1, issue: 0.05, scroll: 0, sheets: 0 };

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

/** A bound book's corner, fitted to Apple Books' book covers: about 3.5% of the cover's width drawn as
 *  a squircle, which is a phone card at 4 pt and the middle of the desktop's widths at 8. */
export const BOUND_CORNER = { phone: 4, desktop: 8 } as const;

/** Loose pages — a webtoon pane, a CG set's sheets — round further, as Apple Books rounds a square
 *  audiobook cover against its books: fitted to that cover, which is still squarer than a flat card. */
export const LOOSE_CORNER = { phone: 7, desktop: 14 } as const;

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
 * The spine-side shading, read from the spine inward: a faint shade at the binding edge, a soft
 * highlight where the board folds, then a gentle crease. Kept soft on purpose: at card size a crisp
 * dark band or bright line reads as a second edge — dark on a light cover, gone on a dark one — so the
 * same 3 pt gap between cards looks a different width beside every cover, and a cover still loading
 * looks like an empty frame.
 */
export const HINGE: Shade = {
  colors: ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.07)', 'rgba(0,0,0,0)'],
  locations: [0, 0.04, 0.06, 0.09, 0.105, 0.16],
};

/** A saddle-stitched issue's fold: the hinge's shape at about half the width, since there is no board. */
export const FOLD: Shade = {
  colors: ['rgba(0,0,0,0.08)', 'rgba(0,0,0,0)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0)'],
  locations: [0, 0.025, 0.035, 0.05, 0.06, 0.09],
};

/** The diagonal band of gloss a thin issue's cover stock catches. */
export const GLOSS: Shade = {
  colors: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0)'],
  locations: [0.36, 0.46, 0.57],
};

/** An unbound pane's light: bright along the top edge, a little shade at the foot. Read top to bottom. */
export const PANE: Shade = {
  colors: ['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.12)'],
  locations: [0, 0.2, 0.78, 1],
};

/**
 * The shadow under a cover, as a gradient strip in the gap above the title rather than a `boxShadow`.
 * It only ever falls straight down — a virtualized list paint-contains each item to its slot, so any
 * sideways reach is cut off at the grid's edges — and a shadow that only falls down IS a gradient.
 * A `boxShadow` would blur for it: a masked shadow layer per card on iOS, a `BlurMaskFilter` paint on
 * Android, both rebuilt whenever a recycled card's size changes.
 */
export const SHADOW: Shade = {
  colors: ['rgba(18,22,30,0.24)', 'rgba(18,22,30,0.08)', 'rgba(18,22,30,0)'],
  locations: [0, 0.35, 1],
};
export const SHADOW_DEPTH = 5;

/** The library ribbon: hangs from the head of the spine, just past the hinge. */
export function ribbonSize(desktop: boolean): { width: number; height: number } {
  return desktop ? { width: 11, height: 28 } : { width: 8, height: 20 };
}
