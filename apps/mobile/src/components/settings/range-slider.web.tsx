import { useEffect, type CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';

import { snapToStep, type RangeSliderProps } from '@/components/settings/range-slider-shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

export type { RangeSliderProps } from '@/components/settings/range-slider-shared';

// Web: the browser's range input, restyled rather than replaced. It already drags, steps on the
// arrow keys, and reads to a screen reader as a slider, and none of that has to be rebuilt; only
// its drawing is ours. A thin track in the row's hairline with the accent filled up to the thumb
// (a gradient split at the value, since CSS has no "filled part" of a range in WebKit/Blink), and
// a white round thumb with the soft shadow the system slider has, growing a touch under the
// pointer and ringed in the accent when the keyboard focuses it. The engines style thumb and track
// through separate vendor pseudo-elements, so each rule is written twice.
const TRACK_WIDTH = 160;
const TRACK_HEIGHT = 4;
const THUMB = 18;
const SHADOW = '0 0.5px 2px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.18)';

const CLASS = 'comical-range';
const STYLE_ID = 'comical-range-style';
const css = `
.${CLASS} {
  -webkit-appearance: none;
  appearance: none;
  width: ${TRACK_WIDTH}px;
  height: ${THUMB + 6}px;
  margin: 0;
  padding: 0;
  background: transparent;
  outline: none;
  cursor: pointer;
  touch-action: pan-y;
}
.${CLASS}::-webkit-slider-runnable-track {
  height: ${TRACK_HEIGHT}px;
  border-radius: ${TRACK_HEIGHT / 2}px;
  background: linear-gradient(to right, var(--fill) 0, var(--fill) var(--at), var(--track) var(--at), var(--track) 100%);
}
.${CLASS}::-moz-range-track {
  height: ${TRACK_HEIGHT}px;
  border-radius: ${TRACK_HEIGHT / 2}px;
  background: var(--track);
}
.${CLASS}::-moz-range-progress {
  height: ${TRACK_HEIGHT}px;
  border-radius: ${TRACK_HEIGHT / 2}px;
  background: var(--fill);
}
.${CLASS}::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: ${THUMB}px;
  height: ${THUMB}px;
  margin-top: ${(TRACK_HEIGHT - THUMB) / 2}px;
  border: none;
  border-radius: 50%;
  background: var(--thumb);
  box-shadow: ${SHADOW};
  transition: transform 120ms ease-out, box-shadow 120ms ease-out;
}
.${CLASS}::-moz-range-thumb {
  width: ${THUMB}px;
  height: ${THUMB}px;
  border: none;
  border-radius: 50%;
  background: var(--thumb);
  box-shadow: ${SHADOW};
  transition: transform 120ms ease-out, box-shadow 120ms ease-out;
}
.${CLASS}:hover::-webkit-slider-thumb, .${CLASS}:active::-webkit-slider-thumb { transform: scale(1.12); }
.${CLASS}:hover::-moz-range-thumb, .${CLASS}:active::-moz-range-thumb { transform: scale(1.12); }
.${CLASS}:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--ring), ${SHADOW}; }
.${CLASS}:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--ring), ${SHADOW}; }
`;

/** The stylesheet above, in the document once, however many sliders mount. */
function useRangeStyle() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }, []);
}

export function RangeSlider({ value, min, max, step, onChange, format, testIdPrefix }: RangeSliderProps) {
  const theme = useTheme();
  useRangeStyle();
  // The fill ends under the thumb's CENTRE, which the browser keeps a half-thumb inside either end
  // of the track — so the split runs over the track less one thumb, offset by half of one.
  const t = (value - min) / (max - min);
  const at = `calc(${THUMB / 2}px + ${t} * (100% - ${THUMB}px))`;
  const vars = {
    '--fill': theme.accent,
    '--track': theme.backgroundSelected,
    '--thumb': '#ffffff',
    '--ring': `${theme.accent}66`,
    '--at': at,
  } as CSSProperties;
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={styles.value}>
        {format(value)}
      </ThemedText>
      <input
        className={CLASS}
        data-testid={testId(testIdPrefix, 'track')}
        aria-valuetext={format(value)}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(snapToStep(Number(e.currentTarget.value), min, max, step))}
        style={vars}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  value: {
    minWidth: 40,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
