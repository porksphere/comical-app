import { describe, expect, test } from 'bun:test';

import { navModeFor, RegularWidthBreakpoint, SidebarBreakpoint, sizeClassFor } from './size-class';

describe('sizeClassFor', () => {
  test('a phone and the Duo outer display are compact', () => {
    expect(sizeClassFor(390)).toBe('compact');
    expect(sizeClassFor(678)).toBe('compact'); // iPhone Duo, closed (landscape-ish outer display)
    expect(sizeClassFor(RegularWidthBreakpoint - 1)).toBe('compact');
  });

  test('the Duo inner display, a Fold inner panel and a tablet are regular', () => {
    expect(sizeClassFor(RegularWidthBreakpoint)).toBe('regular');
    expect(sizeClassFor(816)).toBe('regular'); // Galaxy Z Fold 8 inner, 2448px @ 3x
    expect(sizeClassFor(890)).toBe('regular'); // iPhone Duo inner, 2670px @ 3x
    expect(sizeClassFor(1024)).toBe('regular');
  });

  test('a Duo split-view half falls back to compact', () => {
    expect(sizeClassFor(890 / 2)).toBe('compact');
  });
});

describe('navModeFor', () => {
  test('compact widths get the bottom bar on every platform', () => {
    expect(navModeFor(390, false)).toBe('bar');
    expect(navModeFor(390, true)).toBe('bar');
    expect(navModeFor(678, false)).toBe('bar');
  });

  test('a regular width below the sidebar breakpoint gets the forced-collapsed rail on native only', () => {
    expect(navModeFor(816, false)).toBe('rail');
    expect(navModeFor(890, false)).toBe('rail');
    expect(navModeFor(SidebarBreakpoint - 1, false)).toBe('rail');
    expect(navModeFor(816, true)).toBe('bar');
  });

  test('the labelled sidebar from its breakpoint up, everywhere', () => {
    expect(navModeFor(SidebarBreakpoint, false)).toBe('sidebar');
    expect(navModeFor(SidebarBreakpoint, true)).toBe('sidebar');
    expect(navModeFor(1440, true)).toBe('sidebar');
  });
});
