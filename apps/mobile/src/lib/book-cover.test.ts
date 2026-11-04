import { describe, expect, test } from 'bun:test';

import { BOOK_COVERS, BOUND_MAX_ASPECT, bookRadius, coverBinding, coverForm } from './book-cover';

describe('coverForm', () => {
  test('a book-shaped cover is a volume', () => {
    expect(coverForm({ aspect: 0.64, direct: false, vertical: false })).toBe('volume');
    expect(coverForm({ aspect: 0.75, direct: false, vertical: false })).toBe('volume');
  });
  test('a direct series is a stapled issue', () => {
    expect(coverForm({ aspect: 0.7, direct: true, vertical: false })).toBe('issue');
  });
  test('a series read vertically is unbound, whatever its cover', () => {
    expect(coverForm({ aspect: 0.64, direct: false, vertical: true })).toBe('scroll');
    expect(coverForm({ aspect: 0.7, direct: true, vertical: true })).toBe('scroll');
  });
  test('a bound form wider than a book drops its spine', () => {
    expect(coverForm({ aspect: BOUND_MAX_ASPECT, direct: false, vertical: false })).toBe('volume');
    expect(coverForm({ aspect: 1, direct: false, vertical: false })).toBe('scroll');
    expect(coverForm({ aspect: 1.41, direct: true, vertical: false })).toBe('scroll');
  });
});

describe('coverBinding', () => {
  test('follows the reading direction', () => {
    expect(coverBinding(true)).toBe('right');
    expect(coverBinding(false)).toBe('left');
  });
});

describe('BOOK_COVERS', () => {
  test('hands out one object per form and binding', () => {
    for (const form of ['volume', 'issue', 'scroll'] as const) {
      for (const binding of ['left', 'right'] as const) {
        expect(BOOK_COVERS[form][binding]).toEqual({ form, binding });
        expect(BOOK_COVERS[form][binding]).toBe(BOOK_COVERS[form][binding]);
      }
    }
  });
});

describe('bookRadius', () => {
  test('bound forms are squarer than the flat card; an unbound pane keeps the flat corner', () => {
    expect(bookRadius(BOOK_COVERS.volume.left, false)).toBeLessThan(10);
    expect(bookRadius(BOOK_COVERS.issue.left, false)).toBeLessThan(bookRadius(BOOK_COVERS.volume.left, false));
    expect(bookRadius(BOOK_COVERS.scroll.left, false)).toBe(10);
    expect(bookRadius(BOOK_COVERS.scroll.left, true)).toBe(20);
  });
  test('does not depend on the binding side', () => {
    expect(bookRadius(BOOK_COVERS.volume.right, false)).toBe(bookRadius(BOOK_COVERS.volume.left, false));
  });
});
