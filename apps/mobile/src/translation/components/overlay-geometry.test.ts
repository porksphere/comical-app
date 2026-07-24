/**
 * Overlay coordinate mapping. Pinned: fit-page letterboxing (the image centers inside the
 * container, bars on the shorter axis) and fit-width scaling (webtoon rows), because a
 * regression here paints every bubble off its speech balloon.
 */
import { describe, expect, test } from 'bun:test';
import { mapRegionToView } from './overlay-geometry';

describe('mapRegionToView', () => {
  test('contain: portrait page in a taller container letterboxes vertically', () => {
    // 1000x2000 image in a 400x900 box: s = min(0.4, 0.45) = 0.4 → content 400x800, oy = 50.
    const frame = { imageWidth: 1000, imageHeight: 2000 };
    const mapped = mapRegionToView({ x: 100, y: 200, w: 250, h: 100 }, frame, 400, 900, 'contain');
    expect(mapped).toEqual({ x: 40, y: 130, w: 100, h: 40 });
  });

  test('contain: landscape image letterboxes horizontally', () => {
    // 2000x1000 in 400x900: s = min(0.2, 0.9) = 0.2 → content 400x200 centered → oy = 350.
    const frame = { imageWidth: 2000, imageHeight: 1000 };
    const mapped = mapRegionToView({ x: 0, y: 0, w: 2000, h: 1000 }, frame, 400, 900, 'contain');
    expect(mapped).toEqual({ x: 0, y: 350, w: 400, h: 200 });
  });

  test('width: scales by width only, no offsets', () => {
    const frame = { imageWidth: 800, imageHeight: 3200 };
    const mapped = mapRegionToView({ x: 400, y: 1600, w: 80, h: 40 }, frame, 400, 0, 'width');
    expect(mapped).toEqual({ x: 200, y: 800, w: 40, h: 20 });
  });

  test('rejects degenerate frames and sub-2pt results', () => {
    expect(mapRegionToView({ x: 0, y: 0, w: 10, h: 10 }, { imageWidth: 0, imageHeight: 10 }, 400, 900, 'contain')).toBeNull();
    // 1px-wide region at 0.4 scale → 0.4pt — not worth a bubble.
    expect(
      mapRegionToView({ x: 0, y: 0, w: 1, h: 100 }, { imageWidth: 1000, imageHeight: 2000 }, 400, 900, 'contain'),
    ).toBeNull();
  });
});
