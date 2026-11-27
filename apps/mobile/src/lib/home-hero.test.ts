import { describe, expect, test } from 'bun:test';

import {
  HERO_WIDE_FROM,
  draggedPosition,
  fitCover,
  heroIsWide,
  keptFront,
  lonePlace,
  posterBookBox,
  posterPlace,
  posterStep,
  posterReach,
  restingPosition,
  splashArtHeight,
  splashLayerOpacity,
  wideHeroHeight,
} from '@/lib/home-hero';

describe('splashArtHeight', () => {
  test('a cover that bleeds under the bar is whole at the stage width, less what the bar hides', () => {
    // 390 / (2/3) = 585 from the top of the window, 100 of it above the feed's content.
    expect(splashArtHeight({ width: 390, windowHeight: 1000, top: 100, bleed: 100 })).toBe(485);
  });

  test('a cover that starts against the bar is whole where the window has the height', () => {
    expect(splashArtHeight({ width: 390, windowHeight: 1000, top: 100, bleed: 0 })).toBe(585);
    // 8 of it in the gap under the bar.
    expect(splashArtHeight({ width: 390, windowHeight: 1000, top: 100, bleed: 8 })).toBe(577);
  });

  test('it stops short of the bottom of the window, so the first rail shows', () => {
    // 844 × 0.72 = 607.68 down the window, 100 of it the bar.
    expect(splashArtHeight({ width: 390, windowHeight: 844, top: 100, bleed: 0 })).toBe(508);
  });

  test('a short window still gets a cover', () => {
    expect(splashArtHeight({ width: 390, windowHeight: 380, top: 100, bleed: 0 })).toBe(300);
  });
});

describe('wide heroes', () => {
  test('the wide layout starts at its width', () => {
    expect(heroIsWide(HERO_WIDE_FROM - 1)).toBe(false);
    expect(heroIsWide(HERO_WIDE_FROM)).toBe(true);
  });

  test('about half the window, within its bounds', () => {
    expect(wideHeroHeight(800)).toBe(416);
    expect(wideHeroHeight(400)).toBe(340);
    expect(wideHeroHeight(1600)).toBe(480);
  });
});

describe('posterBookBox', () => {
  test('a little over half a phone, at a volume’s shape', () => {
    expect(posterBookBox(390)).toEqual({ width: 215, height: 323 });
  });

  test('capped on a wide phone and floored on a narrow one', () => {
    expect(posterBookBox(680).width).toBe(240);
    expect(posterBookBox(200).width).toBe(150);
  });

  test('in a wide hero it is what the height leaves', () => {
    expect(posterBookBox(1025, 460)).toEqual({ width: 253, height: 380 });
  });
});

describe('fitCover', () => {
  const box = { width: 216, height: 324 };

  test('a taller cover takes the height', () => {
    expect(fitCover(0.6, box)).toEqual({ width: 194, height: 324 });
  });

  test('a wider cover takes the width', () => {
    expect(fitCover(1, box)).toEqual({ width: 216, height: 216 });
  });
});

describe('posterStep', () => {
  test('half the front book, half a side one, and the gap in points', () => {
    expect(posterStep(150)).toBeCloseTo(1);
    expect(posterStep(250)).toBeCloseTo(0.96);
  });

  test('the side book stands clear of the front one at every width', () => {
    for (const bookWidth of [150, 176, 215, 240, 253]) {
      const { x, scale } = posterPlace(1, false, posterStep(bookWidth));
      // The side book's near edge, less the front book's far one, in points.
      expect((x - scale / 2 - 0.5) * bookWidth).toBeCloseTo(15);
    }
  });
});

describe('posterPlace', () => {
  const step = posterStep(250);

  test('the front book is whole and where it stands', () => {
    for (const wide of [false, true]) expect(posterPlace(0, wide, step)).toEqual({ x: 0, scale: 1, opacity: 1 });
  });

  test('on a phone the row is the same either way', () => {
    const before = posterPlace(-1, false, step);
    const after = posterPlace(1, false, step);
    expect(before.x).toBe(-after.x);
    expect(before.opacity).toBe(after.opacity);
    expect(after.x).toBeCloseTo(0.96);
    expect(after.scale).toBeCloseTo(0.8);
    expect(after.opacity).toBeCloseTo(0.55);
  });

  test('the books past the first stand closer, between two small ones', () => {
    expect(posterPlace(2, false, step).x).toBeCloseTo(1.78);
    expect(posterPlace(-2, false, step).x).toBeCloseTo(-1.78);
  });

  test('a wide hero’s row runs on to the right and a passed book is gone', () => {
    expect(posterPlace(-1, true, step).opacity).toBe(0);
    expect(posterPlace(-0.5, true, step).opacity).toBeCloseTo(0.5);
    expect(posterPlace(1, true, step).x).toBeCloseTo(0.96);
    expect(posterPlace(2, true, step).x).toBeCloseTo(1.78);
    expect(posterPlace(2, true, step).opacity).toBeCloseTo(0.36);
  });

  test('nothing past its reach is drawn', () => {
    for (const wide of [false, true]) {
      expect(posterPlace(posterReach(wide), wide, step).opacity).toBe(0);
      expect(posterPlace(posterReach(wide) + 2, wide, step).opacity).toBe(0);
    }
  });
});

describe('lonePlace', () => {
  test('the one book is whole in front and gone a place away', () => {
    expect(lonePlace(0)).toEqual({ x: 0, scale: 1, opacity: 1 });
    expect(lonePlace(0.5).opacity).toBeCloseTo(0.5);
    expect(lonePlace(-1).opacity).toBe(0);
    expect(lonePlace(3).opacity).toBe(0);
  });
});

describe('splashLayerOpacity', () => {
  test('the cover at the position and those under it are whole', () => {
    expect(splashLayerOpacity(2, 2)).toBe(1);
    expect(splashLayerOpacity(1, 2)).toBe(1);
  });

  test('the next one fades in over it as the position moves on', () => {
    expect(splashLayerOpacity(3, 2)).toBe(0);
    expect(splashLayerOpacity(3, 2.25)).toBeCloseTo(0.25);
    expect(splashLayerOpacity(3, 3)).toBe(1);
  });
});

describe('draggedPosition', () => {
  test('as asked between the ends', () => {
    expect(draggedPosition(1.4, 5)).toBe(1.4);
  });

  test('held back past them', () => {
    expect(draggedPosition(-1, 5)).toBeCloseTo(-0.3);
    expect(draggedPosition(5, 5)).toBeCloseTo(4.3);
  });
});

describe('restingPosition', () => {
  const rest = (position: number, velocity: number, reach = 1) => restingPosition({ from: 2, position, velocity, count: 5, reach });

  test('a slow drag rests on the nearest series', () => {
    expect(rest(2.3, 0)).toBe(2);
    expect(rest(2.6, 0)).toBe(3);
  });

  test('a flick carries on to the next', () => {
    expect(rest(2.2, 3)).toBe(3);
    expect(rest(1.9, -3)).toBe(1);
  });

  test('no further than its reach from where it began', () => {
    expect(rest(2.4, 40)).toBe(3);
    expect(rest(2.4, 40, 3)).toBe(4);
  });

  test('never past an end', () => {
    expect(restingPosition({ from: 4, position: 4.2, velocity: 9, count: 5, reach: 1 })).toBe(4);
    expect(restingPosition({ from: 0, position: -0.2, velocity: -9, count: 5, reach: 1 })).toBe(0);
    expect(restingPosition({ from: 0, position: 0, velocity: 0, count: 0, reach: 1 })).toBe(0);
  });
});

describe('keptFront', () => {
  test('until the reader has moved it, a new set opens where it opens', () => {
    expect(keptFront({ keys: ['a', 'b', 'c'], index: 1, moved: false }, ['x', 'b', 'c'], 0)).toEqual({ index: 0, moved: false });
  });

  test('a series the reader brought forward is kept wherever it now stands', () => {
    expect(keptFront({ keys: ['a', 'b', 'c'], index: 1, moved: true }, ['c', 'x', 'b'], 0)).toEqual({ index: 2, moved: true });
  });

  test('one that has gone gives way to where the set opens', () => {
    expect(keptFront({ keys: ['a', 'b', 'c'], index: 1, moved: true }, ['a', 'c'], 0)).toEqual({ index: 0, moved: false });
  });

  test('where it opens is inside the set', () => {
    expect(keptFront({ keys: [], index: 0, moved: false }, ['a', 'b'], 7)).toEqual({ index: 1, moved: false });
    expect(keptFront({ keys: ['a'], index: 0, moved: false }, [], 3)).toEqual({ index: 0, moved: false });
  });
});
