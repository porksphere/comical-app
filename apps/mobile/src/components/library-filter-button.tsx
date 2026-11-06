import { Stack } from 'expo-router';
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
  setLibraryRemovedOnly,
  toggleLibraryBridge,
  toggleLibraryShow,
  useLibraryBridges,
  useLibraryRemovedOnly,
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
 * (the "Everything" / "All sources" row) keeps all of them. `withShow` is the series views' alone —
 * along with the removed-from-source filter: saved chapters and pages have no reading state, and are
 * never marked removed.
 */
export function LibraryFilterButton({ withShow, present }: { withShow?: boolean; present: Present }) {
  const theme = useTheme();
  const show = useLibraryShow();
  const bridges = useLibraryBridges();
  const removedOnly = useLibraryRemovedOnly();
  const narrowing = (withShow && (show.length > 0 || removedOnly)) || bridges.length > 0;
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
  const { show, bridges, removedOnly, sources, nameOf } = useLibraryFilterState(present);

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
          <OptionSectionLabel divided>Availability</OptionSectionLabel>
          <OptionRow
            testID="library.removed.any"
            label="Any"
            selected={!removedOnly}
            onPress={() => setLibraryRemovedOnly(false)}
          />
          <OptionRow
            testID="library.removed.only"
            label="Removed from source"
            selected={removedOnly}
            onPress={() => setLibraryRemovedOnly(true)}
          />
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

export type LibraryFilterState = {
  show: ReadState[];
  bridges: string[];
  removedOnly: boolean;
  /** The sources on offer, the bridges `present` holds plus any ticked one, by name. */
  sources: string[];
  nameOf: (bridgeId: string) => string;
};

/** What the filter menu shows, for either rendering of it (the overlay here, the iOS bar menu). */
export function useLibraryFilterState(present: Present): LibraryFilterState {
  const show = useLibraryShow();
  const bridges = useLibraryBridges();
  const removedOnly = useLibraryRemovedOnly();
  const { nameOf } = useBridgeMap();
  const visible = useVisibleByBridge(present);

  const sources = useMemo(() => {
    const ids = new Set(visible.map((i) => i.bridgeId));
    // A ticked source stays listed even once nothing from it is left, or the menu would hide what is
    // emptying the grid along with the way to untick it.
    for (const id of bridges) ids.add(id);
    return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [visible, bridges, nameOf]);

  return { show, bridges, removedOnly, sources, nameOf };
}

/** Whether anything is narrowing the listing — what fills the filter icon, here and on the menu
 *  button holding it. */
export function libraryFilterNarrowing({
  withShow,
  show,
  bridges,
  removedOnly,
}: Pick<LibraryFilterState, 'show' | 'bridges' | 'removedOnly'> & { withShow: boolean }) {
  return (withShow && (show.length > 0 || removedOnly)) || bridges.length > 0;
}

/**
 * The same filter as a submenu of the Library's iOS bar menu (library-native-toolbar). A function
 * returning the element rather than a component: the native menu only reads Stack.Toolbar.*
 * elements that are its direct children, so a component wrapping one would be invisible to it.
 * The icon fills while anything is narrowing, as the custom button's does. The system menu closes
 * on every pick, so a multi-select here is one toggle per opening — the price of the bar drawing
 * it.
 */
export function libraryFilterMenu({
  withShow,
  show,
  bridges,
  removedOnly,
  sources,
  nameOf,
}: LibraryFilterState & { withShow: boolean }) {
  const narrowing = libraryFilterNarrowing({ withShow, show, bridges, removedOnly });
  return (
    <Stack.Toolbar.Menu
      title="Filter"
      icon={narrowing ? 'line.3.horizontal.decrease.circle.fill' : 'line.3.horizontal.decrease.circle'}
      accessibilityLabel={withShow ? 'Filter by reading state or source' : 'Filter by source'}>
      {withShow && (
        <Stack.Toolbar.Menu inline title="Show">
          <Stack.Toolbar.MenuAction isOn={show.length === 0} onPress={clearLibraryShow}>
            Everything
          </Stack.Toolbar.MenuAction>
          {READ_STATES.map((state) => (
            <Stack.Toolbar.MenuAction key={state} isOn={show.includes(state)} onPress={() => toggleLibraryShow(state)}>
              {SHOW_LABELS[state]}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      )}
      {withShow && (
        <Stack.Toolbar.Menu inline title="Availability">
          <Stack.Toolbar.MenuAction isOn={!removedOnly} onPress={() => setLibraryRemovedOnly(false)}>
            Any
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction isOn={removedOnly} onPress={() => setLibraryRemovedOnly(true)}>
            Removed from source
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      )}
      <Stack.Toolbar.Menu inline title="Source">
        <Stack.Toolbar.MenuAction isOn={bridges.length === 0} onPress={clearLibraryBridges}>
          All sources
        </Stack.Toolbar.MenuAction>
        {sources.map((id) => (
          <Stack.Toolbar.MenuAction key={id} isOn={bridges.includes(id)} onPress={() => toggleLibraryBridge(id)}>
            {nameOf(id)}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar.Menu>
  );
}
