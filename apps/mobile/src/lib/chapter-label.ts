/**
 * A chapter name cut to what a one-line button can carry. "Chapter 176 — The Coast Road" is the
 * name a bridge gives; "Resume Chapter 176 — The Coast Road" in a column 40% of a phone's width
 * was clipped from the right, so the part that survived named the wrong chapter. The NUMBER is the
 * part a reader recognises, so a name that leads with one is reduced to it; a name that doesn't
 * ("Prologue", "The Coast Road") is left whole and ellipsizes as before.
 */
const LEADING_NUMBER = /^\s*(?:(?:chapter|chap|ch|episode|ep|vol\.?\s*\d+\s*(?:ch|chapter))\.?\s*)?#?(\d+(?:\.\d+)?)\b/i;

export function shortChapterName(name: string): string {
  const m = LEADING_NUMBER.exec(name);
  if (!m) return name.trim();
  const prefix = /^\s*(?:episode|ep)\b/i.test(name) ? 'Ep.' : 'Ch.';
  return `${prefix} ${m[1]}`;
}
