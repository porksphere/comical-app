import { describe, expect, test } from 'bun:test';

import {
  dismissTarget,
  dismissThreshold,
  DISMISS_DISTANCE,
  hideCeiling,
  MAX_SCROLL_UNMEASURED,
  settleScrollDelta,
  settleTarget,
  slideStep,
} from './slide-step';

// The bar spans ~82px (its measured height) on a real device; use a round 100 here.
const SPAN = 100;
// Most cases here aren't about the bottom-bounce guard, so they pass "not measured yet" — the value
// that leaves it disarmed. A measured 0 is the opposite (see the stretch tests below).
const UNMEASURED = MAX_SCROLL_UNMEASURED;

describe('slideStep', () => {
  test('accumulates downward scroll 1:1, clamped to the span', () => {
    expect(slideStep(0, 30, 0, UNMEASURED, SPAN)).toBe(30);
    expect(slideStep(30, 70, 30, UNMEASURED, SPAN)).toBe(70);
    // Past the span it parks fully hidden rather than overshooting.
    expect(slideStep(70, 200, 70, UNMEASURED, SPAN)).toBe(SPAN);
  });

  test('reveals 1:1 on upward scroll', () => {
    expect(slideStep(SPAN, 160, 200, UNMEASURED, SPAN)).toBe(60);
    expect(slideStep(60, 130, 160, UNMEASURED, SPAN)).toBe(30);
    expect(slideStep(30, 20, 130, UNMEASURED, SPAN)).toBe(0);
  });

  test('snaps fully shown at or above the top guard', () => {
    expect(slideStep(SPAN, 8, 400, UNMEASURED, SPAN, 8)).toBe(0);
    // A pull-to-refresh overscroll reports negative offsets.
    expect(slideStep(SPAN, -40, 0, UNMEASURED, SPAN, 8)).toBe(0);
  });

  // The bar can't have travelled further from its resting place than the content has, so within the
  // first `span` px of scroll it is tied to the content and arrives fully shown exactly at 0. Before
  // this, commit-on-release could park a bar fully hidden a few px down the list (an unearned reveal
  // snaps it back there) and crossing the top guard then flung it open in a single frame.
  test('is never hidden further than the content has scrolled', () => {
    expect(slideStep(SPAN, 20, 40, UNMEASURED, SPAN)).toBe(20);
    expect(slideStep(SPAN, 1, 2, UNMEASURED, SPAN)).toBe(1);
    // Past the span the ceiling stops binding and normal accumulation takes over.
    expect(slideStep(40, 130, 120, UNMEASURED, SPAN)).toBe(50);
  });

  test('the ceiling also applies to a step the guards rejected', () => {
    // A reposition landing near the top must not leave the bar parked off-screen up there.
    expect(slideStep(SPAN, 30, 800, UNMEASURED, SPAN)).toBe(30);
    // ...but a rejected step further down still just holds still.
    expect(slideStep(60, 800, 400, UNMEASURED, SPAN)).toBe(60);
  });

  test('holds still through the elastic bottom bounce', () => {
    // maxScrollY = 500: springing back from 560 -> 520 is not a real scroll-up.
    expect(slideStep(SPAN, 520, 560, 500, SPAN)).toBe(SPAN);
    // Unmeasured maxScrollY skips the guard entirely.
    expect(slideStep(SPAN, 520, 560, UNMEASURED, SPAN)).toBe(60);
  });

  // A screen whose content fits the viewport: maxScrollY is a measured 0, so there is no scroll to
  // be had and every offset it reports is the elastic stretch. This used to be indistinguishable
  // from "unmeasured", which disarmed the guard — dragging a short screen slid the chrome away
  // under a gesture that moved no content at all.
  test('holds still on a screen with nothing to scroll', () => {
    expect(slideStep(0, 40, 0, 0, SPAN)).toBe(0);
    expect(slideStep(0, 120, 40, 0, SPAN)).toBe(0);
    // ...and through the springback, which reports the same decreasing offsets a scroll-up does.
    expect(slideStep(0, 40, 120, 0, SPAN)).toBe(0);
  });

  // The regression this guard exists for: a list that lands mid-content on a fresh mount (or a
  // `scrollY` zeroed by useSlidingBar's scope reset while the list sits elsewhere) reports one
  // enormous step that is a reposition, not a gesture. Accumulating it hid both bars for good.
  test('ignores a reposition-sized jump instead of accumulating it', () => {
    expect(slideStep(0, 780, 0, UNMEASURED, SPAN)).toBe(0);
    // ...and the same in reverse, so a jump back up can't fake a reveal either. Landing well clear
    // of the top: a jump that ends up NEAR it legitimately shows the bar (see the hide ceiling).
    expect(slideStep(SPAN, 300, 1080, UNMEASURED, SPAN)).toBe(SPAN);
  });

  test('still tracks the frame after a jump, measured from where the list landed', () => {
    expect(slideStep(0, 780, 0, UNMEASURED, SPAN)).toBe(0);
    expect(slideStep(0, 820, 780, UNMEASURED, SPAN)).toBe(40);
  });

  test('a hard fling stays under the jump threshold', () => {
    // ~130px/frame is about as fast as a 60Hz fling reports.
    expect(slideStep(0, 130, 0, UNMEASURED, SPAN)).toBe(100);
  });
});

describe('settleTarget', () => {
  const DEEP = 400; // far enough down that `dismissTarget` allows a resting hide

  test('settles to whichever end the bar is nearer', () => {
    expect(settleTarget(SPAN, DEEP, SPAN)).toBe(SPAN);
    expect(settleTarget(SPAN / 2 + 1, DEEP, SPAN)).toBe(SPAN);
    expect(settleTarget(SPAN / 2, DEEP, SPAN)).toBe(0);
    expect(settleTarget(SPAN / 2 - 1, DEEP, SPAN)).toBe(0);
    expect(settleTarget(0, DEEP, SPAN)).toBe(0);
  });

  // The behaviour this rule exists for: drag a bar back past halfway, let go, and it stays open.
  // The earned rule this replaced closed it again — a gesture that had scrolled down at all had
  // spent its credit, so where it actually left the bar counted for nothing.
  test('a bar scrolled back past its midpoint comes open rather than finishing its hide', () => {
    let hidden = SPAN;
    let y = DEEP;
    for (let i = 0; i < 8; i++, y -= 7) hidden = slideStep(hidden, y - 7, y, UNMEASURED, SPAN);
    expect(hidden).toBe(SPAN - 56); // 44 of 100 — past halfway open
    expect(settleTarget(hidden, y, SPAN)).toBe(0);
  });

  test('never rests hidden where the content has not scrolled far enough to hide it', () => {
    // Past its own midpoint, but only 20px down the list: `dismissTarget` still has the last word.
    expect(settleTarget(SPAN, 20, SPAN)).toBe(0);
    expect(settleTarget(SPAN, dismissThreshold(SPAN) - 1, SPAN)).toBe(0);
    expect(settleTarget(SPAN, dismissThreshold(SPAN), SPAN)).toBe(SPAN);
  });

  // The band the two bars disagree in — see the note on `settleTarget`. Pinned here so a future
  // span change shows what it costs rather than quietly widening it.
  test('bars of different spans part company only between their midpoints', () => {
    const TOP_BAR = 60;
    const TAB_BAR = 82;
    for (const hidden of [0, 10, 29, 42, 55, 60]) {
      const top = settleTarget(Math.min(hidden, TOP_BAR), 400, TOP_BAR) > 0;
      const tab = settleTarget(Math.min(hidden, TAB_BAR), 400, TAB_BAR) > 0;
      if (hidden > TOP_BAR / 2 && hidden <= TAB_BAR / 2) expect(top).not.toBe(tab);
      else expect(top).toBe(tab);
    }
  });
});

describe('settleScrollDelta', () => {
  // The settle scrolls the content by exactly the travel it still owes — a bar hides by
  // accumulating scroll 1:1, so finishing its last 30px IS 30px of scrolling (see useSlidingBar).
  test('finishing a hide scrolls down by the remaining travel', () => {
    expect(settleScrollDelta(SPAN - 30, SPAN)).toBe(30);
    expect(settleScrollDelta(0, SPAN)).toBe(SPAN);
  });

  test('coming back open scrolls up by however far the bar was hidden', () => {
    expect(settleScrollDelta(30, 0)).toBe(-30);
    expect(settleScrollDelta(SPAN, 0)).toBe(-SPAN);
  });

  // `hideCeiling` won't let a bar be hidden further than the content has scrolled, so a reveal's
  // scroll target can never go negative and needs no clamp of its own.
  test('a reveal can never ask the list to scroll above the top', () => {
    for (const y of [0, 5, 30, SPAN, 400]) {
      expect(y + settleScrollDelta(hideCeiling(y, SPAN), 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('dismissTarget', () => {
  // The real spans: the top bar slides its content height, the tab bar its measured height, which
  // depends on whether the device has a home indicator.
  const TOP_BAR = 60;
  const TAB_BAR_INSET = 82;
  const TAB_BAR_NO_INSET = 56;

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

  // The threshold used to be each bar's OWN span, so between the shortest and the tallest a release
  // dismissed one bar and bounced the other back — one gesture, two answers, on a number that
  // belonged to neither bar.
  test('every bar commits at the same scroll depth, whatever its span', () => {
    for (const y of [0, 20, TOP_BAR, 70, DISMISS_DISTANCE - 1]) {
      expect(dismissTarget(y, TOP_BAR)).toBe(0);
      expect(dismissTarget(y, TAB_BAR_INSET)).toBe(0);
      expect(dismissTarget(y, TAB_BAR_NO_INSET)).toBe(0);
    }
    // ...and past it they all commit, each to its own span (that part IS per-bar — it's how far the
    // bar has to travel to be gone, not when it decides to go).
    expect(dismissTarget(DISMISS_DISTANCE, TOP_BAR)).toBe(TOP_BAR);
    expect(dismissTarget(DISMISS_DISTANCE, TAB_BAR_INSET)).toBe(TAB_BAR_INSET);
    expect(dismissTarget(DISMISS_DISTANCE, TAB_BAR_NO_INSET)).toBe(TAB_BAR_NO_INSET);
  });

  // The shared distance can only ever raise the threshold. A bar taller than it still waits for its
  // own span, or it would commit further out than the content has scrolled and snap back to the
  // hide ceiling on the next report — the pop that ceiling exists to prevent.
  test('never commits a bar further out than the content has scrolled', () => {
    const TALL = DISMISS_DISTANCE + 40;
    expect(dismissTarget(DISMISS_DISTANCE, TALL)).toBe(0);
    expect(dismissTarget(TALL - 1, TALL)).toBe(0);
    expect(dismissTarget(TALL, TALL)).toBe(TALL);
  });

  test('only decides the resting place — tracking under the finger still moves 1:1', () => {
    // Same 20px offset: the bar has genuinely slid 20px while the finger is down...
    expect(slideStep(0, 20, 0, UNMEASURED, SPAN)).toBe(20);
    // ...and on release goes back to shown, since 20px of content can't hide a 100px bar.
    expect(dismissTarget(20, SPAN)).toBe(0);
  });
});
