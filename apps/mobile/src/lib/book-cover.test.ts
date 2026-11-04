import { describe, expect, test } from 'bun:test';

import { BOUND_MAX_ASPECT, bookCorners, bookZoomRadius, coverBinding, coverForm } from './book-cover';

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

describe('bookCorners', () => {
  test('a volume is square at the spine and rounded at the fore-edge', () => {
    const left = bookCorners({ form: 'volume', binding: 'left' }, false);
    expect(left.borderTopLeftRadius).toBeLessThan(left.borderTopRightRadius);
    expect(left.borderBottomLeftRadius).toBe(left.borderTopLeftRadius);
    expect(left.borderBottomRightRadius).toBe(left.borderTopRightRadius);
  });
  test('binding on the right mirrors the corners', () => {
    const left = bookCorners({ form: 'volume', binding: 'left' }, false);
    const right = bookCorners({ form: 'volume', binding: 'right' }, false);
    expect(right.borderTopLeftRadius).toBe(left.borderTopRightRadius);
    expect(right.borderTopRightRadius).toBe(left.borderTopLeftRadius);
  });
  test('an unbound pane keeps the flat card corner all round', () => {
    const c = bookCorners({ form: 'scroll', binding: 'left' }, false);
    expect(new Set(Object.values(c))).toEqual(new Set([10]));
  });
  test('a zoom starts from the fore-edge radius', () => {
    expect(bookZoomRadius({ form: 'volume', binding: 'right' })).toBe(4);
    expect(bookZoomRadius({ form: 'scroll', binding: 'left' })).toBe(10);
  });
});
