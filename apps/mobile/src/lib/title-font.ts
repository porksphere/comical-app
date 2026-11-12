import { useFonts } from 'expo-font';

/**
 * The headings' typeface: Shippori Antique B1, an "antique" face of the kind manga letters its
 * speech balloons in (SIL Open Font License; `assets/fonts/ShipporiAntiqueB1-OFL.txt`), cut down
 * to Latin — its kanji are megabytes the headings never use. Embedded by the expo-font plugin
 * (app.json) and loaded here too: on iOS loading registers it with the system, which is where the
 * navigation bar's own title finds a font by this name, PostScript and all.
 */
export const TITLE_FONT = 'ShipporiAntiqueB1-Regular';

/** The title typeface's name once it is ready, `undefined` until then (the system's face meanwhile). */
export function useTitleFont(): string | undefined {
  const [loaded] = useFonts({ [TITLE_FONT]: require('@/assets/fonts/ShipporiAntiqueB1-Regular.ttf') });
  return loaded ? TITLE_FONT : undefined;
}

/**
 * The home bookshelf's spines: Shippori Mincho B1 at its medium weight, the Japanese serif a
 * volume's spine is set in (SIL Open Font License; `assets/fonts/ShipporiMinchoB1-OFL.txt`), cut
 * to the same Latin as the title face. It was the tabs' title face before the antique one, and
 * read too serious there; down a spine it is what a book looks like. Its bolder weights were
 * more than a spine wants, and Dela Gothic One, a masthead's gothic, far more. Only the shelf
 * draws with it, into pictures of its own, so nothing registers it with the system.
 */
export const SPINE_FONT = 'ShipporiMinchoB1-Medium';

// What the cut-down files hold — keep in step with the subset it was cut to: printable ASCII,
// Latin-1, dashes, curly quotes and the ellipsis.
const COVERED = /^[ -~ -ÿ–—‘-‟…]*$/;

/** Whether the title typeface has every character of `text`; iOS fills a missing one from the
 *  system face, letter by letter, so a title it doesn't cover would be set in two typefaces. */
export function titleFontCovers(text: string): boolean {
  return COVERED.test(text);
}

/** The title typeface for a heading whose words aren't ours (a series' name, a bridge's section),
 *  `undefined` while it loads or when it can't set the whole text. */
export function useTitleFontFor(text: string): string | undefined {
  const font = useTitleFont();
  return font && titleFontCovers(text) ? font : undefined;
}

/** A face's vertical metrics, in ems: the hhea ascender and descender iOS lays a line out by, and
 *  the heights of a capital H and a lowercase x, measured from the files. */
export type FontMetrics = { ascender: number; descender: number; capHeight: number; xHeight: number };

const SYSTEM_METRICS: FontMetrics = { ascender: 0.952, descender: 0.241, capHeight: 0.705, xHeight: 0.53 };
const TITLE_METRICS: FontMetrics = { ascender: 1.16, descender: 0.288, capHeight: 0.733, xHeight: 0.524 };

/** The metrics of a face these hooks returned: the title typeface, else (`undefined`) the system's. */
export function fontMetrics(font: string | undefined): FontMetrics {
  return font === TITLE_FONT ? TITLE_METRICS : SYSTEM_METRICS;
}
