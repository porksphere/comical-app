import { SortIcon } from '@/components/icons/ui-icons';
import { OptionList, useOverlay } from '@/components/overlay/overlay';
import {
  OptionMenu,
  OptionMenuButton,
  OptionRow,
  OptionSectionLabel,
} from '@/components/overlay/option-menu';
import type { LibrarySort } from '@/data/api';
import type { LibraryGrouping } from '@/data/library-grouping';
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
  const theme = useTheme();
  return (
    <OptionMenuButton
      testID="library.sort"
      accessibilityLabel="Sort library"
      icon={<SortIcon color={theme.text} size={22} />}
      render={() => (
        <SortMenu value={value} onChange={onChange} grouping={grouping} onGroupingChange={onGroupingChange} />
      )}
    />
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
  return (
    <OptionMenu title="Library">
      <OptionList>
        <OptionSectionLabel>Sort by</OptionSectionLabel>
        {SORT_ORDER.map((s) => (
          <OptionRow
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
        <OptionSectionLabel divided>Group by</OptionSectionLabel>
        {GROUP_ORDER.map((g) => (
          <OptionRow
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
    </OptionMenu>
  );
}
