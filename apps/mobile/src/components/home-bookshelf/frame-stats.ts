/** How the shelf's frames went over a stretch of them: how many were drawn and how fast they came,
 *  the script each took to draw (its mean and its worst, in milliseconds), and how many of the
 *  display's frames went by undrawn because the last was still in hand. */
export type FrameReport = { frames: number; perSecond: number; script: number; worst: number; skipped: number };

/** A stretch of the shelf's frames, counted as they are drawn. Pure, so it can be tested. */
export class FrameStats {
  private frames = 0;
  private script = 0;
  private worst = 0;
  private skipped = 0;
  private from = 0;
  private to = 0;

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

  /** How long the stretch has run, in milliseconds. */
  get span() {
    return this.to - this.from;
  }

  /** The stretch so far, and a new one begun; nothing where no frame was drawn in it. */
  take(): FrameReport | null {
    const { frames, script, worst, skipped, span } = this;
    this.frames = this.script = this.worst = this.skipped = 0;
    if (!frames) return null;
    // Frames stand at both ends of the span, so there is one fewer gap than frames.
    return { frames, perSecond: span > 0 ? ((frames - 1) * 1000) / span : 0, script: script / frames, worst, skipped };
  }
}

export function describeFrames(renderer: string, { frames, perSecond, script, worst, skipped }: FrameReport): string {
  return `${renderer}: ${frames} frames at ${Math.round(perSecond)} a second, ${script.toFixed(2)} ms of script each (worst ${worst.toFixed(2)}), ${skipped} skipped`;
}
