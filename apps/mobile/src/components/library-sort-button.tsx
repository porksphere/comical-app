import { Stack } from 'expo-router';

import { SortIcon } from '@/components/icons/ui-icons';
import { ChoiceMenuButton, choiceSection } from '@/components/overlay/choice-menu';
import type { LibraryGrouping } from '@/data/library-grouping';
import type { LibraryViewSort } from '@/hooks/use-library-sort';
import { useTheme } from '@/hooks/use-theme';

const SORT_LABELS: Record<LibraryViewSort, string> = {
  added: 'Recently added',
  lastRead: 'Last read',
  title: 'Title',
  unread: 'Unread',
  random: 'Random',
};
// Picking Random again while it's the sort deals a fresh order (see useLibrarySort).
const SORT_ORDER: LibraryViewSort[] = ['added', 'lastRead', 'title', 'unread', 'random'];

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
 * The series views' arranging axes: the sort order (the `/library?sort=` param, or a
 * client-side shuffle) and the grid's
 * grouping. The reading-state filter is the button beside this one (`LibraryFilterButton`) — it
 * narrows rather than arranges.
 */
export function LibrarySortButton({
  value,
  onChange,
  grouping,
  onGroupingChange,
}: {
  value: LibraryViewSort;
  onChange: (s: LibraryViewSort) => void;
  grouping: LibraryGrouping;
  onGroupingChange: (g: LibraryGrouping) => void;
}) {
  const theme = useTheme();
  return (
    <ChoiceMenuButton
      testID="library.sort"
      accessibilityLabel="Sort library"
      icon={<SortIcon color={theme.text} size={22} />}
      title="Library"
      sections={[
        choiceSection({
          label: 'Sort by',
          testID: 'library.sort',
          order: SORT_ORDER,
          labels: SORT_LABELS,
          value,
          onChange,
        }),
        choiceSection({
          label: 'Group by',
          testID: 'library.group',
          order: GROUP_ORDER,
          labels: GROUP_LABELS,
          value: grouping,
          onChange: onGroupingChange,
        }),
      ]}
    />
  );
}

/** The same two axes as a system menu for the iOS bottom toolbar — see `libraryFilterMenu`. */
export function librarySortMenu({
  value,
  onChange,
  grouping,
  onGroupingChange,
}: {
  value: LibraryViewSort;
  onChange: (s: LibraryViewSort) => void;
  grouping: LibraryGrouping;
  onGroupingChange: (g: LibraryGrouping) => void;
}) {
  return (
    <Stack.Toolbar.Menu icon="arrow.up.arrow.down" accessibilityLabel="Sort library">
      <Stack.Toolbar.Menu inline title="Sort by">
        {SORT_ORDER.map((sort) => (
          <Stack.Toolbar.MenuAction key={sort} isOn={sort === value} onPress={() => onChange(sort)}>
            {SORT_LABELS[sort]}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu inline title="Group by">
        {GROUP_ORDER.map((group) => (
          <Stack.Toolbar.MenuAction key={group} isOn={group === grouping} onPress={() => onGroupingChange(group)}>
            {GROUP_LABELS[group]}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar.Menu>
  );
}
