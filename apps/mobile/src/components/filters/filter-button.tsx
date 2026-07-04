import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAnchoredOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

import { FilterEditor } from './filter-editors';
import {
  CONTROL_HEIGHT,
  CONTROL_RADIUS,
  emptyText,
  summarize,
  type FilterDef,
  type FilterValue,
} from './filter-types';
import { OverflowChips } from './overflow-chips';

/**
 * A filter row: shows the filter's label and a summary of the current value as
 * chips (included = blue, excluded = red), collapsing overflow into "+X". Tapping
 * opens the matching editor in an overlay. The same row is used both inline on the
 * filter bar and stacked in the overflow sheet, so they read identically.
 *
 * `onChange` takes the filter's own id (rather than the caller binding it into a
 * fresh closure per filter) so `React.memo` below actually holds: with a stable
 * `onChange` reference from the caller, only the one row whose own `value`
 * changed re-renders, not every filter in the bar.
 */
export const FilterButton = memo(function FilterButton({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (id: string, v: FilterValue) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, handlers } = useHover();
  const theme = useTheme();
  const chips = summarize(def, value);
  return (
    <Pressable
      ref={ref}
      {...handlers}
      onPress={() =>
        openAt(() => <FilterEditor def={def} value={value} onChange={(v) => onChange(def.id, v)} />)
      }>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={styles.label}>{def.label}</ThemedText>
        <View style={styles.summary}>
          <OverflowChips items={chips} empty={emptyText(def)} />
        </View>
        <ThemedText themeColor="textSecondary">{'›'}</ThemedText>
      </ThemedView>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: CONTROL_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: CONTROL_RADIUS,
  },
  label: {
    flexShrink: 0,
  },
  summary: {
    flex: 1,
    minWidth: 0,
  },
});
