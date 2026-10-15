import { useMemo } from 'react';

import { FilterIcon } from '@/components/icons/ui-icons';
import { OptionMenu, OptionMenuButton, OptionRow, OptionSectionLabel } from '@/components/overlay/option-menu';
import { OptionList } from '@/components/overlay/overlay';
import type { ReadState } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import {
  clearLibraryBridges,
  clearLibraryShow,
  READ_STATES,
  toggleLibraryBridge,
  toggleLibraryShow,
  useLibraryBridges,
  useLibraryShow,
} from '@/hooks/use-library-sort';
import { useTheme } from '@/hooks/use-theme';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';

export const SHOW_LABELS: Record<ReadState, string> = {
  unstarted: 'Not started',
  behind: 'Behind',
  'caught-up': 'Caught up',
  finished: 'Finished',
};

type Present = { bridgeId: string }[] | undefined;

/**
 * The Library's filter trigger, beside the sort. Its own button rather than a section of the sort
 * menu: sort and group only rearrange what's there, while this one narrows it, and a filter that is
 * quietly on is what makes a library look like it lost series. So it has its own icon, which fills
 * while anything is narrowing — a state readable from the bar without opening anything.
 *
 * Both axes are multi-select: rows toggle, a ticked state or source is kept, and nothing ticked
 * (the "Everything" / "All sources" row) keeps all of them. `withShow` is the series views' alone;
 * saved chapters and pages have no reading state to filter by.
 */
export function LibraryFilterButton({ withShow, present }: { withShow?: boolean; present: Present }) {
  const theme = useTheme();
  const show = useLibraryShow();
  const bridges = useLibraryBridges();
  const narrowing = (withShow && show.length > 0) || bridges.length > 0;
  return (
    <OptionMenuButton
      testID="library.filter"
      // Not "Filter library" — that is the text search's label (tab-filter.tsx, from its
      // placeholder), and two controls in one bar answering to the same name is a trap for both a
      // screen reader and the web flows, which select by label.
      accessibilityLabel={withShow ? 'Filter by reading state or source' : 'Filter by source'}
      icon={<FilterIcon color={theme.text} size={22} filled={narrowing} />}
      render={() => <LibraryFilterMenu withShow={withShow} present={present} />}
    />
  );
}

/**
 * Stays open across picks, so it reads the filter itself rather than taking it as props: the overlay
 * renders its content from the closure it was opened with, and a value passed in would keep showing
 * the ticks it opened with (see `ChoiceMenuButton`, which closes on every pick for that reason).
 */
function LibraryFilterMenu({ withShow, present }: { withShow?: boolean; present: Present }) {
  const show = useLibraryShow();
  const bridges = useLibraryBridges();
  const { nameOf } = useBridgeMap();
  const visible = useVisibleByBridge(present);

  const sources = useMemo(() => {
    const ids = new Set(visible.map((i) => i.bridgeId));
    // A ticked source stays listed even once nothing from it is left, or the menu would hide what is
    // emptying the grid along with the way to untick it.
    for (const id of bridges) ids.add(id);
    return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [visible, bridges, nameOf]);

  return (
    <OptionMenu title="Filter">
      {withShow && (
        <OptionList>
          <OptionSectionLabel>Show</OptionSectionLabel>
          <OptionRow testID="library.show.all" label="Everything" selected={show.length === 0} onPress={clearLibraryShow} />
          {READ_STATES.map((state) => (
            <OptionRow
              key={state}
              testID={`library.show.${state}`}
              label={SHOW_LABELS[state]}
              selected={show.includes(state)}
              onPress={() => toggleLibraryShow(state)}
            />
          ))}
        </OptionList>
      )}
      <OptionList>
        <OptionSectionLabel divided={withShow}>Source</OptionSectionLabel>
        <OptionRow
          testID="library.bridge.all"
          label="All sources"
          selected={bridges.length === 0}
          onPress={clearLibraryBridges}
        />
        {sources.map((id) => (
          <OptionRow
            key={id}
            testID={`library.bridge.${id}`}
            label={nameOf(id)}
            selected={bridges.includes(id)}
            onPress={() => toggleLibraryBridge(id)}
          />
        ))}
      </OptionList>
    </OptionMenu>
  );
}
