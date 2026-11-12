/**
 * How the shelf's frames went over a stretch of them. `offered` is how fast the display handed
 * frames over and `perSecond` how fast they were drawn: the difference is `skipped`, the frames
 * that went by because the last was still in hand. `script` is what a frame took to draw on the
 * JS thread and `gpu` how long after that the GPU was done with it (each a mean, with its worst),
 * in milliseconds. Between them they say which of three things holds a shelf back: a display that
 * is not offering frames, a hand-off that is missing them, or a GPU that is slow with them.
 */
export type FrameReport = {
  frames: number;
  perSecond: number;
  offered: number;
  script: number;
  worst: number;
  skipped: number;
  gpu?: { mean: number; worst: number };
};

/** A stretch of the shelf's frames, counted as they are drawn. Pure, so it can be tested. */
export class FrameStats {
  private frames = 0;
  private script = 0;
  private worst = 0;
  private skipped = 0;
  private from = 0;
  private to = 0;
  private gpu = { count: 0, sum: 0, worst: 0 };

  /** A frame drawn at `at` milliseconds on the display's clock, which took `script` milliseconds
   *  to draw, with `skipped` of the display's frames gone by since the one before it. */
  add(at: number, script: number, skipped: number) {
    if (!this.frames) this.from = at;
    this.to = at;
    this.frames += 1;
    this.script += script;
    this.worst = Math.max(this.worst, script);
    this.skipped += skipped;
  }

  /** A frame the GPU was done with `after` milliseconds from being handed it. */
  addGpu(after: number) {
    this.gpu.count += 1;
    this.gpu.sum += after;
    this.gpu.worst = Math.max(this.gpu.worst, after);
  }

  /** How long the stretch has run, in milliseconds. */
  get span() {
    return this.to - this.from;
  }

  /** The stretch so far, and a new one begun; nothing where no frame was drawn in it. */
  take(): FrameReport | null {
    const { frames, script, worst, skipped, span, gpu } = this;
    this.frames = this.script = this.worst = this.skipped = 0;
    this.gpu = { count: 0, sum: 0, worst: 0 };
    if (!frames) return null;
    // Frames stand at both ends of the span, so there is one fewer gap than frames.
    const rate = (count: number) => (span > 0 ? ((count - 1) * 1000) / span : 0);
    return {
      frames,
      perSecond: rate(frames),
      offered: rate(frames + skipped),
      script: script / frames,
      worst,
      skipped,
      ...(gpu.count ? { gpu: { mean: gpu.sum / gpu.count, worst: gpu.worst } } : {}),
    };
  }
}

export function describeFrames({ frames, perSecond, offered, script, worst, skipped, gpu }: FrameReport): string {
  const drawn = `${frames} frames, ${Math.round(perSecond)} a second of ${Math.round(offered)} offered (${skipped} skipped)`;
  const cost = `script ${script.toFixed(2)} ms (worst ${worst.toFixed(2)})`;
  return [drawn, cost, ...(gpu ? [`GPU ${gpu.mean.toFixed(1)} ms (worst ${gpu.worst.toFixed(1)})`] : [])].join(', ');
}
