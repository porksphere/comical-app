import { describe, expect, test } from 'bun:test';

import { shelfMiddle } from '@/lib/bookshelf';

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
