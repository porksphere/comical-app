import { describe, expect, test } from 'bun:test';

import {
  overlayPresentation,
  presentsAsDialog,
  presentsAsPopover,
  topUsesWebOutsideClick,
} from './overlay-presentation';

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

  test('presents an explicit dialog as a centered surface on desktop web', () => {
    expect(overlayPresentation({ dialog: true }, true, true)).toBe('dialog');
    expect(presentsAsDialog({ dialog: true }, true, true)).toBe(true);
  });

  test('keeps dialog content in a sheet on compact web and native', () => {
    expect(overlayPresentation({ dialog: true }, false, true)).toBe('sheet');
    expect(overlayPresentation({ dialog: true }, true, false)).toBe('sheet');
  });

  test('does not treat a desktop dialog as a popover outside-click target', () => {
    expect(topUsesWebOutsideClick([{ dialog: true }], true, true)).toBe(false);
  });
});
