import { beforeEach, describe, expect, test } from 'bun:test';

import {
  ANY_TARGET_WINDOW_MS,
  BACK_TARGET,
  claimNavigation,
  navTargetKey,
  resetNavigationGuard,
  SAME_TARGET_WINDOW_MS,
} from './nav-guard';

beforeEach(() => resetNavigationGuard());

describe('navTargetKey', () => {
  test('string hrefs are their own key', () => {
    expect(navTargetKey('/search')).toBe('/search');
  });

  test('object hrefs fold pathname + params into one key, param order independent', () => {
    const a = navTargetKey({ pathname: '/series', params: { id: '7', bridgeId: 'demo' } });
    const b = navTargetKey({ pathname: '/series', params: { bridgeId: 'demo', id: '7' } });
    expect(a).toBe(b);
    expect(a).toBe('/series?bridgeId=demo&id=7');
  });

  test('different params are different destinations', () => {
    expect(navTargetKey({ pathname: '/series', params: { id: '7' } })).not.toBe(
      navTargetKey({ pathname: '/series', params: { id: '8' } }),
    );
  });

  test('undefined params are dropped, not stringified', () => {
    expect(navTargetKey({ pathname: '/reader', params: { seed: 'x', chapterId: undefined } })).toBe('/reader?seed=x');
  });
});

describe('claimNavigation', () => {
  test('the first navigation always wins', () => {
    expect(claimNavigation('/series?id=7', 1000)).toBe(true);
  });

  test('a repeat of the same destination inside the window is dropped', () => {
    expect(claimNavigation('/series?id=7', 1000)).toBe(true);
    expect(claimNavigation('/series?id=7', 1000 + SAME_TARGET_WINDOW_MS - 1)).toBe(false);
  });

  test('the same destination is allowed again after the window', () => {
    expect(claimNavigation('/series?id=7', 1000)).toBe(true);
    expect(claimNavigation('/series?id=7', 1000 + SAME_TARGET_WINDOW_MS)).toBe(true);
  });

  test('a different destination only loses inside the (short) any-target window', () => {
    expect(claimNavigation('/series?id=7', 1000)).toBe(true);
    expect(claimNavigation('/series?id=8', 1000 + ANY_TARGET_WINDOW_MS - 1)).toBe(false);
    expect(claimNavigation('/series?id=8', 1000 + ANY_TARGET_WINDOW_MS)).toBe(true);
  });

  test('rejected claims do not extend the window (no lockout under sustained tapping)', () => {
    expect(claimNavigation('/series?id=7', 1000)).toBe(true);
    for (let t = 1100; t < 1000 + SAME_TARGET_WINDOW_MS; t += 100) {
      expect(claimNavigation('/series?id=7', t)).toBe(false);
    }
    // Still measured from the one ACCEPTED navigation, so the window really does expire.
    expect(claimNavigation('/series?id=7', 1000 + SAME_TARGET_WINDOW_MS)).toBe(true);
  });

  test('the any-target window stays short enough not to eat a deliberate next tap', () => {
    // Not a style preference: at 400ms a back-then-tap-a-different-row sequence lost the second
    // navigation in the browser. Only genuinely simultaneous presses may be caught here.
    expect(ANY_TARGET_WINDOW_MS).toBeLessThanOrEqual(200);
  });

  test('a double-tapped back pops once', () => {
    expect(claimNavigation(BACK_TARGET, 1000)).toBe(true);
    expect(claimNavigation(BACK_TARGET, 1200)).toBe(false);
  });

  test('a push immediately after a back is never a duplicate', () => {
    // Backing out of a screen and opening another one is two intents; no misfire produces it.
    expect(claimNavigation(BACK_TARGET, 1000)).toBe(true);
    expect(claimNavigation('/search', 1001)).toBe(true);
  });

  test('a back immediately after a push is never a duplicate either', () => {
    expect(claimNavigation('/search', 1000)).toBe(true);
    expect(claimNavigation(BACK_TARGET, 1001)).toBe(true);
  });

  test('a back that follows a forward navigation still guards the NEXT back', () => {
    expect(claimNavigation('/search', 1000)).toBe(true);
    expect(claimNavigation(BACK_TARGET, 1001)).toBe(true);
    expect(claimNavigation(BACK_TARGET, 1002)).toBe(false);
  });
});
