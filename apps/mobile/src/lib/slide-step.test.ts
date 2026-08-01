import { describe, expect, test } from 'bun:test';

import { COMMIT_DISTANCE, dismissTarget, settleStep, slideStep } from './slide-step';

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

  // The bar can't have travelled further from its resting place than the content has, so within the
  // first `span` px of scroll it is tied to the content and arrives fully shown exactly at 0. Before
  // this, commit-on-release could park a bar fully hidden a few px down the list (an unearned reveal
  // snaps it back there) and crossing the top guard then flung it open in a single frame.
  test('is never hidden further than the content has scrolled', () => {
    expect(slideStep(SPAN, 20, 40, 0, SPAN)).toBe(20);
    expect(slideStep(SPAN, 1, 2, 0, SPAN)).toBe(1);
    // Past the span the ceiling stops binding and normal accumulation takes over.
    expect(slideStep(40, 130, 120, 0, SPAN)).toBe(50);
  });

  test('the ceiling also applies to a step the guards rejected', () => {
    // A reposition landing near the top must not leave the bar parked off-screen up there.
    expect(slideStep(SPAN, 30, 800, 0, SPAN)).toBe(30);
    // ...but a rejected step further down still just holds still.
    expect(slideStep(60, 800, 400, 0, SPAN)).toBe(60);
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
    // ...and the same in reverse, so a jump back up can't fake a reveal either. Landing well clear
    // of the top: a jump that ends up NEAR it legitimately shows the bar (see the hide ceiling).
    expect(slideStep(SPAN, 300, 1080, 0, SPAN)).toBe(SPAN);
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
  test('slides 1:1 in both directions, exactly like slideStep', () => {
    expect(settleStep(0, 0, 30, 0, 0, SPAN).hidden).toBe(30);
    expect(settleStep(30, 0, 70, 30, 0, SPAN).hidden).toBe(70);
    expect(settleStep(70, 0, 40, 70, 0, SPAN).hidden).toBe(40);
  });

  test('upward scroll earns reveal credit, capped at the commit distance', () => {
    expect(settleStep(SPAN, 0, 180, 200, 0, SPAN).up).toBe(20);
    expect(settleStep(80, 20, 150, 180, 0, SPAN).up).toBe(50);
    // Capped: once it's committed, more of the same gesture changes nothing.
    expect(settleStep(50, 50, 0, 150, 0, SPAN, -1).up).toBe(COMMIT_DISTANCE);
  });

  test('any downward scroll spends the credit back to nothing', () => {
    expect(settleStep(0, COMMIT_DISTANCE, 1, 0, 0, SPAN).up).toBe(0);
    expect(settleStep(0, COMMIT_DISTANCE - 1, 40, 0, 0, SPAN).up).toBe(0);
  });

  test('at the top the credit saturates — a pinned bar has nothing left to earn', () => {
    expect(settleStep(SPAN, 0, 4, 400, 0, SPAN, 8)).toEqual({ hidden: 0, up: COMMIT_DISTANCE });
    // Even coming DOWN into the top guard, where the raw step would have spent it.
    expect(settleStep(0, 10, 6, 2, 0, SPAN, 8)).toEqual({ hidden: 0, up: COMMIT_DISTANCE });
  });

  test('a guard-rejected step moves neither the bar nor the credit', () => {
    // Elastic bottom bounce, in both directions.
    expect(settleStep(SPAN, 10, 520, 560, 500, SPAN)).toEqual({ hidden: SPAN, up: 10 });
    expect(settleStep(0, 10, 560, 520, 500, SPAN)).toEqual({ hidden: 0, up: 10 });
    // A reposition-sized jump, likewise.
    expect(settleStep(0, 10, 780, 0, 0, SPAN)).toEqual({ hidden: 0, up: 10 });
    expect(settleStep(0, 10, 0, 780, 0, SPAN, -1)).toEqual({ hidden: 0, up: 10 });
  });

  test('carries the hide ceiling through, so a reveal near the top is gradual not a pop', () => {
    // 5px up from y=25 with the bar fully hidden: the ceiling has it at 25, so it moves to 20 —
    // where the hard top-guard snap used to jump it the whole way to 0.
    expect(settleStep(SPAN, 0, 20, 25, 0, SPAN, 8).hidden).toBe(20);
    expect(settleStep(20, 5, 12, 20, 0, SPAN, 8).hidden).toBe(12);
  });

  // What the caller does with the credit: `up >= COMMIT_DISTANCE` ⇒ settle fully shown, else fully
  // hidden. Both bars use the SAME threshold despite different spans, so they agree about a flick.
  test('a flick shorter than the commit distance leaves the reveal unearned', () => {
    let s = { hidden: SPAN, up: 0 };
    for (let y = 400; y > 400 - (COMMIT_DISTANCE - 8); y -= 8) {
      s = settleStep(s.hidden, s.up, y - 8, y, 0, SPAN);
    }
    expect(s.hidden).toBeLessThan(SPAN); // it did move, 1:1, the whole way
    expect(s.up).toBeLessThan(COMMIT_DISTANCE); // ...but never earned the lock-in
  });
});

describe('dismissTarget', () => {
  test('commits to fully hidden once the content has scrolled past the bar', () => {
    expect(dismissTarget(SPAN, SPAN)).toBe(SPAN);
    expect(dismissTarget(400, SPAN)).toBe(SPAN);
  });

  // The bug: nearer the top than its own height, a bar has no room to hide, and settling to the
  // ceiling left it parked half-way — a small scroll down from the top did this every time.
  test('sends the bar back rather than parking it half-way near the top', () => {
    expect(dismissTarget(20, SPAN)).toBe(0);
    expect(dismissTarget(SPAN - 1, SPAN)).toBe(0);
    expect(dismissTarget(0, SPAN)).toBe(0);
  });

  test('only decides the resting place — tracking under the finger still moves 1:1', () => {
    // Same 20px offset: the bar has genuinely slid 20px while the finger is down...
    expect(slideStep(0, 20, 0, 0, SPAN)).toBe(20);
    // ...and on release goes back to shown, since 20px of content can't hide a 100px bar.
    expect(dismissTarget(20, SPAN)).toBe(0);
  });
});
