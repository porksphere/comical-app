import { describe, expect, test } from 'bun:test';

import { pullHoldTranslate } from './pull-hold';

// The gap the refresh spinner sits in, as a number — the iOS half of pull-to-refresh, where the
// content is held down by us rather than by a native `contentInset`. Worth pinning because the
// failure mode isn't a few pixels out: the version that added the whole of `scrollY` dragged the
// list off the bottom of the screen on any scroll while the spinner was up.

const HOLD = 64; // PULL_THRESHOLD — the resting hold in useNativePullToRefresh.

describe('pullHoldTranslate', () => {
  test('stays out of the way during the pull itself', () => {
    // Not holding: the native bounce owns the movement, and translating on top of it would double it.
    expect(pullHoldTranslate(false, 0, -80)).toBe(0);
    expect(pullHoldTranslate(false, 0, 0)).toBe(0);
    expect(pullHoldTranslate(false, 0, 300)).toBe(0);
  });

  test('cancels the recoil, so the content sits still as the bounce returns', () => {
    // Released at -80 and still fully overscrolled: the content is where the bounce put it.
    expect(pullHoldTranslate(true, 80, -80)).toBe(0);
    // Half way back, with holdOffset easing toward its rest — the translate takes up the slack.
    expect(pullHoldTranslate(true, 72, -40)).toBe(32);
    // Bounce done: the hold is the whole of it, and the gap is open.
    expect(pullHoldTranslate(true, HOLD, 0)).toBe(HOLD);
  });

  test('a scroll away from the top does NOT add itself to the hold', () => {
    // The bug: unclamped this was 64 + 300 = 364, which put the list a third of a screen further
    // down and showed bare background where it used to be.
    expect(pullHoldTranslate(true, HOLD, 300)).toBe(HOLD);
    expect(pullHoldTranslate(true, HOLD, 2000)).toBe(HOLD);
  });

  test('an overscroll back past the top still moves the content with the bounce', () => {
    // Pulling again mid-refresh is the one case that SHOULD reduce the hold — the bounce is already
    // moving the content down, so the translate gives that distance back.
    expect(pullHoldTranslate(true, HOLD, -20)).toBe(44);
    expect(pullHoldTranslate(true, HOLD, -HOLD)).toBe(0);
  });

  test('releases to nothing as the hold springs back', () => {
    expect(pullHoldTranslate(true, 0, 0)).toBe(0);
    expect(pullHoldTranslate(true, 0, 500)).toBe(0);
  });
});
