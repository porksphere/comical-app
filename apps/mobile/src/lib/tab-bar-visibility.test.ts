import { beforeEach, describe, expect, test } from 'bun:test';

import { isTabBarPinned, pinTabBar, subscribeTabBarPinned } from './tab-bar-visibility';

// Module-level state shared by the whole app (there is one bar), so each test starts unpinned rather
// than from whatever the previous one left behind. What the pin DOES to the bar's position is
// asserted at the two subscribers (`tab-bar-slide` for the native slide, `app-tabs` for the web
// fade); this file covers the bookkeeping they hang off, which is the part with the edge cases.
let release: (() => void) | null = null;
beforeEach(() => {
  release?.();
  release = null;
});

describe('pinTabBar', () => {
  test('holds while anything holds it, and releases once nothing does', () => {
    release = pinTabBar();
    expect(isTabBarPinned()).toBe(true);
    release();
    release = null;
    expect(isTabBarPinned()).toBe(false);
  });

  // Focus and blur overlap across a navigation — the incoming screen takes its pin before the
  // outgoing one drops its own — so a plain boolean would come out of a settings→settings push
  // unpinned.
  test('stays pinned through an overlapping hand-off', () => {
    const outgoing = pinTabBar();
    release = pinTabBar();
    outgoing();
    expect(isTabBarPinned()).toBe(true);
  });

  test('a release called twice drops only its own pin', () => {
    const first = pinTabBar();
    release = pinTabBar();
    first();
    first();
    expect(isTabBarPinned()).toBe(true);
  });

  test('announces only the edges, so subscribers act on the transition', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeTabBarPinned((pinned) => seen.push(pinned));
    const first = pinTabBar();
    const second = pinTabBar();
    first();
    expect(seen).toEqual([true]); // still pinned by `second` — nothing to announce yet
    second();
    expect(seen).toEqual([true, false]);
    unsubscribe();
  });
});
