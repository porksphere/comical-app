import { FilterIcon } from '@/components/icons/ui-icons';
import { ChoiceMenuButton, choiceSection } from '@/components/overlay/choice-menu';
import type { LibraryShow } from '@/hooks/use-library-sort';
import { useTheme } from '@/hooks/use-theme';

// The reading-state filter — the `/library?readState=` param, one derived state at a time or
// everything.
export const SHOW_LABELS: Record<LibraryShow, string> = {
  all: 'Everything',
  unstarted: 'Not started',
  behind: 'Behind',
  'caught-up': 'Caught up',
  finished: 'Finished',
};
const SHOW_ORDER: LibraryShow[] = ['all', 'unstarted', 'behind', 'caught-up', 'finished'];

/**
 * The series views' filter trigger, beside the sort. Its own button rather than a section of the
 * sort menu: sort and group only rearrange what's there, while this one narrows it, and a filter
 * that is quietly on is what makes a library look like it lost series. So it has its own icon,
 * which fills while the filter is narrowing — a state readable from the bar without opening
 * anything.
 */
export function LibraryFilterButton({ value, onChange }: { value: LibraryShow; onChange: (s: LibraryShow) => void }) {
  const theme = useTheme();
  return (
    <ChoiceMenuButton
      testID="library.filter"
      // Not "Filter library" — that is the text search's label (tab-filter.tsx, from its
      // placeholder), and two controls in one bar answering to the same name is a trap for both a
      // screen reader and the web flows, which select by label.
      accessibilityLabel="Filter by reading state"
      icon={<FilterIcon color={theme.text} size={22} filled={value !== 'all'} />}
      title="Show"
      sections={[
        choiceSection({ testID: 'library.show', order: SHOW_ORDER, labels: SHOW_LABELS, value, onChange }),
      ]}
    />
  );
}
