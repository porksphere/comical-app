import { Stack } from 'expo-router';

import { NavBarLeadingMenu } from '@/components/nav-bar-leading-menu';
import type { PageOption } from '@/data/browse-page';
import type { Bridge } from '@/data/types';
import { initialSymbol } from '@/lib/initial-symbol';
import { BAR_THUMB_RADIUS, MENU_THUMB_RADIUS, useMenuThumbFiles } from '@/lib/menu-thumb-files';

/**
 * Browse's controls in the iOS navigation bar: ONE leading button, the current bridge's icon as
 * a circle in the bar's glass capsule, opening a system menu of checkmarked rows in two inline
 * sections — the bridges first, under the bridge icon that opened them, then the pages — so any
 * pick is open and tap; the search is the trailing button. They were submenus, which put every
 * page switch a level down. No custom view stands in the bar, so every item is a standard UIBarButtonItem:
 * UIKit lays the bar out itself (an image item joins the vertical bar of a folded or landscape
 * display) and morphs the leading item into the back button of the series page Browse pushes
 * (tab-stack.tsx). The capsule is kept for that morph: a bare circle (`hidesSharedBackground`)
 * was tried and the back button grew out of nothing.
 *
 * The bar draws an item's and a row's image as the plain UIImage it is given, so the shape is in
 * the file: `menu-thumb-files.ts` renders the thumbnail once per shape (a circle for the button,
 * the tile's corner for the rows). Until a file is ready, or for a bridge without art, the
 * initial in an SF circle or square stands in. The button and its menu are `NavBarLeadingMenu`,
 * which keeps them off the header config so a pick changes them in place.
 *
 * `withBridges` is off while the sidebar rail lists the bridges; the menu then holds only the
 * pages, as the custom bar drops its bridge selector beside the rail.
 */
export function BrowseNativeToolbar({
  bridges,
  thumbnails,
  sources,
  bridgeId,
  onSelectBridge,
  withBridges,
  pages,
  page,
  onSelectPage,
  onSearch,
}: {
  bridges: Bridge[];
  thumbnails: Record<string, string>;
  /** Bundled assets for bridges whose icon isn't a URL (Comical's own). */
  sources: Record<string, number>;
  bridgeId: string | undefined;
  onSelectBridge: (id: string) => void;
  withBridges: boolean;
  pages: PageOption[];
  page: string;
  onSelectPage: (key: string) => void;
  onSearch: () => void;
}) {
  const circles = useMenuThumbFiles(thumbnails, sources, BAR_THUMB_RADIUS);
  const tiles = useMenuThumbFiles(thumbnails, sources, MENU_THUMB_RADIUS);
  const current = bridges.find((b) => b.id === bridgeId);
  const pageSection = {
    title: 'Page',
    rows: pages.map((option) => ({
      id: option.key,
      title: option.label,
      on: option.key === page,
      onPress: () => onSelectPage(option.key),
    })),
  };
  const bridgeSection = {
    title: 'Bridge',
    rows: bridges.map((b) => ({
      id: b.id,
      title: b.name,
      image: tiles[b.id],
      symbol: initialSymbol(b.name),
      on: b.id === bridgeId,
      onPress: () => onSelectBridge(b.id),
    })),
  };
  return (
    <>
      <NavBarLeadingMenu
        image={bridgeId ? circles[bridgeId] : undefined}
        symbol={initialSymbol(current?.name ?? '', 'circle')}
        label={current ? `${current.name}, bridge and page` : 'Bridge and page'}
        sections={withBridges ? [bridgeSection, pageSection] : [pageSection]}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Search" onPress={onSearch} />
      </Stack.Toolbar>
    </>
  );
}
