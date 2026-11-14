import { describe, expect, test } from 'bun:test';

import {
  SPINE_FOOT,
  DISPLAY,
  DRIFT,
  PRESS,
  SHELF,
  arrangeShelf,
  bayer4,
  boardColour,
  bookDepth,
  bookPoint,
  KNOCK,
  leanedPlace,
  restingKnocks,
  stepKnocks,
  displayClear,
  displayPose,
  displayRow,
  displayScrubbed,
  displaySettles,
  driftAt,
  inkOn,
  pickShelf,
  HOVER,
  hoveredPlace,
  placeDisplay,
  placeShelf,
  popIn,
  posAtRow,
  pressedPlace,
  projectToStage,
  rowAt,
  rubberBand,
  settleOn,
  settledPlace,
  shelfCallouts,
  shelfMiddle,
  shelfOverlap,
  shelfStageHeight,
  shelvedProud,
  spineNumber,
  spineNumberFit,
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
  // The drift stays smaller than what the reader's own tip can do.
  expect(DRIFT.yaw).toBeLessThan(DRIFT.tiltYaw);
  expect(DRIFT.pitch).toBeLessThan(DRIFT.tiltPitch);
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

test('a spine under the pointer comes part way out, tipped on its front edge', () => {
  const b = book();
  const place = { x: 4, z: 0, yaw: -88, ink: 1 };
  expect(hoveredPlace(place, b, 0)).toBe(place);
  const out = hoveredPlace(place, b, 1);
  expect(out.x).toBe(4);
  expect(out.yaw).toBe(-88);
  expect(out.tip).toBe(HOVER.tip);
  expect(out.z).toBeGreaterThan(HOVER.pull);
  expect(HOVER.pull).toBeLessThan(SHELF.pull);
  // The head comes toward the reader, and no corner of the foot goes below the shelf.
  expect(bookPoint(out, 0, b.height, 0).z - bookPoint(place, 0, b.height, 0).z).toBeGreaterThan(HOVER.pull);
  for (const along of [-b.width / 2, b.width / 2])
    for (const across of [-b.depth / 2, b.depth / 2]) expect(bookPoint(out, along, 0, across).y).toBeGreaterThan(-0.01);
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

test('spineNumberFit: a number always fits its spine, turned down it when that is larger', () => {
  const at = (em: number, width: number) => spineNumberFit({ em, width, length: 585, cap: 36, least: 9 });
  // "07" across a thick spine, at the cap or under it, and never wider than the spine.
  const wide = at(1.1, 72)!;
  expect(wide.turned).toBe(false);
  expect(wide.size * 1.1).toBeLessThan(72);
  // "104.5" on a narrow spine turns, and fits the foot's slot.
  const narrow = at(2.7, 40)!;
  expect(narrow.turned).toBe(true);
  expect(narrow.size * 2.7).toBeLessThanOrEqual(585 * SPINE_FOOT.length + 0.001);
  expect(narrow.size).toBeLessThanOrEqual(40 * 0.6);
  // Whatever the length of the number, set across it fits the width.
  for (const em of [0.6, 1.1, 1.7, 2.7, 4]) {
    for (const width of [18, 30, 48, 72]) {
      const fit = at(em, width);
      if (fit && !fit.turned) expect(fit.size * em).toBeLessThanOrEqual(width * 0.8 + 0.001);
      if (fit?.turned) expect(fit.size * em).toBeLessThanOrEqual(585 * SPINE_FOOT.length + 0.001);
    }
  }
  // Too thin to read is not drawn.
  expect(at(2.7, 6)).toBeNull();
  expect(at(0, 40)).toBeNull();
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

test('a zoomed stage is the same shelf, every point and scale that many times over', () => {
  const zoom = 1.5;
  const life = { width: 700, height: shelfStageHeight(700), centre: 340, yaw: 1.2, pitch: -0.6 };
  const zoomed = { ...life, width: life.width * zoom, height: life.height * zoom, centre: life.centre * zoom, zoom };
  for (const [x, y, z] of [
    [0, 0, 0],
    [60, 180, 40],
    [-220, 90, -30],
  ] as const) {
    const a = projectToStage(life, x, y, z);
    const b = projectToStage(zoomed, x, y, z);
    expect(b.x).toBeCloseTo(a.x * zoom, 6);
    expect(b.y).toBeCloseTo(a.y * zoom, 6);
    expect(b.scale).toBeCloseTo(a.scale * zoom, 6);
  }
  expect(Math.abs(shelfStageHeight(700 * zoom, zoom) - shelfStageHeight(700) * zoom)).toBeLessThanOrEqual(1);
});

describe('a display row', () => {
  const row = displayRow(shelf);
  /** Every corner of a placed book's foot, seen from above. */
  const corners = (b: ShelfBook, at: { x: number; z: number; yaw: number }) => {
    const c = Math.cos(rad(at.yaw));
    const s = Math.sin(rad(at.yaw));
    return [-1, 1].flatMap((i) => [-1, 1].map((j) => ({ x: at.x + (i * b.width * c) / 2 + (j * b.depth * s) / 2, z: at.z - (i * b.width * s) / 2 + (j * b.depth * c) / 2 })));
  };

  test('stands spine out and packed, with nothing on display', () => {
    const places = placeDisplay(shelf, row, 2, { index: 2, amount: 0 }, []);
    places.forEach((place, i) => {
      expect(Math.abs(place.yaw)).toBe(90);
      expect(place.ink).toBe(i === 2 ? 0 : 1);
    });
    for (let i = 1; i < shelf.length; i++) expect(places[i].x - places[i - 1].x).toBeCloseTo((shelf[i].depth + shelf[i - 1].depth) / 2 + SHELF.gap);
  });

  test('a swipe moves the row point for point, and back', () => {
    for (const pos of [0, 0.4, 1, 2.7, 5]) expect(posAtRow(row, rowAt(row, pos))).toBeCloseTo(pos);
    expect(rowAt(row, 1) - rowAt(row, 0)).toBeCloseTo((shelf[0].depth + shelf[1].depth) / 2 + SHELF.gap);
    // The row stands round where the swipe is: the book under it is where it was when it was in front.
    const a = placeDisplay(shelf, row, 3, { index: 3, amount: 0 }, []);
    const b = placeDisplay(shelf, row, 3.5, { index: 3, amount: 0 }, []);
    expect(a[3].x - b[3].x).toBeGreaterThan(0);
  });

  test('the swipe draws out the spine it is over, and puts it back as it passes', () => {
    const over = placeDisplay(shelf, row, 1, { index: 1, amount: 0 }, []);
    const half = placeDisplay(shelf, row, 1.5, { index: 1, amount: 0 }, []);
    expect(over[1].z).toBeCloseTo(-shelf[1].width / 2 + DISPLAY.nudge);
    expect(over[2].z).toBeCloseTo(-shelf[2].width / 2);
    expect(half[1].z).toBeCloseTo(half[2].z - (shelf[1].width - shelf[2].width) / 2);
  });

  test('the book on display comes out, faces the reader and leans back on the spines', () => {
    for (const b of [book(), book('right'), book('left', 5)]) {
      const shown = displayPose(b, 1, 1, 0);
      expect(shown.yaw).toBeCloseTo(Math.sign(b.binding === 'left' ? 1 : -1) * DISPLAY.yaw);
      expect(shown.tip).toBeCloseTo(-DISPLAY.lean);
      expect(shown.ink).toBe(0);
      // Its back's top edge rests just clear of the line of spines.
      const top = bookPoint(shown, 0, b.height, -b.depth / 2);
      expect(top.z).toBeGreaterThan(DISPLAY.clear - 1);
      expect(top.z).toBeLessThan(DISPLAY.clear + 6);
    }
  });

  test('it never runs into the books beside it, and once it turns stands clear of all they reach out', () => {
    const sheets: ShelfBook = { ...book('left', 6), form: 'sheets' };
    const issue: ShelfBook = { ...book('left', 5), form: 'issue' };
    for (const b of [book(), book('right'), book('left', 40)]) {
      for (const neighbour of [book(), sheets, issue]) {
        const books = [neighbour, b, neighbour];
        const clear = displayClear(books, displayRow(books), 1);
        const beside = b.depth / 2 + SHELF.gap + neighbour.depth / 2;
        for (let t = 0; t <= 1.0001; t += 0.005) {
          const at = displayPose(b, 1, t, 0, clear);
          for (const side of [-1, 1]) {
            const next = { x: side * beside, z: -neighbour.width / 2, yaw: 90, ink: 1 };
            expect(shelfOverlap(b, at, neighbour, next)).toBe(0);
          }
          if (Math.abs(at.yaw) < 89.99) for (const corner of corners(b, at)) expect(corner.z).toBeGreaterThan(shelvedProud(neighbour));
        }
      }
    }
  });

  test('a CG set reaches well out of the line of spines, a hard cover by its back, an issue not at all', () => {
    const sheets = shelvedProud({ ...book('left', 6), form: 'sheets' });
    expect(sheets).toBeGreaterThan(20);
    expect(shelvedProud(book())).toBeCloseTo(6);
    expect(shelvedProud({ ...book('left', 5), form: 'issue' })).toBe(0);
    // Only what stands behind the book on display moves it out.
    const far = [{ ...book('left', 6), form: 'sheets' as const }, ...Array.from({ length: 6 }, () => book()), book()];
    expect(displayClear(far, displayRow(far), far.length - 1)).toBe(DISPLAY.clear);
    expect(displayClear(far, displayRow(far), 1)).toBeCloseTo(sheets + DISPLAY.air);
  });

  test('the tabs on the spines behind the book on display go as it comes out', () => {
    const books = Array.from({ length: 9 }, () => book());
    const row = displayRow(books);
    const stage = { width: 390, height: 341 };
    const out = shelfCallouts(books, placeDisplay(books, row, 4, { index: 4, amount: 1 }, []), 4, stage, { index: 4, settled: 1 });
    expect(out.tabs[3].shelved).toBe(0);
    expect(out.tabs[5].shelved).toBe(0);
    expect(out.tabs[0].shelved).toBe(1);
    expect(out.tabs[8].shelved).toBe(1);
    // Still coming out spine first, it stands across nothing yet; turned, the tabs fade as it settles.
    const sliding = shelfCallouts(books, placeDisplay(books, row, 4, { index: 4, amount: 0.25 }, []), 4, stage, { index: 4, settled: 0.25 });
    expect(sliding.tabs[3].shelved).toBe(1);
    const turned = shelfCallouts(books, placeDisplay(books, row, 4, { index: 4, amount: 0.9 }, []), 4, stage, { index: 4, settled: 0.9 });
    expect(turned.tabs[3].shelved).toBeCloseTo(0.1);
  });

  test('its three moves run as one, with no jump between them', () => {
    const b = book();
    let last = displayPose(b, 1, 0, 0);
    for (let t = 0.001; t <= 1.0001; t += 0.001) {
      const at = displayPose(b, 1, t, 0);
      expect(Math.abs(at.z - last.z)).toBeLessThan(1);
      expect(Math.abs(at.yaw - last.yaw)).toBeLessThan(1);
      expect(Math.abs((at.tip ?? 0) - (last.tip ?? 0))).toBeLessThan(0.2);
      last = at;
    }
  });

  test('the books beside it settle into its gap once it is out of it, and nothing else leans', () => {
    expect(displaySettles(6, 2, { index: 2, amount: 0.2 }).every((d) => d === 0)).toBe(true);
    const settles = displaySettles(6, 2, { index: 2, amount: 1 });
    expect(settles).toEqual([0, DISPLAY.settle, 0, -DISPLAY.settle, 0, 0]);
    // A neighbour the swipe is drawing out is left to it.
    expect(displaySettles(6, 2.6, { index: 2, amount: 1 })[3]).toBe(0);
    expect(displaySettles(6, 0, { index: 0, amount: 1 })).toEqual([0, -DISPLAY.settle, 0, 0, 0, 0]);
  });

  test('a book leaning into the gap tips on the edge of its foot, and its head follows', () => {
    const b = book();
    const upright = { x: 0, z: -b.width / 2, yaw: 90, ink: 1 };
    const leaning = settledPlace(upright, b, 4);
    // The edge it leans toward stays where it was, on the shelf.
    const edge = bookPoint(leaning, 0, 0, b.depth / 2);
    expect(edge.x).toBeCloseTo(b.depth / 2);
    expect(edge.y).toBeCloseTo(0);
    const head = bookPoint(leaning, 0, b.height, 0);
    expect(head.x).toBeGreaterThan(b.height * Math.sin(rad(3.9)));
  });
});

describe('a display row played by the swipe', () => {
  test('the book the swipe is over is all the way out, and none is half way to the next', () => {
    expect(displayScrubbed(3, 6)).toEqual({ index: 3, amount: 1 });
    expect(displayScrubbed(2.5, 6).amount).toBe(0);
    expect(displayScrubbed(3.49, 6).index).toBe(3);
    expect(displayScrubbed(3.51, 6).index).toBe(4);
    // Past either end it is the end book's, as far as the swipe is from it.
    expect(displayScrubbed(-0.2, 6).index).toBe(0);
    expect(displayScrubbed(5.3, 6).index).toBe(5);
  });

  test('the display hands from book to book with no jump', () => {
    let last = displayScrubbed(0, 6);
    for (let pos = 0.002; pos <= 5; pos += 0.002) {
      const now = displayScrubbed(pos, 6);
      if (now.index !== last.index) {
        expect(last.amount).toBeLessThan(0.001);
        expect(now.amount).toBeLessThan(0.001);
      } else expect(Math.abs(now.amount - last.amount)).toBeLessThan(0.02);
      last = now;
    }
  });

  test('swept along the whole shelf it never runs into a book beside it, nor through what they reach out', () => {
    const books: ShelfBook[] = [book(), { ...book('left', 6), form: 'sheets' }, book('right'), { ...book('left', 5), form: 'issue' }, book('left', 40), book()];
    const row = displayRow(books);
    for (let pos = 0; pos <= books.length - 1; pos += 0.01) {
      const shown = displayScrubbed(pos, books.length);
      const places = placeDisplay(books, row, pos, shown, [], false);
      const at = places[shown.index];
      places.forEach((place, j) => {
        if (j === shown.index) return;
        // Every other book stands where it stands at rest, spine out on the line.
        expect(Math.abs(place.yaw)).toBe(90);
        expect(place.z).toBeCloseTo(-books[j].width / 2);
        expect(shelfOverlap(books[shown.index], at, books[j], place)).toBe(0);
      });
      if (Math.abs(at.yaw) < 89.99) {
        const proud = Math.max(...[shown.index - 1, shown.index + 1].filter((j) => j >= 0 && j < books.length).map((j) => shelvedProud(books[j])));
        const c = Math.cos(rad(at.yaw));
        const s = Math.sin(rad(at.yaw));
        const b = books[shown.index];
        for (const i of [-1, 1]) for (const k of [-1, 1]) expect(at.z - (i * b.width * s) / 2 + (k * b.depth * c) / 2).toBeGreaterThan(proud);
      }
    }
  });

  test('the books beside it settle into its gap evenly, even as the swipe nears one of them', () => {
    expect(displaySettles(6, 2.3, { index: 2, amount: 1 }, false)).toEqual([0, DISPLAY.settle, 0, -DISPLAY.settle, 0, 0]);
    expect(displaySettles(6, 2.3, { index: 2, amount: 1 })[3]).toBe(0);
  });
});

describe('the knocks', () => {
  /** Eight spines out, the shelf on the sixth, every book where it stands at rest. */
  const row = () => Array.from({ length: 8 }, (_, i) => ({ x: i * 31, z: -65, yaw: 90, ink: 1 }));
  const dt = 1 / 60;

  test('a spine shoved to make room leans back against the push, swings past upright, and comes to rest', () => {
    const knocks = restingKnocks(8);
    const places = row();
    stepKnocks(knocks, places, 5, dt);
    let back = 0;
    for (let f = 0; f < 12; f++) {
      places[6] = { ...places[6], x: places[6].x + 3 };
      stepKnocks(knocks, places, 5, dt);
      back = Math.min(back, knocks.lean[6]);
    }
    expect(back).toBeLessThan(-1);
    expect(back).toBeGreaterThanOrEqual(-KNOCK.max);
    let past = 0;
    let rest = false;
    for (let f = 0; f < 600 && !rest; f++) {
      rest = stepKnocks(knocks, places, 5, dt);
      past = Math.max(past, knocks.lean[6]);
    }
    expect(past).toBeGreaterThan(0.2);
    expect(rest).toBe(true);
    expect(knocks.lean.every((lean) => lean === 0)).toBe(true);
  });

  test('the knock runs on to the books beside it', () => {
    const knocks = restingKnocks(8);
    const places = row();
    stepKnocks(knocks, places, 5, dt);
    let reached = 0;
    for (let f = 0; f < 40; f++) {
      if (f < 12) places[6] = { ...places[6], x: places[6].x + 3 };
      stepKnocks(knocks, places, 5, dt);
      reached = Math.max(reached, Math.abs(knocks.lean[7]));
    }
    expect(reached).toBeGreaterThan(0.2);
  });

  test("the row's own slide knocks nothing", () => {
    const knocks = restingKnocks(8);
    let places = row();
    stepKnocks(knocks, places, 5, dt);
    for (let f = 0; f < 30; f++) {
      places = places.map((p) => ({ ...p, x: p.x + 4 }));
      expect(stepKnocks(knocks, places, 5, dt)).toBe(true);
    }
    expect(knocks.lean.every((lean) => lean === 0)).toBe(true);
  });

  test('the book turned to the reader is not shoved however it moves', () => {
    const knocks = restingKnocks(8);
    const places = row();
    places[5] = { ...places[5], ink: 0 };
    stepKnocks(knocks, places, 5, dt);
    for (let f = 0; f < 20; f++) {
      places[5] = { ...places[5], x: places[5].x + 5 };
      stepKnocks(knocks, places, 5, dt);
    }
    expect(knocks.lean.every((lean) => lean === 0)).toBe(true);
  });

  test('a leaning book tips on the edge of its foot, at whatever turn it stands', () => {
    // Spine out, the edge of its foot it leans toward stays on the shelf where it stood.
    const upright = { x: 0, z: -65, yaw: 90, ink: 1 };
    const tipped = leanedPlace(upright, book(), 3);
    expect(bookPoint(tipped, 0, 0, book().depth / 2).x).toBeCloseTo(book().depth / 2);
    expect(bookPoint(tipped, 0, 0, book().depth / 2).y).toBeCloseTo(0);
    for (const yaw of [90, 99, -81]) {
      const b = book();
      const place = { x: 0, z: -65, yaw, ink: 1 };
      const leaning = leanedPlace(place, b, 3);
      const run = b.width * Math.abs(Math.cos(rad(yaw))) + b.depth * Math.abs(Math.sin(rad(yaw)));
      expect(leaning.roll).toBe(3);
      expect(leaning.y).toBeCloseTo((run / 2) * Math.sin(rad(3)));
      expect(leaning.x).toBeCloseTo((run / 2) * (1 - Math.cos(rad(3))));
      // Its head goes the way it leans.
      expect(bookPoint(leaning, 0, b.height, 0).x).toBeGreaterThan(b.height * Math.sin(rad(2.9)));
    }
  });
});
