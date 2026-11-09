import { describe, expect, test } from 'bun:test';

import { glowFromTones, liftGlow, oneOfAFew, tonesFromPixels } from './cover-glow';

/** A `width` x `height` RGBA picture, each row coloured by `rowColour`. */
const picture = (width: number, height: number, rowColour: (y: number) => [number, number, number]) => {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) px.set([...rowColour(y), 255], (y * width + x) * 4);
  }
  return px;
};

describe('tonesFromPixels', () => {
  test('a flat cover is the same colour top and bottom', () => {
    const tones = tonesFromPixels(picture(12, 18, () => [200, 120, 60]), 12, 18);
    expect(tones).toEqual({ top: [200, 120, 60], bottom: [200, 120, 60] });
  });

  test('the top tone comes from the top band and the bottom tone from the bottom band', () => {
    const tones = tonesFromPixels(picture(12, 18, (y) => (y < 3 ? [255, 0, 0] : y >= 15 ? [0, 0, 255] : [0, 255, 0])), 12, 18)!;
    expect(tones.top).toEqual([255, 0, 0]);
    expect(tones.bottom).toEqual([0, 0, 255]);
  });

  test('a band is the average across it', () => {
    const tones = tonesFromPixels(picture(1, 25, (y) => (y % 2 ? [100, 100, 100] : [200, 200, 200])), 1, 25)!; // a 4-row band
    for (const c of tones.top) expect(c).toBeCloseTo(150, 0);
  });

  test('rejects an empty or short picture', () => {
    expect(tonesFromPixels(new Uint8Array(0), 0, 0)).toBeNull();
    expect(tonesFromPixels(new Uint8Array(8), 12, 18)).toBeNull();
  });
});

describe('glowFromTones', () => {
  test('the foot is the bottom colour; the rim is the top colour lifted toward white', () => {
    const glow = glowFromTones([200, 40, 120], [30, 60, 160]);
    expect(glow.foot).toBe('rgb(30,60,160)');
    const [r, g, b] = glow.rim.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(40);
    expect(b).toBeGreaterThan(120);
    expect(r).toBeGreaterThan(g); // still pink
  });
});

describe('liftGlow', () => {
  test('carries the pictures\' alpha in each colour', () => {
    expect(liftGlow({ rim: 'rgb(200,180,190)', foot: 'rgb(12,34,56)', picture: 'blob:x' })).toEqual({
      rim: 'rgba(200,180,190,0.3)',
      foot: 'rgba(12,34,56,0.3)',
    });
  });
});

describe('oneOfAFew', () => {
  test('runs no more than three at once, and runs them all', async () => {
    let now = 0;
    let peak = 0;
    const done = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        oneOfAFew(async () => {
          now++;
          peak = Math.max(peak, now);
          await new Promise((r) => setTimeout(r, 2));
          now--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(done).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('a failing task frees its place', async () => {
    await expect(oneOfAFew(async () => Promise.reject(new Error('decode failed')))).rejects.toThrow('decode failed');
    expect(await oneOfAFew(async () => 'next')).toBe('next');
  });
});
