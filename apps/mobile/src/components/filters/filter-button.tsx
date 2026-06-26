import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

import { FilterEditor } from './filter-editors';
import { emptyText, summarize, type FilterDef, type FilterValue } from './filter-types';
import { OverflowChips } from './overflow-chips';

const CHIP_HEIGHT = 36;

/**
 * A filter control. In the default (sheet) layout it's a full-width row: label +
 * a summary of the current value as chips (included = blue, excluded = red) +
 * a chevron. In `compact` layout it's a self-sizing pill for the filter bar.
 * Either way, tapping opens the matching editor in an overlay.
 *
 * `onMeasure` reports the rendered width (used by the bar's measuring pass to
 * decide how many compact chips fit on one line).
 */
export function FilterButton({
  def,
  value,
  onChange,
  compact,
  onMeasure,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  compact?: boolean;
  onMeasure?: (w: number) => void;
}) {
  const { open } = useOverlay();
  const chips = summarize(def, value);
  const openEditor = () => open(() => <FilterEditor def={def} value={value} onChange={onChange} />);

  if (compact) {
    // Condense the value to a single line: "First +N" (or "Any"/"None").
    const summary =
      chips.length === 0
        ? emptyText(def)
        : chips.length === 1
          ? chips[0].label
          : `${chips[0].label} +${chips.length - 1}`;
    return (
      <Pressable
        onPress={openEditor}
        onLayout={onMeasure ? (e: LayoutChangeEvent) => onMeasure(e.nativeEvent.layout.width) : undefined}>
        <ThemedView type="backgroundElement" style={styles.chip}>
          <ThemedText type="small">{def.label}</ThemedText>
          <ThemedView type="backgroundSelected" style={styles.chipValue}>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {summary}
            </ThemedText>
          </ThemedView>
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={openEditor}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText style={styles.label}>{def.label}</ThemedText>
        <View style={styles.summary}>
          <OverflowChips items={chips} empty={emptyText(def)} />
        </View>
        <ThemedText themeColor="textSecondary">{'›'}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  label: {
    flexShrink: 0,
  },
  summary: {
    flex: 1,
    minWidth: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: CHIP_HEIGHT,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    borderRadius: Spacing.five,
  },
  chipValue: {
    maxWidth: 140,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    borderRadius: Spacing.four,
  },
});
