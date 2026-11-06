import { describe, expect, test } from 'bun:test';

import { glowFromTones, oneOfAFew, tonesFromBlurhash } from './cover-glow';

const BASE83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const encode83 = (value: number, length: number) =>
  Array.from({ length }, (_, i) => BASE83[Math.floor(value / 83 ** (length - 1 - i)) % 83]).join('');

/** A one-column, two-row hash: `dc` the average colour, `ac` the vertical component's quantised
 *  channels (0..18, 9 is none). */
const hash = (dc: [number, number, number], ac: [number, number, number], quantisedMax = 40) =>
  encode83(9, 1) + encode83(quantisedMax, 1) + encode83((dc[0] << 16) + (dc[1] << 8) + dc[2], 4) + encode83(ac[0] * 361 + ac[1] * 19 + ac[2], 2);

describe('tonesFromBlurhash', () => {
  test('a flat cover is the same colour top and bottom', () => {
    const tones = tonesFromBlurhash(hash([200, 120, 60], [9, 9, 9]));
    expect(tones).not.toBeNull();
    expect(tones!.top).toEqual(tones!.bottom);
    for (const [got, want] of tones!.top.map((c, i) => [c, [200, 120, 60][i]])) expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
  });

  test('a vertical component makes the top and bottom differ, in opposite directions', () => {
    // Red rises toward the top (positive first row of the cosine), blue toward the bottom.
    const tones = tonesFromBlurhash(hash([128, 128, 128], [18, 9, 0]))!;
    expect(tones.top[0]).toBeGreaterThan(tones.bottom[0]);
    expect(tones.top[2]).toBeLessThan(tones.bottom[2]);
    expect(Math.abs(tones.top[1] - tones.bottom[1])).toBeLessThanOrEqual(1);
  });

  test('decodes an expo-image default-size hash (4x3) too', () => {
    const sized = encode83(2 * 9 + 3, 1) + encode83(40, 1) + encode83(0x808080, 4) + encode83(9 * 361 + 9 * 19 + 9, 2).repeat(11);
    expect(tonesFromBlurhash(sized)).not.toBeNull();
  });

  test('rejects what is not a hash', () => {
    expect(tonesFromBlurhash('')).toBeNull();
    expect(tonesFromBlurhash('LEHV6nWB2yk8')).toBeNull(); // a real 4x3 hash cut short
    expect(tonesFromBlurhash('9 00000000')).toBeNull();
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
