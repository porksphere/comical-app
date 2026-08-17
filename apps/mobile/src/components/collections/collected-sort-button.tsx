import { Pressable, StyleSheet, View } from 'react-native';

import { SortIcon } from '@/components/icons/ui-icons';
import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useAnchoredOverlay,
  useOverlay,
  useOverlayPresentation,
} from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RowHeight, Spacing } from '@/constants/theme';
import {
  defaultDirFor,
  type CollectedDir,
  type CollectedGrouping,
  type CollectedSort,
  type CollectedViewPrefs,
} from '@/data/collected-view';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

const SORT_LABELS: Record<CollectedSort, string> = {
  added: 'Recently saved',
  series: 'Series',
  chapter: 'Chapter order',
};
const SORT_ORDER: CollectedSort[] = ['added', 'series', 'chapter'];

const GROUP_LABELS: Record<CollectedGrouping, string> = {
  none: 'None',
  series: 'Series',
  date: 'Date saved',
};
const GROUP_ORDER: CollectedGrouping[] = ['none', 'series', 'date'];

const DIR_LABELS: Record<CollectedDir, string> = { desc: 'Newest first', asc: 'Oldest first' };
const POSITIONAL_DIR_LABELS: Record<CollectedDir, string> = { asc: 'Ascending', desc: 'Descending' };

/**
 * The saved-pages view's ordering control — the same icon-button-opens-a-menu shape as
 * `LibrarySortButton`, but carrying three axes rather than one:
 *
 * - **Sort** and **direction** are separate params server-side (there is no "oldest" sort key), so
 *   they are separate rows here rather than a fused list. Picking a sort resets direction to that
 *   sort's natural default, so switching to "Series" doesn't leave you reading Z→A because you'd
 *   once chosen newest-first.
 * - **Grouping** is applied client-side *over* the sorted result, so it composes with any sort
 *   instead of replacing it.
 */
export function CollectedSortButton({
  value,
  onChange,
}: {
  value: CollectedViewPrefs;
  onChange: (patch: Partial<CollectedViewPrefs>) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      testID="collected.sort"
      ref={ref}
      {...handlers}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Sort saved pages"
      style={[styles.button, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() => openAt(() => <SortMenu value={value} onChange={onChange} />)}>
      <SortIcon color={theme.text} size={22} />
    </Pressable>
  );
}

function SortMenu({
  value,
  onChange,
}: {
  value: CollectedViewPrefs;
  onChange: (patch: Partial<CollectedViewPrefs>) => void;
}) {
  const { closeTop } = useOverlay();
  const presentation = useOverlayPresentation();
  // "Newest/Oldest" only reads right for a time sort; for the positional ones it's up/down.
  const dirLabels = value.sort === 'added' ? DIR_LABELS : POSITIONAL_DIR_LABELS;

  return (
    <View style={styles.menu}>
      {presentation !== 'popover' && (
        <MeasuredHeader>
          <OverlayHeading>Saved pages</OverlayHeading>
        </MeasuredHeader>
      )}

      <OptionList>
        <SectionLabel>Sort by</SectionLabel>
        {SORT_ORDER.map((s) => (
          <MenuRow
            key={s}
            testID={`collected.sort.${s}`}
            label={SORT_LABELS[s]}
            selected={s === value.sort}
            // Direction follows the sort's natural default — see the component doc.
            onPress={() => onChange({ sort: s, dir: defaultDirFor(s) })}
          />
        ))}
      </OptionList>

      <OptionList>
        <SectionLabel>Order</SectionLabel>
        {(['desc', 'asc'] as CollectedDir[]).map((d) => (
          <MenuRow
            key={d}
            testID={`collected.dir.${d}`}
            label={dirLabels[d]}
            selected={d === value.dir}
            onPress={() => onChange({ dir: d })}
          />
        ))}
      </OptionList>

      <OptionList>
        <SectionLabel>Group by</SectionLabel>
        {GROUP_ORDER.map((g) => (
          <MenuRow
            key={g}
            testID={`collected.group.${g}`}
            label={GROUP_LABELS[g]}
            selected={g === value.grouping}
            onPress={() => {
              onChange({ grouping: g });
              closeTop(); // grouping is the last thing anyone picks; close on it
            }}
          />
        ))}
      </OptionList>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
      {children}
    </ThemedText>
  );
}

function MenuRow({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable testID={testID} onPress={onPress} {...handlers}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={styles.rowLabel} numberOfLines={1}>
          {label}
        </ThemedText>
        <View style={[styles.dot, selected && styles.dotOn]} />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: Spacing.one,
    borderRadius: Spacing.two,
  },
  menu: {
    gap: Spacing.three,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: RowHeight,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowLabel: {
    flex: 1,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  dotOn: {
    borderColor: '#3478F6',
    backgroundColor: '#3478F6',
  },
});
