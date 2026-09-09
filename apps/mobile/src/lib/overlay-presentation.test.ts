import { describe, expect, test } from 'bun:test';

import { presentsAsPopover, topUsesWebOutsideClick } from './overlay-presentation';

describe('overlay presentation', () => {
  test('keeps an unanchored desktop overlay on the sheet backdrop path', () => {
    expect(topUsesWebOutsideClick([{}], true, true)).toBe(false);
  });

  test('uses document outside-click handling for an anchored desktop popover', () => {
    expect(topUsesWebOutsideClick([{ anchor: {} }], true, true)).toBe(true);
  });

  test('uses the top overlay presentation for a mixed stack', () => {
    expect(topUsesWebOutsideClick([{ anchor: {} }, {}], true, true)).toBe(false);
  });

  test('allows an explicitly forced anchored popover below the desktop breakpoint', () => {
    expect(presentsAsPopover({ anchor: {}, popover: true }, false)).toBe(true);
  });
});
