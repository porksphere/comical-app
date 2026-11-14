import { describe, expect, test } from 'bun:test';

import { DISPLAY, SHELF, shelfMiddle, type ShelfCallouts, type ShelfPlace } from '@/lib/bookshelf';

import { ShelfDriver } from './driver';
import type { ShelfBookSpec, ShelfScene } from './scene';

const book = (key: string) =>
  ({ key, title: key, cover: { form: 'volume', binding: 'left' }, width: 100, height: 150, depth: 12, board: [0, 0, 0], ink: [255, 255, 255] }) as unknown as ShelfBookSpec;
const shelf = (...keys: string[]) => keys.map(book);

function listening() {
  const driver = new ShelfDriver();
  const fronts: { key: string; byHand: boolean }[] = [];
  driver.setStage({ width: 390, height: 300 }, 1);
  driver.listen({ onFrame: () => {}, onFront: (key, byHand) => fronts.push({ key, byHand }), onDrawn: () => {} });
  return { driver, fronts };
}

describe('ShelfDriver.setBooks', () => {
  test('an untouched shelf opens on the middle of each set, not of the first', () => {
    const { driver, fronts } = listening();
    driver.setBooks(shelf('n1', 'n2', 'n3'));
    expect(fronts.at(-1)).toEqual({ key: 'n2', byHand: false });
    const whole = shelf('h3', 'n2', 'h1', 'n1', 'h2', 'n3', 'h4');
    driver.setBooks(whole);
    expect(driver.focused).toBe(shelfMiddle(whole.length));
    expect(fronts.at(-1)).toEqual({ key: whole[shelfMiddle(whole.length)].key, byHand: false });
  });

  test('a shelf the reader has moved keeps its front book through a new order', () => {
    const { driver, fronts } = listening();
    driver.setBooks(shelf('a', 'b', 'c', 'd', 'e'));
    driver.setStill(true);
    driver.goTo(0);
    driver.step(16);
    expect(fronts.at(-1)).toEqual({ key: 'a', byHand: true });
    const said = fronts.length;
    driver.setBooks(shelf('b', 'c', 'a', 'd', 'e'));
    expect(driver.focused).toBe(2);
    expect(fronts.length).toBe(said);
  });

  test('a front book that leaves the shelf gives its place to the one standing there', () => {
    const { driver, fronts } = listening();
    driver.setBooks(shelf('a', 'b', 'c', 'd', 'e'));
    driver.setStill(true);
    driver.goTo(1);
    driver.step(16);
    expect(fronts.at(-1)?.key).toBe('b');
    driver.setBooks(shelf('a', 'c', 'd', 'e'));
    expect(fronts.at(-1)).toEqual({ key: 'c', byHand: false });
    driver.setBooks(shelf('a'));
    expect(driver.focused).toBe(0);
    expect(fronts.at(-1)).toEqual({ key: 'a', byHand: false });
  });
});

describe('ShelfDriver on a display row', () => {
  function displayed() {
    const driver = new ShelfDriver();
    const seen: { callouts: ShelfCallouts | null; fronts: string[] } = { callouts: null, fronts: [] };
    driver.setStage({ width: 390, height: 300 }, 1);
    driver.listen({ onFrame: (callouts) => (seen.callouts = callouts), onFront: (key) => seen.fronts.push(key), onDrawn: () => {} });
    driver.setMotion('display');
    driver.setBooks(shelf('a', 'b', 'c', 'd', 'e'));
    let now = 0;
    const run = (ms: number) => {
      for (const end = now + ms; now < end; ) driver.step((now += 16));
    };
    return { driver, seen, run };
  }

  test('a shelf opens with the book in front already on display', () => {
    const { seen, run } = displayed();
    run(16);
    expect(seen.callouts?.front).toBe(2);
    expect(seen.callouts?.settled).toBe(1);
  });

  test('a swipe puts the book on display back before the next comes out, and the one it lands on does', () => {
    const { driver, seen, run } = displayed();
    run(16);
    driver.grab();
    // One book's room along the row: its depth and the gap.
    driver.drag(-(12 + SHELF.gap));
    run(80);
    // Still going back: the callouts stay on it as it goes.
    expect(seen.callouts?.front).toBe(2);
    expect(seen.callouts!.settled).toBeLessThan(1);
    expect(seen.callouts!.settled).toBeGreaterThan(0);
    run(400);
    expect(seen.callouts?.front).toBe(3);
    expect(seen.callouts?.settled).toBe(0);
    driver.release(0);
    run(DISPLAY.out * 1000 + 300);
    expect(seen.callouts?.front).toBe(3);
    expect(seen.callouts?.settled).toBe(1);
    expect(seen.fronts.at(-1)).toBe('d');
  });

  test('a shelf at rest before the last book is back still brings out the next', () => {
    const { driver, seen, run } = displayed();
    run(16);
    driver.grab();
    driver.drag(-(12 + SHELF.gap));
    driver.release(0);
    run((DISPLAY.back + DISPLAY.out) * 1000 + 300);
    expect(seen.callouts?.front).toBe(3);
    expect(seen.callouts?.settled).toBe(1);
  });

  test('switching to a display row brings out the book in front', () => {
    const driver = new ShelfDriver();
    let callouts: ShelfCallouts | null = null;
    driver.setStage({ width: 390, height: 300 }, 1);
    driver.listen({ onFrame: (c) => (callouts = c), onFront: () => {}, onDrawn: () => {} });
    driver.setBooks(shelf('a', 'b', 'c'));
    driver.setMotion('display');
    expect(callouts!.settled).toBe(0);
    for (let now = 16; now < DISPLAY.out * 1000 + 200; now += 16) driver.step(now);
    expect(callouts!.front).toBe(1);
    expect(callouts!.settled).toBe(1);
  });

  test('under Reduce Motion the book the shelf lands on is out at once', () => {
    const { driver, seen, run } = displayed();
    driver.setStill(true);
    driver.goTo(4);
    run(16);
    run(16);
    expect(seen.callouts?.front).toBe(4);
    expect(seen.callouts?.settled).toBe(1);
  });
});

describe('ShelfDriver with the display played by the swipe', () => {
  function swiping() {
    const driver = new ShelfDriver();
    const seen: { callouts: ShelfCallouts | null; fronts: string[] } = { callouts: null, fronts: [] };
    driver.setStage({ width: 390, height: 300 }, 1);
    driver.listen({ onFrame: (callouts) => (seen.callouts = callouts), onFront: (key) => seen.fronts.push(key), onDrawn: () => {} });
    driver.setMotion('display-swipe');
    driver.setBooks(shelf('a', 'b', 'c', 'd', 'e'));
    let now = 0;
    const run = (ms: number) => {
      for (const end = now + ms; now < end; ) driver.step((now += 16));
    };
    return { driver, seen, run };
  }

  test('every book the swipe passes comes out as it passes, a carousel step a book', () => {
    const { driver, seen, run } = swiping();
    run(16);
    expect(seen.callouts?.front).toBe(2);
    expect(seen.callouts?.settled).toBe(1);
    driver.grab();
    driver.drag(-SHELF.dragUnit / 2);
    run(16);
    expect(seen.callouts?.settled).toBe(0);
    driver.drag(-SHELF.dragUnit);
    run(16);
    expect(seen.callouts?.front).toBe(3);
    expect(seen.callouts?.settled).toBeCloseTo(1);
    driver.drag(-SHELF.dragUnit * 2);
    run(16);
    expect(seen.callouts?.front).toBe(4);
    expect(seen.fronts.slice(-2)).toEqual(['d', 'e']);
  });

  test('a release lands on a book with its display all the way out, on no clock of its own', () => {
    const { driver, seen, run } = swiping();
    run(16);
    driver.grab();
    driver.drag(-SHELF.dragUnit * 1.3);
    driver.release(0);
    run(1000);
    expect(seen.callouts?.front).toBe(3);
    expect(seen.callouts?.settled).toBe(1);
  });
});

describe('ShelfDriver knocks', () => {
  /** A scene that keeps what it was last asked to draw. */
  function drawing(still = false) {
    const driver = new ShelfDriver();
    const seen: { places: ShelfPlace[]; stopped: number } = { places: [], stopped: 0 };
    const scene = {
      resize() {},
      setTheme() {},
      setBooks() {},
      setCover() {},
      setView() {},
      render(places: readonly ShelfPlace[]) {
        seen.places = places.map((p) => ({ ...p }));
      },
      pick: () => -1,
      drawn: () => undefined,
    } as unknown as ShelfScene;
    driver.setStage({ width: 390, height: 300 }, 1);
    driver.listen({ onFrame: () => {}, onFront: () => {}, onDrawn: () => {} });
    driver.setFrames({ start: () => {}, stop: () => seen.stopped++ });
    driver.attach(scene);
    driver.setStill(still);
    driver.setBooks(shelf('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'));
    let now = 0;
    const run = (ms: number, each?: () => void) => {
      for (const end = now + ms; now < end; ) {
        driver.step((now += 16));
        each?.();
      }
    };
    return { driver, seen, run };
  }

  test('a step along the shelf rocks the spines it shoves, and they come to rest before the frames stop', () => {
    const { driver, seen, run } = drawing();
    run(32);
    driver.goTo(5);
    let most = 0;
    let frontMost = 0;
    run(1500, () => {
      most = Math.max(most, ...seen.places.map((p) => Math.abs(p.roll ?? 0)));
      frontMost = Math.max(frontMost, Math.abs(seen.places[5].ink === 0 ? (seen.places[5].roll ?? 0) : 0));
    });
    expect(most).toBeGreaterThan(0.5);
    expect(frontMost).toBe(0);
    run(4000);
    expect(seen.places.every((p) => !p.roll)).toBe(true);
    expect(seen.stopped).toBeGreaterThan(0);
  });

  test('under Reduce Motion nothing rocks', () => {
    const { driver, seen, run } = drawing(true);
    run(32);
    driver.goTo(6);
    let most = 0;
    run(800, () => (most = Math.max(most, ...seen.places.map((p) => Math.abs(p.roll ?? 0)))));
    expect(most).toBe(0);
  });
});
