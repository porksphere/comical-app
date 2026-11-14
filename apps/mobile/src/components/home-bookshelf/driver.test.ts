import { describe, expect, test } from 'bun:test';

import { shelfMiddle, type ShelfPlace } from '@/lib/bookshelf';

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
