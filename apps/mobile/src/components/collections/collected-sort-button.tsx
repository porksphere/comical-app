import { Stack } from 'expo-router';

import { SortIcon } from '@/components/icons/ui-icons';
import { ChoiceMenuButton, choiceSection } from '@/components/overlay/choice-menu';
import {
  defaultDirFor,
  type CollectedDir,
  type CollectedGrouping,
  type CollectedSort,
  type CollectedViewPrefs,
} from '@/data/collected-view';
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

const DIR_ORDER: CollectedDir[] = ['desc', 'asc'];
const DIR_LABELS: Record<CollectedDir, string> = { desc: 'Newest first', asc: 'Oldest first' };
const POSITIONAL_DIR_LABELS: Record<CollectedDir, string> = { asc: 'Ascending', desc: 'Descending' };

/**
 * The saved chapters/pages views' arranging axes. Sort and direction are separate params
 * server-side (there is no "oldest" sort key), so they are separate sections; picking a sort resets
 * direction to that sort's natural default, so switching to "Series" doesn't leave you reading Z→A
 * because you'd once chosen newest-first.
 */
export function CollectedSortButton({
  value,
  onChange,
}: {
  value: CollectedViewPrefs;
  onChange: (patch: Partial<CollectedViewPrefs>) => void;
}) {
  const theme = useTheme();
  return (
    <ChoiceMenuButton
      testID="collected.sort"
      accessibilityLabel="Sort saved items"
      icon={<SortIcon color={theme.text} size={22} />}
      title="Saved"
      sections={[
        choiceSection({
          label: 'Sort by',
          testID: 'collected.sort',
          order: SORT_ORDER,
          labels: SORT_LABELS,
          value: value.sort,
          onChange: (sort) => onChange({ sort, dir: defaultDirFor(sort) }),
        }),
        choiceSection({
          label: 'Order',
          testID: 'collected.dir',
          order: DIR_ORDER,
          // "Newest/Oldest" only reads right for a time sort; for the positional ones it's up/down.
          labels: value.sort === 'added' ? DIR_LABELS : POSITIONAL_DIR_LABELS,
          value: value.dir,
          onChange: (dir) => onChange({ dir }),
        }),
        choiceSection({
          label: 'Group by',
          testID: 'collected.group',
          order: GROUP_ORDER,
          labels: GROUP_LABELS,
          value: value.grouping,
          onChange: (grouping) => onChange({ grouping }),
        }),
      ]}
    />
  );
}

/** The same three axes as a system menu for the iOS bottom toolbar — see `libraryFilterMenu`. */
export function collectedSortMenu({
  value,
  onChange,
}: {
  value: CollectedViewPrefs;
  onChange: (patch: Partial<CollectedViewPrefs>) => void;
}) {
  const dirLabels = value.sort === 'added' ? DIR_LABELS : POSITIONAL_DIR_LABELS;
  return (
    <Stack.Toolbar.Menu icon="arrow.up.arrow.down" accessibilityLabel="Sort saved items">
      <Stack.Toolbar.Menu inline title="Sort by">
        {SORT_ORDER.map((sort) => (
          <Stack.Toolbar.MenuAction
            key={sort}
            isOn={sort === value.sort}
            onPress={() => onChange({ sort, dir: defaultDirFor(sort) })}>
            {SORT_LABELS[sort]}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu inline title="Order">
        {DIR_ORDER.map((dir) => (
          <Stack.Toolbar.MenuAction key={dir} isOn={dir === value.dir} onPress={() => onChange({ dir })}>
            {dirLabels[dir]}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu inline title="Group by">
        {GROUP_ORDER.map((grouping) => (
          <Stack.Toolbar.MenuAction key={grouping} isOn={grouping === value.grouping} onPress={() => onChange({ grouping })}>
            {GROUP_LABELS[grouping]}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar.Menu>
  );
}
