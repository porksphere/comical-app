// Whether a series is a webtoon, told from nothing but the shapes of the pages it has shown.
//
// Sources rarely say (`series.type` is free text where it exists at all), and the reader has no
// pixels on native — but it does learn every page's real dimensions as it loads them, and a strip
// of panels is a shape no page has. The scoring follows Kavita's: tall counts for, page-shaped
// counts against, and the whole only passes when strips make up most of what was seen or the
// average shape is itself a strip, so a chapter with one tall credits page stays a chapter.

import type { Size } from '@/components/reader/page-geometry';

/** Fewest page shapes a verdict needs — fewer, and a cover plus a strip could decide a series. */
export const DETECT_MIN_PAGES = 3;
/** Shapes seen without a webtoon verdict before a series is left as it is for the session. */
export const DETECT_MAX_PAGES = 6;

const STRONG_ASPECT = 2.2;
const LIKELY_ASPECT = 1.8;
const WEAK_ASPECT = 1.5;
const PAGE_ASPECT = 1.2;

function pageScore({ width, height }: Size): number {
  const aspect = height / width;
  let score = 0;
  if (aspect >= STRONG_ASPECT) score += 1;
  else if (aspect >= LIKELY_ASPECT) score += 0.5;
  else if (aspect >= WEAK_ASPECT) score += 0.2;
  else if (aspect < PAGE_ASPECT) score -= 0.5;
  if (height > 2000) score += 0.5;
  else if (height > 1500) score += 0.3;
  return score;
}

/** True when these pages, in aggregate, are a strip rather than a book. Never true for fewer than
 *  `DETECT_MIN_PAGES`. */
export function looksLikeWebtoon(sizes: readonly Size[]): boolean {
  const pages = sizes.filter((s) => s.width > 0 && s.height > 0);
  if (pages.length < DETECT_MIN_PAGES) return false;
  const n = pages.length;
  const score = pages.reduce((sum, s) => sum + pageScore(s), 0) / n;
  const strong = pages.filter((s) => s.height / s.width >= STRONG_ASPECT).length / n;
  const aspect = pages.reduce((sum, s) => sum + s.height / s.width, 0) / n;
  return score >= 0.7 && (strong >= 0.4 || aspect >= 2.0);
}
