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
import type { LibrarySort } from '@/data/api';
import type { LibraryGrouping } from '@/data/library-grouping';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

// Sort options shown in the menu, mapped to the `/library?sort=` param.
const SORT_LABELS: Record<LibrarySort, string> = {
  added: 'Recently added',
  lastRead: 'Last read',
  title: 'Title',
  unread: 'Unread',
};
const SORT_ORDER: LibrarySort[] = ['added', 'lastRead', 'title', 'unread'];

// Grouping is client-side sectioning OVER the sorted result — it composes with any sort instead of
// replacing it (see libraryGroupOf / buildGroupedRows).
const GROUP_LABELS: Record<LibraryGrouping, string> = {
  none: 'None',
  bridge: 'Source',
  added: 'Date added',
  lastRead: 'Last read',
};
const GROUP_ORDER: LibraryGrouping[] = ['none', 'bridge', 'added', 'lastRead'];

/**
 * The Library top bar's sort trigger — an icon button (mirrors the search icon beside it) that opens
 * an overlay menu with the library's two axes: the sort order (the `/library?sort=` param) and the
 * grid's grouping. The selected values are owned by the screen (persisted — see `use-library-sort`).
 */
export function LibrarySortButton({
  value,
  onChange,
  grouping,
  onGroupingChange,
}: {
  value: LibrarySort;
  onChange: (s: LibrarySort) => void;
  grouping: LibraryGrouping;
  onGroupingChange: (g: LibraryGrouping) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      testID="library.sort"
      ref={ref}
      {...handlers}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Sort library"
      style={[styles.button, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() =>
        openAt(() => (
          <SortMenu value={value} onChange={onChange} grouping={grouping} onGroupingChange={onGroupingChange} />
        ))
      }>
      <SortIcon color={theme.text} size={22} />
    </Pressable>
  );
}

function SortMenu({
  value,
  onChange,
  grouping,
  onGroupingChange,
}: {
  value: LibrarySort;
  onChange: (s: LibrarySort) => void;
  grouping: LibraryGrouping;
  onGroupingChange: (g: LibraryGrouping) => void;
}) {
  const { closeTop } = useOverlay();
  const presentation = useOverlayPresentation();
  return (
    <View style={styles.menu}>
      {presentation !== 'popover' && (
        <MeasuredHeader>
          <OverlayHeading>Library</OverlayHeading>
        </MeasuredHeader>
      )}
      <OptionList>
        <SectionLabel>Sort by</SectionLabel>
        {SORT_ORDER.map((s) => (
          <SortRow
            key={s}
            testID={`library.sort.${s}`}
            label={SORT_LABELS[s]}
            selected={s === value}
            onPress={() => {
              onChange(s);
              closeTop();
            }}
          />
        ))}
      </OptionList>
      <OptionList>
        <SectionLabel>Group by</SectionLabel>
        {GROUP_ORDER.map((g) => (
          <SortRow
            key={g}
            testID={`library.group.${g}`}
            label={GROUP_LABELS[g]}
            selected={g === grouping}
            onPress={() => {
              onGroupingChange(g);
              closeTop();
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

function SortRow({
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
