import { Stack } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterButton } from '@/components/filters/filter-button';
import { filterValueToApi, type FilterDef } from '@/components/filters/filter-types';
import { Spacing } from '@/constants/theme';
import { useFilterSheetSession } from '@/data/filter-sheet';
import { useRouter } from '@/lib/nav';

/**
 * The search filters as a system form sheet (iOS): the same rows as the custom bar's overflow
 * sheet, fed by the Search screen through `data/filter-sheet`. Edits apply live, as the bar's do —
 * Done only closes the sheet. Reset clears every filter, and is the one thing the shutter has no
 * room for.
 */
export default function SearchFiltersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useFilterSheetSession();
  const anySet = !!session && session.defs.some((d) => filterValueToApi(d, session.values[d.id]) !== null);
  const openEditor = (def: FilterDef) => router.push({ pathname: '/search-filters/editor', params: { id: def.id } });
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button accessibilityLabel="Reset filters" disabled={!anySet} onPress={() => session?.onReset()}>
          Reset
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" accessibilityLabel="Done" onPress={() => router.back()}>
          Done
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {session?.defs.map((def) => (
          <FilterButton
            key={def.id}
            def={def}
            value={session.values[def.id]}
            onChange={session.onChange}
            onOpenEditor={openEditor}
          />
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
});
