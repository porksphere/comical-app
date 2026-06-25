import { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

import type { ChipItem, ChipTone } from './filter-types';

const GAP = 6;
const PLUS_RESERVE = 46; // room kept for the "+X" chip

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  include: { bg: 'rgba(52,120,246,0.16)', fg: '#3478F6' },
  exclude: { bg: 'rgba(229,72,77,0.16)', fg: '#E5484D' },
  neutral: { bg: 'rgba(128,128,128,0.16)', fg: '#8E8E93' },
};

function Chip({
  label,
  tone,
  onMeasure,
}: {
  label: string;
  tone: ChipTone;
  onMeasure?: (w: number) => void;
}) {
  const t = TONES[tone];
  return (
    <View
      onLayout={onMeasure ? (e: LayoutChangeEvent) => onMeasure(e.nativeEvent.layout.width) : undefined}
      style={[styles.chip, { backgroundColor: t.bg }]}>
      <ThemedText type="small" numberOfLines={1} style={{ color: t.fg }}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * Renders as many chips as fit on one line; the rest collapse into a "+X" chip.
 * Measures the container and each chip via onLayout, then computes the cut-off.
 */
export function OverflowChips({ items, empty }: { items: ChipItem[]; empty: string }) {
  const [containerW, setContainerW] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});

  // Re-measure when the chip set changes.
  const signature = items.map((i) => i.key).join('|');
  useEffect(() => {
    setWidths({});
  }, [signature]);

  const measured = items.length > 0 && items.every((i) => widths[i.key] != null);

  let visible = items.length;
  if (measured && containerW > 0) {
    let used = 0;
    visible = 0;
    for (let i = 0; i < items.length; i++) {
      const candidate = used + (i > 0 ? GAP : 0) + widths[items[i].key];
      const reserve = i < items.length - 1 ? GAP + PLUS_RESERVE : 0;
      if (candidate + reserve <= containerW) {
        used = candidate;
        visible = i + 1;
      } else {
        break;
      }
    }
    if (visible === 0) visible = 1; // always show at least one
  }
  const hidden = items.length - visible;

  if (items.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
        {empty}
      </ThemedText>
    );
  }

  return (
    <View style={styles.container} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      {/* Hidden measuring pass */}
      {!measured && (
        <View style={styles.measure} pointerEvents="none">
          {items.map((it) => (
            <Chip
              key={it.key}
              label={it.label}
              tone={it.tone}
              onMeasure={(w) => setWidths((prev) => ({ ...prev, [it.key]: w }))}
            />
          ))}
        </View>
      )}
      <View style={styles.row}>
        {items.slice(0, visible).map((it) => (
          <Chip key={it.key} label={it.label} tone={it.tone} />
        ))}
        {hidden > 0 && <Chip label={`+${hidden}`} tone="neutral" />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 0,
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    opacity: 0,
    flexDirection: 'row',
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
    justifyContent: 'flex-end',
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 6,
  },
  empty: {
    alignSelf: 'flex-end',
  },
});

