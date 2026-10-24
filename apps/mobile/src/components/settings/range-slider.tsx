import { IntStepper } from '@/components/reader/int-stepper';
import { snapToStep, type RangeSliderProps } from '@/components/settings/range-slider-shared';

// A bounded number chosen along a track: the system slider on iOS and Android (the `.ios.tsx` and
// `.android.tsx` siblings), a restyled range input on web (`.web.tsx`). This is the fallback for any
// other platform: the stops counted out on the integer stepper.

export type { RangeSliderProps } from '@/components/settings/range-slider-shared';

export function RangeSlider({ value, min, max, step, onChange, testIdPrefix }: RangeSliderProps) {
  const stops = Math.round((max - min) / step);
  return (
    <IntStepper
      value={Math.round((value - min) / step)}
      min={0}
      max={stops}
      onChange={(i) => onChange(snapToStep(min + i * step, min, max, step))}
      testIdPrefix={testIdPrefix}
    />
  );
}
