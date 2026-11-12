import { describe, expect, test } from 'bun:test';

import { bookPoint, placeShelf, projectToStage, type ShelfBook } from '@/lib/bookshelf';

import { multiply, pickBook, shelfToWorld, sunProjection, through, viewProjection, worldToShelf, type StageView } from './camera';

const stage: StageView = { width: 430, height: 346, centre: 245, yaw: 2.1, pitch: -1.2 };

/** A point of the shelf's space on the stage, through the matrices the renderer draws with. */
function drawnAt(view: StageView, point: readonly [number, number, number]) {
  const [x, y] = through(multiply(viewProjection(view), shelfToWorld(view)), point);
  return { x: ((x + 1) / 2) * view.width, y: ((1 - y) / 2) * view.height };
}

describe('the direct renderer’s camera', () => {
  test('is the one the callouts are projected through', () => {
    for (const view of [stage, { ...stage, centre: 215, yaw: 0, pitch: 0 }, { ...stage, width: 932, height: 300, centre: 500, yaw: -3.5, pitch: 2 }]) {
      for (const point of [[0, 0, 0], [-180, 190, -60], [140, 12, 70], [60, 96, -30]] as const) {
        const drawn = drawnAt(view, point);
        const projected = projectToStage(view, ...point);
        expect(drawn.x).toBeCloseTo(projected.x, 2);
        expect(drawn.y).toBeCloseTo(projected.y, 2);
      }
    }
  });

  test('keeps what it draws between its near and far planes', () => {
    for (const point of [[0, 0, 80], [-1500, 0, -160], [300, 220, 90]] as const) {
      const depth = through(multiply(viewProjection(stage), shelfToWorld(stage)), point)[2];
      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeLessThan(1);
    }
  });

  test('turns the world back into the shelf’s space', () => {
    const point = [37, 120, -44] as const;
    const back = through(worldToShelf(stage), through(shelfToWorld(stage), point));
    back.forEach((value, axis) => expect(value).toBeCloseTo(point[axis], 3));
  });

  test('casts the shadow from inside the light’s reach', () => {
    for (const point of [[0, 0, 0], [-300, 0, 80], [300, 200, -100]] as const) {
      const [x, y, depth] = through(sunProjection(), point);
      for (const along of [x, y]) expect(Math.abs(along)).toBeLessThan(1);
      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeLessThan(1);
    }
  });
});

describe('picking a book', () => {
  const books: (ShelfBook & { hard: boolean })[] = Array.from({ length: 9 }, (_, i) => ({
    width: 130,
    height: 190,
    depth: 22 + i * 3,
    binding: i % 2 ? 'right' : 'left',
    hard: true,
  }));
  const level = { ...stage, yaw: 0, pitch: 0 };
  const places = placeShelf(books, 4);
  const middleOf = (index: number) => {
    const { x, y, z } = bookPoint(places[index], 0, books[index].height / 2, books[index].depth / 2);
    return projectToStage(level, x, y, z);
  };

  test('finds the book in front under its cover', () => {
    const at = middleOf(4);
    expect(pickBook(level, books, places, at.x, at.y)).toBe(4);
  });

  test('finds a shelved book under its spine', () => {
    for (const index of [2, 6]) {
      const place = places[index];
      const book = books[index];
      // Its spine's middle: the bound edge, half way up.
      const { x, y, z } = bookPoint(place, book.binding === 'left' ? -book.width / 2 : book.width / 2, book.height / 2, 0);
      const at = projectToStage(level, x, y, z);
      expect(pickBook(level, books, places, at.x, at.y)).toBe(index);
    }
  });

  test('finds nothing over the books', () => {
    expect(pickBook(level, books, places, level.centre, 6)).toBe(-1);
  });
});
