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
    // One of the display's frames was missed among them, so it offered a quarter more.
    expect(report.offered).toBeCloseTo(150, 5);
    expect(report.gpu).toBeUndefined();
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
    expect(stats.take()).toEqual({ frames: 1, perSecond: 0, offered: 0, script: 0.25, worst: 0.25, skipped: 0 });
  });

  test('time the GPU apart from the script', () => {
    const stats = new FrameStats();
    stats.add(0, 0.5, 0);
    stats.add(8, 0.5, 0);
    stats.addGpu(3);
    stats.addGpu(9);
    expect(stats.take()!.gpu).toEqual({ mean: 6, worst: 9 });
    stats.add(16, 0.5, 0);
    expect(stats.take()!.gpu).toBeUndefined();
  });

  test('read as one line', () => {
    expect(describeFrames('direct', { frames: 143, perSecond: 118.4, offered: 120.1, script: 0.416, worst: 1.308, skipped: 2 })).toBe(
      'direct: 143 frames, 118 a second of 120 offered (2 skipped), script 0.42 ms (worst 1.31)',
    );
    expect(describeFrames('three', { frames: 60, perSecond: 59.6, offered: 60, script: 5.2, worst: 9, skipped: 0, gpu: { mean: 3.14, worst: 11 } })).toBe(
      'three: 60 frames, 60 a second of 60 offered (0 skipped), script 5.20 ms (worst 9.00), GPU 3.1 ms (worst 11.0)',
    );
  });
});
