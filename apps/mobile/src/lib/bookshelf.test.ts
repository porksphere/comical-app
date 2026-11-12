import { describe, expect, test } from 'bun:test';

import {
  DRIFT,
  PRESS,
  SHELF,
  arrangeShelf,
  bayer4,
  boardColour,
  bookDepth,
  bookPoint,
  driftAt,
  inkOn,
  pickShelf,
  placeShelf,
  popIn,
  pressedPlace,
  projectToStage,
  rubberBand,
  settleOn,
  shelfCallouts,
  shelfMiddle,
  shelfOverlap,
  shelfStageHeight,
  spineNumber,
  type ShelfBook,
} from './bookshelf';

const book = (binding: 'left' | 'right' = 'left', depth = 28): ShelfBook => ({ width: 130, height: 195, depth, binding });
const shelf = [book(), book('right'), book('left', 5), book(), book('right', 40), book()];
const rad = (d: number) => (d * Math.PI) / 180;
/** The room a placed book takes along the shelf, and the span it covers. */
const span = (b: ShelfBook, x: number, yaw: number) => {
  const half = (b.width * Math.abs(Math.cos(rad(yaw))) + b.depth * Math.abs(Math.sin(rad(yaw)))) / 2;
  return [x - half, x + half] as const;
};

describe('placeShelf', () => {
  test('the front book shows its cover, the rest their spines', () => {
    const places = placeShelf(shelf, 3);
    expect(places[3].yaw).toBeCloseTo(SHELF.coverYaw);
    expect(places[3].ink).toBe(0);
    expect(places[4].yaw).toBeCloseTo(-90 + SHELF.peel);
    expect(places[2].yaw).toBeCloseTo(90 - SHELF.peel);
    for (const i of [0, 1, 2, 4, 5]) expect(places[i].ink).toBe(1);
  });

  test('a book bound on the right turns the other way to show its cover', () => {
    expect(placeShelf(shelf, 1)[1].yaw).toBeCloseTo(-SHELF.coverYaw);
  });

  test('the front book stands out past the line of spines', () => {
    const places = placeShelf(shelf, 3);
    expect(places[3].z).toBeCloseTo(SHELF.pull + shelf[3].depth / 2);
    expect(places[0].z).toBeCloseTo(-shelf[0].width / 2);
  });

  test('at rest every book stands a gap from the next', () => {
    for (const pos of [0, 1, 2, 3, 5]) {
      const places = placeShelf(shelf, pos);
      for (let i = 1; i < shelf.length; i++) {
        const [, rightOfPrev] = span(shelf[i - 1], places[i - 1].x, places[i - 1].yaw);
        const [left] = span(shelf[i], places[i].x, places[i].yaw);
        expect(left - rightOfPrev).toBeCloseTo(SHELF.gap, 5);
      }
    }
  });

  test('no two books run into each other between two rests, whichever way they are bound', () => {
    const shelves = [shelf, shelf.map((b) => ({ ...b, binding: 'right' as const })), shelf.map((b, i) => ({ ...b, binding: i % 2 ? ('left' as const) : ('right' as const) }))];
    for (const books of shelves) {
      for (let pos = -0.4; pos <= 5.4; pos += 0.02) {
        const places = placeShelf(books, pos);
        for (let i = 0; i < books.length; i++) {
          for (const j of [i + 1, i + 2]) if (j < books.length) expect(shelfOverlap(books[i], places[i], books[j], places[j])).toBe(0);
        }
      }
    }
  });

  test('the books beside the two trading places move once, one way', () => {
    const books = Array.from({ length: 9 }, () => book('right'));
    for (const who of [1, 2, 6, 7]) {
      let travelled = 0;
      let before = placeShelf(books, 4)[who].x;
      const from = before;
      for (let step = 1; step <= 100; step++) {
        const x = placeShelf(books, 4 + step / 100)[who].x;
        travelled += Math.abs(x - before);
        before = x;
      }
      expect(travelled).toBeCloseTo(Math.abs(before - from), 3);
    }
  });

  test('places move continuously as a book comes forward', () => {
    let before = placeShelf(shelf, 2);
    for (let pos = 2.01; pos <= 3; pos += 0.01) {
      const now = placeShelf(shelf, pos);
      for (let i = 0; i < shelf.length; i++) {
        expect(Math.abs(now[i].yaw - before[i].yaw)).toBeLessThan(4);
        expect(Math.abs(now[i].x - before[i].x)).toBeLessThan(6);
      }
      before = now;
    }
  });

  test('the first book stands left of the middle and the last right of it', () => {
    expect(placeShelf(shelf, 0)[0].x).toBeLessThan(0);
    expect(placeShelf(shelf, 5)[5].x).toBeGreaterThan(0);
    expect(placeShelf([book(), book(), book()], 1)[1].x).toBeCloseTo(0);
  });

  test('one book, and none', () => {
    expect(placeShelf([book()], 0)[0].x).toBeCloseTo(0);
    expect(placeShelf([], 0)).toEqual([]);
  });
});

describe('the drag', () => {
  test('follows freely along the shelf and less and less past its ends', () => {
    expect(rubberBand(2.5, 6)).toBe(2.5);
    expect(rubberBand(-1, 6)).toBeCloseTo(-0.25);
    expect(rubberBand(-100, 6)).toBeGreaterThan(-0.5);
    expect(rubberBand(6, 6)).toBeCloseTo(5.25);
  });

  test('a release lands on the nearest book, or as far as three on for a fling', () => {
    expect(settleOn(2.4, 0, 6)).toBe(2);
    expect(settleOn(2.4, 4, 6)).toBe(3);
    expect(settleOn(1, 100, 6)).toBe(4);
    expect(settleOn(0.2, -50, 6)).toBe(0);
    expect(settleOn(0, 0, 0)).toBe(0);
  });
});

describe('projectToStage', () => {
  const stage = { width: 390, height: shelfStageHeight(390) };

  test('the middle of the shelf stands on the floor line, in the middle', () => {
    const at = projectToStage(stage, 0, 0, 0);
    expect(at.x).toBeCloseTo(195);
    // Tipped toward the eye about the stage's middle, the foot swings a little back and up.
    expect(at.y).toBeGreaterThan(stage.height - SHELF.floor - 12);
    expect(at.y).toBeLessThan(stage.height - SHELF.floor + 2);
  });

  test('nearer is larger', () => {
    expect(projectToStage(stage, 0, 100, 60).scale).toBeGreaterThan(projectToStage(stage, 0, 100, -60).scale);
    expect(projectToStage(stage, 50, 100, 60).x).toBeGreaterThan(projectToStage(stage, 50, 100, -60).x);
  });

  test('up the shelf is up the stage', () => {
    expect(projectToStage(stage, 0, 150, 0).y).toBeLessThan(projectToStage(stage, 0, 20, 0).y);
  });
});

test('bookPoint turns with the book', () => {
  const spineOn = bookPoint({ x: 10, z: 0, yaw: 90, ink: 1 }, -65, 100, 0);
  expect(spineOn.x).toBeCloseTo(10);
  expect(spineOn.z).toBeCloseTo(65);
  const faceOn = bookPoint({ x: 10, z: 5, yaw: 0, ink: 0 }, 65, 100, 14);
  expect(faceOn).toEqual({ x: 75, y: 100, z: 19 });
});

test('bookDepth: a long series is a thick book, and the unbound forms stay thin', () => {
  expect(bookDepth('volume', 130, 400)).toBeGreaterThan(bookDepth('volume', 130, 10));
  expect(bookDepth('volume', 130, 400)).toBe(bookDepth('volume', 130, 200));
  expect(bookDepth('issue', 130, 400)).toBeLessThan(8);
  expect(bookDepth('sheets', 130, undefined)).toBe(6);
});

test('bayer4 is the 4x4 matrix: sixteen thresholds, each once', () => {
  const seen = new Set<number>();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(bayer4(x, y));
  expect(seen.size).toBe(16);
  expect(Math.min(...seen)).toBeCloseTo(1 / 32);
  expect(Math.max(...seen)).toBeCloseTo(31 / 32);
  expect(bayer4(5, 6)).toBe(bayer4(1, 2));
});

test('boardColour reads the strip beside the binding', () => {
  // 10x2, red down the left tenth and blue elsewhere.
  const pixels = new Uint8Array(10 * 2 * 4);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 10; x++) pixels.set(x === 0 ? [200, 0, 0, 255] : [0, 0, 200, 255], (y * 10 + x) * 4);
  expect(boardColour(pixels, 10, 2, 'left')).toEqual([164, 0, 0]);
  expect(boardColour(pixels, 10, 2, 'right')).toEqual([0, 0, 164]);
});

test('inkOn picks lettering that reads', () => {
  expect(inkOn([20, 30, 60])[0]).toBeGreaterThan(200);
  expect(inkOn([230, 220, 200])[0]).toBeLessThan(60);
});

describe('shelfCallouts', () => {
  const stage = { width: 390, height: shelfStageHeight(390) };

  test('the burst stands on the free top corner and the caption on the bound bottom one', () => {
    const at = shelfCallouts(shelf, placeShelf(shelf, 3), 3, stage);
    expect(at.front).toBe(3);
    expect(at.settled).toBe(1);
    // Book 3 is bound on its left: it opens to the right.
    expect(at.burst.x).toBeGreaterThan(at.caption.x);
    expect(at.burst.y).toBeLessThan(at.caption.y);
    expect(at.caption.side).toBe(-1);
    const mirrored = shelfCallouts(shelf, placeShelf(shelf, 1), 1, stage);
    expect(mirrored.burst.x).toBeLessThan(mirrored.caption.x);
    expect(mirrored.caption.side).toBe(1);
  });

  test('the burst stays on the stage', () => {
    for (const pos of [0, 5]) {
      const { burst } = shelfCallouts(shelf, placeShelf(shelf, pos), pos, stage);
      expect(burst.x).toBeGreaterThanOrEqual(50);
      expect(burst.x).toBeLessThanOrEqual(stage.width - 50);
    }
  });

  test('half way between two books nothing has arrived', () => {
    expect(shelfCallouts(shelf, placeShelf(shelf, 2.5), 2.5, stage).settled).toBe(0);
    expect(popIn(0)).toBeCloseTo(0);
    expect(popIn(1)).toBe(1);
    expect(popIn(0.8)).toBeGreaterThan(1);
  });

  test('a tab stands over every shelved book and fades from the one in front', () => {
    const { tabs } = shelfCallouts(shelf, placeShelf(shelf, 3), 3, stage);
    expect(tabs).toHaveLength(shelf.length);
    expect(tabs[3].shelved).toBe(0);
    expect(tabs[0].shelved).toBe(1);
    expect(tabs[0].x).toBeLessThan(tabs[5].x);
  });

  test('an empty shelf', () => {
    expect(shelfCallouts([], [], 0, stage).tabs).toEqual([]);
  });
});

test('a stage whose middle is off its centre projects about that line', () => {
  const plain = { width: 390, height: shelfStageHeight(390) };
  const underBar = { width: 450, height: plain.height, centre: 60 + 195 };
  const a = projectToStage(plain, 40, 100, 20);
  const b = projectToStage(underBar, 40, 100, 20);
  expect(b.x - a.x).toBeCloseTo(60);
  expect(b.y).toBeCloseTo(a.y);
  expect(b.scale).toBeCloseTo(a.scale);
});

test('the view drifts a little, and a tipped phone adds a little to it', () => {
  for (let now = 0; now < 20000; now += 137) {
    const { yaw, pitch } = driftAt(now, { x: 0, y: 0 });
    expect(Math.abs(yaw)).toBeLessThanOrEqual(DRIFT.yaw);
    expect(Math.abs(pitch)).toBeLessThanOrEqual(DRIFT.pitch);
  }
  const level = driftAt(5000, { x: 0, y: 0 });
  const tipped = driftAt(5000, { x: 1, y: -1 });
  expect(tipped.yaw - level.yaw).toBeCloseTo(DRIFT.tiltYaw);
  expect(tipped.pitch - level.pitch).toBeCloseTo(-DRIFT.tiltPitch);
  // The phone adds to the drift and never outweighs it.
  expect(DRIFT.tiltYaw).toBeLessThan(DRIFT.yaw);
  expect(DRIFT.tiltPitch).toBeLessThan(DRIFT.pitch);
});

test('a drifted view moves what stands off the middle and leaves the middle where it was', () => {
  const stage = { width: 390, height: shelfStageHeight(390) };
  const turned = { ...stage, yaw: 1.4 };
  const pivot = stage.height / 2 - SHELF.floor;
  expect(projectToStage(turned, 0, pivot, 0).x).toBeCloseTo(projectToStage(stage, 0, pivot, 0).x);
  expect(projectToStage(turned, 0, 100, 60).x).not.toBeCloseTo(projectToStage(stage, 0, 100, 60).x, 1);
});

test('a pressed book goes back, and springs out further than it went in', () => {
  const place = { x: 4, z: 50, yaw: 12, ink: 0 };
  expect(pressedPlace(place, 0)).toBe(place);
  const pressed = pressedPlace(place, 1);
  expect(pressed.z).toBeCloseTo(50 - PRESS.back);
  expect(pressed.x).toBe(4);
  expect(pressed.yaw).toBe(12);
  const sprung = pressedPlace(place, -0.2);
  expect(sprung.z).toBeGreaterThan(50);
  expect(sprung.z - 50).toBeGreaterThan(0.2 * PRESS.back);
});

test('what matters most stands in the middle, and less to either side by turns', () => {
  expect(arrangeShelf(['a'])).toEqual(['a']);
  expect(arrangeShelf(['a', 'b'])).toEqual(['a', 'b']);
  expect(arrangeShelf(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['e', 'c', 'a', 'b', 'd', 'f']);
  for (const count of [1, 2, 3, 6, 7, 30]) {
    const ranked = Array.from({ length: count }, (_, i) => i);
    expect(arrangeShelf(ranked)[shelfMiddle(count)]).toBe(0);
  }
  expect(shelfMiddle(0)).toBe(0);
});

describe('pickShelf', () => {
  const read = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];
  const news = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'];

  test('half from each, alternating behind the book read last', () => {
    expect(pickShelf(read, news, 6)).toEqual(['r1', 'n1', 'n2', 'r2', 'n3', 'r3']);
  });

  test('one that runs short is made up from the other', () => {
    expect(pickShelf(read, ['n1'], 6)).toEqual(['r1', 'n1', 'r2', 'r3', 'r4', 'r5']);
    expect(pickShelf(['r1'], news, 6)).toEqual(['r1', 'n1', 'n2', 'n3', 'n4', 'n5']);
    expect(pickShelf([], news, 4)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(pickShelf(['r1', 'r2'], ['n1'], 6)).toEqual(['r1', 'n1', 'r2']);
  });

  test('a series in both is one book, and still in front when it was read last', () => {
    const picked = pickShelf(['x', 'r2', 'r3', 'r4'], ['n1', 'x', 'n3'], 6);
    expect(picked[0]).toBe('x');
    expect(picked.filter((key) => key === 'x')).toHaveLength(1);
    expect(picked).toHaveLength(6);
  });
});

test('spineNumber: the chapter the book opens at, two digits at least', () => {
  expect(spineNumber('Chapter 7')).toBe('07');
  expect(spineNumber('Ch. 12 - The Coast Road')).toBe('12');
  expect(spineNumber('Episode 104')).toBe('104');
  expect(spineNumber('Chapter 12.5')).toBe('12.5');
  expect(spineNumber('3')).toBe('03');
  expect(spineNumber('Prologue')).toBeUndefined();
  expect(spineNumber(undefined)).toBeUndefined();
});
