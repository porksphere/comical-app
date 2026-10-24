import { IntStepper } from '@/components/reader/int-stepper';

// A bounded number chosen along a track. This is the NATIVE fallback: the stops counted out on the
// platform's own integer control, since no row that holds one is reachable there today (the only
// one is the Keyboard screen, which is web's). Web draws a real track — see the `.web.tsx` sibling.

export type RangeSliderProps = {
  value: number;
  min: number;
  max: number;
  /** The distance between stops; the value is always one of them. */
  step: number;
  onChange: (value: number) => void;
  /** The value as it reads beside the track. */
  format: (value: number) => string;
  /** `<prefix>.value` names the number, `<prefix>.track` the control. */
  testIdPrefix: string;
};

export function RangeSlider({ value, min, max, step, onChange, testIdPrefix }: RangeSliderProps) {
  const stops = Math.round((max - min) / step);
  return (
    <IntStepper
      value={Math.round((value - min) / step)}
      min={0}
      max={stops}
      onChange={(i) => onChange(min + i * step)}
      testIdPrefix={testIdPrefix}
    />
  );
}
