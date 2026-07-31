import { describe, expect, test } from 'bun:test';

import { settleStep, slideStep } from './slide-step';

// The bar spans ~82px (its measured height) on a real device; use a round 100 here.
const SPAN = 100;

describe('slideStep', () => {
  test('accumulates downward scroll 1:1, clamped to the span', () => {
    expect(slideStep(0, 30, 0, 0, SPAN)).toBe(30);
    expect(slideStep(30, 70, 30, 0, SPAN)).toBe(70);
    // Past the span it parks fully hidden rather than overshooting.
    expect(slideStep(70, 200, 70, 0, SPAN)).toBe(SPAN);
  });

  test('reveals 1:1 on upward scroll', () => {
    expect(slideStep(SPAN, 160, 200, 0, SPAN)).toBe(60);
    expect(slideStep(60, 130, 160, 0, SPAN)).toBe(30);
    expect(slideStep(30, 20, 130, 0, SPAN)).toBe(0);
  });

  test('snaps fully shown at or above the top guard', () => {
    expect(slideStep(SPAN, 8, 400, 0, SPAN, 8)).toBe(0);
    // A pull-to-refresh overscroll reports negative offsets.
    expect(slideStep(SPAN, -40, 0, 0, SPAN, 8)).toBe(0);
  });

  test('holds still through the elastic bottom bounce', () => {
    // maxScrollY = 500: springing back from 560 -> 520 is not a real scroll-up.
    expect(slideStep(SPAN, 520, 560, 500, SPAN)).toBe(SPAN);
    // Unmeasured maxScrollY skips the guard entirely.
    expect(slideStep(SPAN, 520, 560, 0, SPAN)).toBe(60);
  });

  // The regression this guard exists for: a list that lands mid-content on a fresh mount (or a
  // `scrollY` zeroed by useSlidingBar's scope reset while the list sits elsewhere) reports one
  // enormous step that is a reposition, not a gesture. Accumulating it hid both bars for good.
  test('ignores a reposition-sized jump instead of accumulating it', () => {
    expect(slideStep(0, 780, 0, 0, SPAN)).toBe(0);
    // ...and the same in reverse, so a jump back up can't fake a reveal either.
    expect(slideStep(SPAN, 0, 780, 0, SPAN, -1)).toBe(SPAN);
  });

  test('still tracks the frame after a jump, measured from where the list landed', () => {
    expect(slideStep(0, 780, 0, 0, SPAN)).toBe(0);
    expect(slideStep(0, 820, 780, 0, SPAN)).toBe(40);
  });

  test('a hard fling stays under the jump threshold', () => {
    // ~130px/frame is about as fast as a 60Hz fling reports.
    expect(slideStep(0, 130, 0, 0, SPAN)).toBe(100);
  });
});

describe('settleStep', () => {
  test('a fully-shown bar only MARKS the hide — it does not move under the finger', () => {
    expect(settleStep(0, false, 30, 0, 0, SPAN)).toEqual({ hidden: 0, pending: true });
    // ...however far the scroll goes; the caller slides it away on release.
    expect(settleStep(0, true, 130, 30, 0, SPAN)).toEqual({ hidden: 0, pending: true });
  });

  test('reveals 1:1 on upward scroll and drops the pending hide', () => {
    expect(settleStep(SPAN, true, 160, 200, 0, SPAN)).toEqual({ hidden: 60, pending: false });
    expect(settleStep(60, false, 130, 160, 0, SPAN)).toEqual({ hidden: 30, pending: false });
  });

  test('an upward step against an already-shown bar still clears the mark', () => {
    // Nothing to reveal (hidden is already 0), but the user is asking for the chrome, so the hide
    // marked earlier in the same gesture is off.
    expect(settleStep(0, true, 120, 140, 0, SPAN)).toEqual({ hidden: 0, pending: false });
  });

  test('a part-way reveal gives its ground back 1:1 — it was never committed either', () => {
    expect(settleStep(40, false, 220, 200, 0, SPAN)).toEqual({ hidden: 60, pending: true });
  });

  test('snaps fully shown at the top, with nothing left to commit', () => {
    expect(settleStep(SPAN, true, 4, 400, 0, SPAN, 8)).toEqual({ hidden: 0, pending: false });
    expect(settleStep(0, true, 4, 6, 0, SPAN, 8)).toEqual({ hidden: 0, pending: false });
  });

  test('a guard-rejected step leaves the mark exactly as it was', () => {
    // Elastic bottom bounce, in both directions: no movement, no change of intent.
    expect(settleStep(SPAN, true, 520, 560, 500, SPAN)).toEqual({ hidden: SPAN, pending: true });
    expect(settleStep(0, true, 560, 520, 500, SPAN)).toEqual({ hidden: 0, pending: true });
    // A reposition-sized jump, likewise.
    expect(settleStep(0, false, 780, 0, 0, SPAN)).toEqual({ hidden: 0, pending: false });
    expect(settleStep(0, true, 0, 780, 0, SPAN, -1)).toEqual({ hidden: 0, pending: true });
  });
});
