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
import type { LibraryShow } from '@/hooks/use-library-sort';
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

// The "Show" filter — the `/library?readState=` param, one derived state at a time or everything.
export const SHOW_LABELS: Record<LibraryShow, string> = {
  all: 'Everything',
  unstarted: 'Not started',
  behind: 'Behind',
  'caught-up': 'Caught up',
  finished: 'Finished',
};
const SHOW_ORDER: LibraryShow[] = ['all', 'unstarted', 'behind', 'caught-up', 'finished'];

type SortMenuProps = {
  value: LibrarySort;
  onChange: (s: LibrarySort) => void;
  grouping: LibraryGrouping;
  onGroupingChange: (g: LibraryGrouping) => void;
  show: LibraryShow;
  onShowChange: (s: LibraryShow) => void;
};

/**
 * The Library top bar's sort trigger — an icon button (mirrors the search icon beside it) that opens
 * an overlay menu with the library's three axes: the sort order (the `/library?sort=` param), the
 * grid's grouping, and the reading-state filter. The selected values are owned by the screen
 * (persisted — see `use-library-sort`).
 */
export function LibrarySortButton(props: SortMenuProps) {
  const theme = useTheme();
  return (
    <OptionMenuButton
      testID="library.sort"
      accessibilityLabel="Sort library"
      icon={<SortIcon color={theme.text} size={22} />}
      badge={props.show !== 'all'}
      render={() => <SortMenu {...props} />}
    />
  );
}

function SortMenu({ value, onChange, grouping, onGroupingChange, show, onShowChange }: SortMenuProps) {
  const { closeTop } = useOverlay();
  return (
    <OptionMenu title="Library">
      <OptionList>
        <OptionSectionLabel>Show</OptionSectionLabel>
        {SHOW_ORDER.map((s) => (
          <OptionRow
            key={s}
            testID={`library.show.${s}`}
            label={SHOW_LABELS[s]}
            selected={s === show}
            onPress={() => {
              onShowChange(s);
              closeTop();
            }}
          />
        ))}
      </OptionList>
      <OptionList>
        <OptionSectionLabel divided>Sort by</OptionSectionLabel>
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
