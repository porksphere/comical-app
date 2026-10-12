import { useMemo } from 'react';

import { FilterIcon } from '@/components/icons/ui-icons';
import { ChoiceMenuButton, choiceSection, type ChoiceSection } from '@/components/overlay/choice-menu';
import { useBridgeMap } from '@/hooks/use-bridges';
import { ALL_BRIDGES, type LibraryBridge, type LibraryShow } from '@/hooks/use-library-sort';
import { useTheme } from '@/hooks/use-theme';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';

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
 * The Library's filter trigger, beside the sort. Its own button rather than a section of the sort
 * menu: sort and group only rearrange what's there, while this one narrows it, and a filter that is
 * quietly on is what makes a library look like it lost series. So it has its own icon, which fills
 * while anything is narrowing — a state readable from the bar without opening anything.
 *
 * `show` is the series views' alone; saved chapters and pages have no reading state to filter by.
 * The source filter is every view's.
 */
export function LibraryFilterButton({
  show,
  bridge,
  onBridgeChange,
  present,
}: {
  show?: { value: LibraryShow; onChange: (s: LibraryShow) => void };
  bridge: LibraryBridge;
  onBridgeChange: (b: LibraryBridge) => void;
  /** What the view holds, unfiltered — its sources are the choices. */
  present: { bridgeId: string }[] | undefined;
}) {
  const theme = useTheme();
  const { nameOf } = useBridgeMap();
  const visible = useVisibleByBridge(present);

  const sources = useMemo(() => {
    const ids = new Set(visible.map((i) => i.bridgeId));
    // The applied choice stays listed even once nothing from it is left, or the menu would show no
    // check and offer no way to see what is emptying the grid.
    if (bridge !== ALL_BRIDGES) ids.add(bridge);
    const byName = [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const labels: Record<string, string> = { [ALL_BRIDGES]: 'All sources' };
    for (const id of byName) labels[id] = nameOf(id);
    return { order: [ALL_BRIDGES, ...byName], labels };
  }, [visible, bridge, nameOf]);

  const sections: ChoiceSection[] = [];
  if (show) {
    sections.push(
      choiceSection({ label: 'Show', testID: 'library.show', order: SHOW_ORDER, labels: SHOW_LABELS, ...show }),
    );
  }
  sections.push(
    choiceSection({
      label: 'Source',
      testID: 'library.bridge',
      order: sources.order,
      labels: sources.labels,
      value: bridge,
      onChange: onBridgeChange,
    }),
  );

  const narrowing = (show && show.value !== 'all') || bridge !== ALL_BRIDGES;
  return (
    <ChoiceMenuButton
      testID="library.filter"
      // Not "Filter library" — that is the text search's label (tab-filter.tsx, from its
      // placeholder), and two controls in one bar answering to the same name is a trap for both a
      // screen reader and the web flows, which select by label.
      accessibilityLabel={show ? 'Filter by reading state or source' : 'Filter by source'}
      icon={<FilterIcon color={theme.text} size={22} filled={narrowing} />}
      title="Filter"
      sections={sections}
    />
  );
}
