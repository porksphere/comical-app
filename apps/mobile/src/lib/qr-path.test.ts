import { describe, expect, test } from 'bun:test';

import { qrPath } from './qr-path';

describe('qrPath', () => {
  test('draws a square symbol whose corners are finder patterns', () => {
    const { size, d } = qrPath('http://10.0.0.5:3130/abcdefghjkmn');
    expect(size).toBe(29);
    // A finder pattern starts with a 7-module dark run on its first row, at both top corners.
    expect(d.startsWith('M0 0h7v1h-7z')).toBe(true);
    expect(d).toContain(`M${size - 7} 0h7v1h-7z`);
  });

  test('merges a row of dark modules into one rectangle', () => {
    const { d } = qrPath('a');
    // No two rects in the same row share an edge: every run is as long as it can be.
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => ({ x: +m[1]!, y: +m[2]!, w: +m[3]! }));
    for (let i = 1; i < runs.length; i++) {
      const prev = runs[i - 1]!;
      const run = runs[i]!;
      if (prev.y === run.y) expect(run.x).toBeGreaterThan(prev.x + prev.w);
    }
  });
});
