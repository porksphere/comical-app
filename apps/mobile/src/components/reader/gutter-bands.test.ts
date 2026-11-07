import { describe, expect, test } from 'bun:test';

import { edgeColors, halfLayout, spreadColor } from './gutter-bands';

/** A picture `width`×`height`, each pixel the colour `at(x, y)` gives it. */
function picture(width: number, height: number, at: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px.set([...at(x, y), 255], (y * width + x) * 4);
  return px;
}
const W = 40;
const H = 60;
const read = (px: Uint8Array, side: 'left' | 'right' = 'left') => edgeColors(px, W, H, 1, 3, side);

describe("a spread's padding", () => {
  // The half on the left of the screen, its spine at its right.
  test('off, the page meets the spine and nothing is filled', () => {
    expect(halfLayout('right', 'off')).toEqual({ hug: 'right', filled: null });
  });
  test('at the sides, the page meets the spine and its outer side is filled', () => {
    expect(halfLayout('right', 'sides')).toEqual({ hug: 'right', filled: 'left' });
  });
  test("in the middle, the page meets the screen's edge and the gutter is filled", () => {
    expect(halfLayout('right', 'middle')).toEqual({ hug: 'left', filled: 'right' });
    expect(halfLayout('left', 'middle')).toEqual({ hug: 'right', filled: 'left' });
  });
});

describe('the colour a spread is padded with', () => {
  test("is the pages' margin, whatever is drawn in the middle of them", () => {
    const page = picture(W, H, (x) => (x > 6 && x < W - 7 ? [0, 0, 0] : [255, 255, 255]));
    expect(spreadColor([read(page), read(page)])).toBe('#ffffff');
  });

  test('is the most frequent colour along the edges, though a drawing reaches them here and there', () => {
    // White margins, with black artwork running off the edge over a third of the height.
    const page = picture(W, H, (_x, y) => (y < H / 3 ? [0, 0, 0] : [255, 255, 255]));
    expect(spreadColor([read(page), read(page)])).toBe('#ffffff');
  });

  test("is the exact colour of the paper, not its bucket's", () => {
    const page = picture(W, H, (x, y) => [244 + ((x + y) % 3), 240, 230]);
    expect(spreadColor([read(page)])).toBe('#f5f0e6');
  });

  test('is decided across both pages of the spread', () => {
    // One page is black to its edges, the other mostly white: the spread's white outnumbers it.
    const black = picture(W, H, () => [0, 0, 0]);
    const mostlyWhite = picture(W, H, (_x, y) => (y < 10 ? [0, 0, 0] : [255, 255, 255]));
    expect(spreadColor([read(black), read(mostlyWhite)])).toBe('#000000');
    expect(spreadColor([read(mostlyWhite), read(mostlyWhite)])).toBe('#ffffff');
  });

  test('is read from one side of a page at a time', () => {
    // White down the left edge, black down the right.
    const page = picture(W, H, (x) => (x < W / 2 ? [255, 255, 255] : [0, 0, 0]));
    expect(spreadColor([read(page, 'left')])).toBe('#ffffff');
    expect(spreadColor([read(page, 'right')])).toBe('#000000');
  });

  test('is nothing with nothing read', () => {
    expect(spreadColor([null, undefined])).toBeNull();
  });
});
