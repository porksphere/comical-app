import { SortIcon } from '@/components/icons/ui-icons';
import { ChoiceMenuButton, choiceSection } from '@/components/overlay/choice-menu';
import type { LibrarySort } from '@/data/api';
import type { LibraryGrouping } from '@/data/library-grouping';
import { useTheme } from '@/hooks/use-theme';

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
 * The series views' arranging axes: the sort order (the `/library?sort=` param) and the grid's
 * grouping. The reading-state filter is the button beside this one (`LibraryFilterButton`) — it
 * narrows rather than arranges.
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
