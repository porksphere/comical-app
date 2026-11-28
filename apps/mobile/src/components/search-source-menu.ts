import type { LeadingMenuProps } from '@/components/nav-bar-leading-menu';
import { COMICAL_BRIDGE_ID, COMICAL_ICON } from '@/data/selected-bridge';
import type { Bridge } from '@/data/types';
import { initialSymbol } from '@/lib/initial-symbol';
import { BAR_THUMB_PX, BAR_THUMB_RADIUS, MENU_THUMB_RADIUS, useMenuThumbFiles } from '@/lib/menu-thumb-files';

const COMICAL_SOURCES: Record<string, number> = { [COMICAL_BRIDGE_ID]: COMICAL_ICON };

/**
 * The iOS search tab's menu of what to search: Everything, then each source, each row with its
 * tile and the button the picked one's circle, as Browse's bridge menu draws them. Handed to
 * `navBarLeadingMenuItem` and `NavBarLeadingMenu`, so the pick changes the button and the checks
 * in place: kept in the header config, the menu went stale on "Everything" and the bar rebuilt it
 * on every change, now and then beside the old one.
 */
export function useSearchSourceMenu({
  enabled,
  sources,
  thumbnails,
  bridgeId,
  onSelect,
}: {
  /** Off where there is no such menu, so no source's tile is rendered for nothing. */
  enabled: boolean;
  sources: readonly Bridge[];
  thumbnails: Record<string, string>;
  bridgeId: string | undefined;
  onSelect: (id: string) => void;
}): LeadingMenuProps {
  const pictures = enabled ? thumbnails : undefined;
  const bundled = enabled ? COMICAL_SOURCES : undefined;
  const circles = useMenuThumbFiles(pictures, bundled, BAR_THUMB_RADIUS, BAR_THUMB_PX);
  const tiles = useMenuThumbFiles(pictures, bundled, MENU_THUMB_RADIUS);
  const current = sources.find((b) => b.id === bridgeId);
  const shown = current?.id ?? COMICAL_BRIDGE_ID;
  return {
    image: circles[shown],
    symbol: current ? initialSymbol(current.name, 'circle') : initialSymbol('Everything', 'circle'),
    label: current ? `Searching ${current.name}` : 'Searching everything',
    sections: [
      {
        title: 'Search',
        rows: [
          {
            id: COMICAL_BRIDGE_ID,
            title: 'Everything',
            image: tiles[COMICAL_BRIDGE_ID],
            on: !current,
            onPress: () => onSelect(COMICAL_BRIDGE_ID),
          },
        ],
      },
      {
        title: 'Sources',
        rows: sources.map((b) => ({
          id: b.id,
          title: b.name,
          image: tiles[b.id],
          symbol: initialSymbol(b.name),
          on: b.id === bridgeId,
          onPress: () => onSelect(b.id),
        })),
      },
    ],
  };
}
