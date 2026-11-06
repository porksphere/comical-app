import { describe, expect, test } from 'bun:test';

import { BOOK_COVERS, BOUND_CORNER, BOUND_MAX_ASPECT, LOOSE_CORNER, PRINT, PRINT_CORNER, bookRadius, printWindow, resolveCover, shuffledHints } from './book-cover';

const GUESS = { readsVertically: false, readerRightToLeft: false, direct: false, aspect: 0.7 };

describe('resolveCover — what the app guesses when the bridge says nothing', () => {
  test('a book-shaped cover is a volume, bound on the side the reader reads from', () => {
    expect(resolveCover(GUESS)).toBe(BOOK_COVERS.volume.left);
    expect(resolveCover({ ...GUESS, readerRightToLeft: true })).toBe(BOOK_COVERS.volume.right);
  });
  test('a direct series is a stapled issue', () => {
    expect(resolveCover({ ...GUESS, direct: true })).toBe(BOOK_COVERS.issue.left);
  });
  test('a series read vertically is unbound, whatever its cover', () => {
    expect(resolveCover({ ...GUESS, readsVertically: true }).form).toBe('scroll');
    expect(resolveCover({ ...GUESS, readsVertically: true, direct: true }).form).toBe('scroll');
  });
  test('a bound form wider than a book drops its spine', () => {
    expect(resolveCover({ ...GUESS, aspect: BOUND_MAX_ASPECT }).form).toBe('volume');
    expect(resolveCover({ ...GUESS, aspect: 1 }).form).toBe('scroll');
    expect(resolveCover({ ...GUESS, aspect: 1.41, direct: true }).form).toBe('scroll');
  });
});

describe('resolveCover — what the bridge says wins', () => {
  test('a declared form beats every guess', () => {
    expect(resolveCover({ ...GUESS, form: 'sheets', direct: true }).form).toBe('sheets');
    expect(resolveCover({ ...GUESS, form: 'volume', readsVertically: true }).form).toBe('volume');
    expect(resolveCover({ ...GUESS, form: 'scroll' }).form).toBe('scroll');
  });
  test('loose sheets keep their form at any shape', () => {
    expect(resolveCover({ ...GUESS, form: 'sheets', aspect: 1.5 }).form).toBe('sheets');
  });
  test('a declared bound form still drops its spine on a wide cover', () => {
    expect(resolveCover({ ...GUESS, form: 'issue', aspect: 1.4 }).form).toBe('scroll');
  });
  test('a declared direction sets the binding over the reader setting', () => {
    expect(resolveCover({ ...GUESS, direction: 'rtl' }).binding).toBe('right');
    expect(resolveCover({ ...GUESS, direction: 'ltr', readerRightToLeft: true }).binding).toBe('left');
  });
  test('a declared vertical direction unbinds the cover, and a declared paged one keeps it bound', () => {
    expect(resolveCover({ ...GUESS, direction: 'vertical' }).form).toBe('scroll');
    expect(resolveCover({ ...GUESS, direction: 'rtl', readsVertically: true }).form).toBe('volume');
  });
});

describe('BOOK_COVERS', () => {
  test('hands out one object per form and binding', () => {
    for (const form of ['volume', 'issue', 'scroll', 'sheets'] as const) {
      for (const binding of ['left', 'right'] as const) {
        expect(BOOK_COVERS[form][binding]).toEqual({ form, binding });
      }
    }
  });
});

describe('bookRadius', () => {
  test('bound books take the book corner; loose pages round further', () => {
    for (const form of ['volume', 'issue'] as const) {
      expect(bookRadius(BOOK_COVERS[form].left, false)).toBe(BOUND_CORNER.phone);
      expect(bookRadius(BOOK_COVERS[form].left, true)).toBe(BOUND_CORNER.desktop);
    }
    expect(bookRadius(BOOK_COVERS.scroll.left, false)).toBe(LOOSE_CORNER.phone);
    expect(bookRadius(BOOK_COVERS.scroll.left, true)).toBe(LOOSE_CORNER.desktop);
    expect(bookRadius(BOOK_COVERS.sheets.left, false)).toBe(PRINT_CORNER.phone);
    expect(bookRadius(BOOK_COVERS.sheets.left, true)).toBe(PRINT_CORNER.desktop);
    expect(BOUND_CORNER.phone).toBeLessThan(LOOSE_CORNER.phone);
  });
  test('does not depend on the binding side', () => {
    expect(bookRadius(BOOK_COVERS.volume.right, false)).toBe(bookRadius(BOOK_COVERS.volume.left, false));
  });
});

describe('shuffledHints', () => {
  test('is the same for a series every time', () => {
    expect(shuffledHints('mangadex:abc')).toEqual(shuffledHints('mangadex:abc'));
  });
  test('reaches every form and both bindings across a shelf of series', () => {
    const picks = Array.from({ length: 200 }, (_, i) => shuffledHints(`bridge:${i}`));
    expect(new Set(picks.map((p) => p.form))).toEqual(new Set(['volume', 'issue', 'scroll', 'sheets']));
    expect(new Set(picks.map((p) => p.direction))).toEqual(new Set(['ltr', 'rtl']));
  });
});

describe('printWindow', () => {
  test('leaves a border the same width on every side, at any cover shape', () => {
    for (const aspect of [2 / 3, 0.7, 1, 1.5]) {
      const w = printWindow(aspect);
      // In card widths: the print is PRINT.width wide and PRINT.height / aspect tall.
      const printW = PRINT.width;
      const printH = PRINT.height / aspect;
      expect(w.left * printW).toBeCloseTo(w.top * printH, 10);
      expect(w.right * printW).toBeCloseTo(w.bottom * printH, 10);
    }
  });
});
