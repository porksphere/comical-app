import { describe, expect, test } from 'bun:test';

import { DISPLAY, SHELF, shelfMiddle, type ShelfCallouts } from '@/lib/bookshelf';

import { ShelfDriver } from './driver';
import type { ShelfBookSpec } from './scene';

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
