import { describe, expect, test } from 'bun:test';

import { FrameStats, describeFrames } from './frame-stats';

describe('the shelf’s frame stats', () => {
  test('report a stretch of frames', () => {
    const stats = new FrameStats();
    // Five frames a 120th of a second apart, one of them slow, one display frame missed.
    [0.4, 0.5, 2.1, 0.4, 0.6].forEach((script, n) => stats.add(1000 + (n * 1000) / 120, script, n === 3 ? 1 : 0));
    const report = stats.take()!;
    expect(report.frames).toBe(5);
    expect(report.perSecond).toBeCloseTo(120, 5);
    expect(report.script).toBeCloseTo(0.8, 5);
    expect(report.worst).toBe(2.1);
    expect(report.skipped).toBe(1);
  });

  test('begin afresh once taken', () => {
    const stats = new FrameStats();
    stats.add(0, 1, 2);
    stats.add(10, 3, 0);
    expect(stats.span).toBe(10);
    stats.take();
    expect(stats.take()).toBeNull();
    stats.add(500, 0.25, 0);
    expect(stats.take()).toEqual({ frames: 1, perSecond: 0, script: 0.25, worst: 0.25, skipped: 0 });
  });

  test('read as one line', () => {
    expect(describeFrames('direct', { frames: 143, perSecond: 118.4, script: 0.416, worst: 1.308, skipped: 2 })).toBe(
      'direct: 143 frames at 118 a second, 0.42 ms of script each (worst 1.31), 2 skipped',
    );
  });
});
