import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterEditor } from '@/components/filters/filter-editors';
import { Spacing } from '@/constants/theme';
import { useFilterSheetSession } from '@/data/filter-sheet';
import { useLocalSearchParams } from '@/lib/nav';

/**
 * One `multi`/`includeExclude`/`tags` filter's editor, pushed inside the filters sheet. The editor
 * is the overlay's own component, rendered without an overlay around it: its list caps and
 * heading fall back to the sheet defaults, and the sheet's own edge is what the keyboard moves.
 */
export default function SearchFilterEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const session = useFilterSheetSession();
  const def = session?.defs.find((d) => d.id === id);
  return (
    <View style={[styles.body, { paddingBottom: insets.bottom + Spacing.three }]}>
      {session && def ? (
        <FilterEditor def={def} value={session.values[def.id]} onChange={(v) => session.onChange(def.id, v)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
});
