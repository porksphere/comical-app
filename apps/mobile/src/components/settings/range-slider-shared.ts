// The props every RangeSlider shares, and the stop-snapping each one does. Kept apart from the
// platform files so they can import it by value: `@/components/settings/range-slider` resolves to
// the platform's own file, so importing it from `.web.tsx` would be a cycle.

export type RangeSliderProps = {
  value: number;
  min: number;
  max: number;
  /** The distance between stops; the value is always one of them. */
  step: number;
  onChange: (value: number) => void;
  /** The value as it reads beside the track. */
  format: (value: number) => string;
  /** `<prefix>.value` names the number, `<prefix>.track` the control (web). */
  testIdPrefix: string;
};

/** The stop nearest `v`, so a drag that reports between two never leaves the value off-grid. */
export function snapToStep(v: number, min: number, max: number, step: number): number {
  const snapped = min + Math.round((v - min) / step) * step;
  // Round away the float noise of min + i·step (0.25 steps are exact; 0.1 steps are not).
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals))));
}
