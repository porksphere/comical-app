/**
 * Book covers: a series card drawn as the object it is rather than as a flat tile. Pure geometry and
 * decisions only — no react-native imports — so the rules can be tested; `components/book-chrome.tsx`
 * draws them and `hooks/use-book-covers.ts` decides which ones apply to a card.
 *
 * Three forms, each the quietest take of its kind:
 *  - `volume` — a bound book: a hinge on the binding side.
 *  - `issue` — a saddle-stitched booklet (direct/gallery series): a narrow fold and a band of gloss.
 *  - `scroll` — nothing bound (webtoons): even corners and a glass highlight, no spine.
 */

export type CoverForm = 'volume' | 'issue' | 'scroll';
export type CoverBinding = 'left' | 'right';
export type BookCover = { form: CoverForm; binding: CoverBinding };

/**
 * A bound form on a cover wider than this is drawn unbound. A hinge on a square reads as a board book,
 * and the survey behind this found nothing that wide on a bound form that was a real book's shape:
 * square crops, single wide illustrations and front-and-back scans, which shape alone can't tell
 * apart — so the whole picture is kept and only the spine goes.
 */
export const BOUND_MAX_ASPECT = 0.8;

export function coverForm({ aspect, direct, vertical }: { aspect: number; direct: boolean; vertical: boolean }): CoverForm {
  if (vertical) return 'scroll';
  if (aspect > BOUND_MAX_ASPECT) return 'scroll';
  return direct ? 'issue' : 'volume';
}

/** Right-to-left reading binds on the right, the way a tankōbon is. */
export function coverBinding(rightToLeft: boolean): CoverBinding {
  return rightToLeft ? 'right' : 'left';
}

/**
 * How much of the cover's width the spine-side treatment covers, as a fraction. Anything laid over
 * the cover on that side (badges, the library ribbon) starts past it rather than on the crease.
 */
export const SPINE_FRACTION: Record<CoverForm, number> = { volume: 0.08, issue: 0.042, scroll: 0 };

/** One object per form and binding, so a card's `book` prop is the same object from render to render
 *  and nothing below it re-renders for a new-but-equal value while a list recycles. */
export const BOOK_COVERS: Readonly<Record<CoverForm, Readonly<Record<CoverBinding, BookCover>>>> = {
  volume: { left: { form: 'volume', binding: 'left' }, right: { form: 'volume', binding: 'right' } },
  issue: { left: { form: 'issue', binding: 'left' }, right: { form: 'issue', binding: 'right' } },
  scroll: { left: { form: 'scroll', binding: 'left' }, right: { form: 'scroll', binding: 'right' } },
};

/** The card's ordinary corner (`coverStyles.corner` / `cornerDesktop`), which an unbound pane keeps. */
export const FLAT_CORNER = { phone: 10, desktop: 20 } as const;

/**
 * One radius for all four corners. A book is squarer at the spine than at the fore-edge, but on iOS a
 * clipping view whose corners differ gets a mask layer instead of `cornerRadius`, and a mask is an
 * offscreen pass on every card in every frame of a scroll. The hinge already says which side is bound.
 */
export function bookRadius(cover: BookCover, desktop: boolean): number {
  if (cover.form === 'scroll') return desktop ? FLAT_CORNER.desktop : FLAT_CORNER.phone;
  if (cover.form === 'issue') return desktop ? 2.5 : 1.5;
  return desktop ? 6 : 3;
}

export type Shade = { colors: readonly [string, string, ...string[]]; locations: readonly [number, number, ...number[]] };

/**
 * The spine-side shading, read from the spine inward: a dark band at the binding edge, a highlight
 * where the board folds, then a soft crease. About a tenth of the width; this is the detail that
 * makes the tile a book.
 */
export const HINGE: Shade = {
  colors: ['rgba(0,0,0,0.34)', 'rgba(0,0,0,0.12)', 'rgba(255,255,255,0.30)', 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.20)', 'rgba(0,0,0,0.06)', 'rgba(0,0,0,0)'],
  locations: [0, 0.018, 0.03, 0.044, 0.052, 0.076, 0.11],
};

/** A saddle-stitched issue's fold: the hinge's shape at half the width, since there is no board. */
export const FOLD: Shade = {
  colors: ['rgba(0,0,0,0.26)', 'rgba(255,255,255,0.34)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0)'],
  locations: [0, 0.012, 0.024, 0.046],
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
