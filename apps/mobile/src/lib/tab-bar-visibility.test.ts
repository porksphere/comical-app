import { beforeEach, describe, expect, test } from 'bun:test';

import {
  getTabBarProgress,
  isTabBarPinned,
  pinTabBar,
  setTabBarProgress,
  subscribeTabBarPinned,
} from './tab-bar-visibility';

// Module-level state shared by the whole app (there is one bar), so each test starts from shown and
// unpinned rather than from whatever the previous one left behind.
let release: (() => void) | null = null;
beforeEach(() => {
  release?.();
  release = null;
  setTabBarProgress(0);
});

describe('pinTabBar', () => {
  test('reveals the bar and holds it there against anything reported meanwhile', () => {
    setTabBarProgress(1);
    release = pinTabBar();
    expect(getTabBarProgress()).toBe(0);
    // A screen that keeps reporting (or a settle still landing) can't move it while pinned.
    setTabBarProgress(0.6);
    expect(getTabBarProgress()).toBe(0);
  });

  test('lets the bar move again once released', () => {
    const unpin = pinTabBar();
    unpin();
    expect(isTabBarPinned()).toBe(false);
    setTabBarProgress(0.6);
    expect(getTabBarProgress()).toBe(0.6);
  });

  // Focus and blur overlap across a navigation — the incoming screen takes its pin before the
  // outgoing one drops its own — so a plain boolean would come out of a settings→settings push
  // unpinned.
  test('stays pinned through an overlapping hand-off', () => {
    const outgoing = pinTabBar();
    release = pinTabBar();
    outgoing();
    expect(isTabBarPinned()).toBe(true);
    setTabBarProgress(1);
    expect(getTabBarProgress()).toBe(0);
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
