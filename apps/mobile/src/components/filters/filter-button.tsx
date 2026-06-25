import { Pressable, StyleSheet, View } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

import { FilterEditor } from './filter-editors';
import { emptyText, summarize, type FilterDef, type FilterValue } from './filter-types';
import { OverflowChips } from './overflow-chips';

/**
 * A filter row: shows the filter's label and a summary of the current value as
 * chips (included = blue, excluded = red), collapsing overflow into "+X". Tapping
 * opens the matching editor in an overlay.
 */
export function FilterButton({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const { open } = useOverlay();
  const chips = summarize(def, value);
  return (
    <Pressable onPress={() => open(() => <FilterEditor def={def} value={value} onChange={onChange} />)}>
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
});
