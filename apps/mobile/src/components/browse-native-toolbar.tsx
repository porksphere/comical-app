import { Stack } from 'expo-router';
import { PixelRatio, StyleSheet, type ImageURISource } from 'react-native';

import type { PageOption } from '@/data/browse-page';
import type { Bridge } from '@/data/types';
import { initialSymbol } from '@/lib/initial-symbol';
import { BAR_THUMB_RADIUS, MENU_THUMB_RADIUS, useMenuThumbFiles } from '@/lib/menu-thumb-files';
import { NavBarLeadingImage } from '../../modules/nav-bar-image';

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
 * initial in an SF circle or square stands in. A file is handed over at the screen's scale so
 * it draws at its point size instead of pixel for point.
 *
 * The bar reads that file through React Native's loader, off the main thread and uncached, and
 * rebuilds its items on every return to Browse, so on its own the circle would be blank for the
 * first part of every pop back from a series page. `NavBarLeadingImage` (the local
 * `nav-bar-image` module) keeps the decoded picture and puts it on the leading item the moment
 * the items are rebuilt; it is a zero-size view in the page, where it can reach the screen.
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
  const circle = bridgeId ? circles[bridgeId] : undefined;
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu
          icon={circle ? fileIcon(circle) : initialSymbol(current?.name ?? '', 'circle')}
          iconRenderingMode={circle ? 'original' : 'template'}
          accessibilityLabel={current ? `${current.name}, bridge and page` : 'Bridge and page'}>
          {withBridges ? (
            <Stack.Toolbar.Menu inline title="Bridge">
              {bridges.map((b) => (
                <Stack.Toolbar.MenuAction
                  key={b.id}
                  isOn={b.id === bridgeId}
                  icon={tiles[b.id] ? fileIcon(tiles[b.id]) : initialSymbol(b.name)}
                  iconRenderingMode={tiles[b.id] ? 'original' : 'template'}
                  onPress={() => onSelectBridge(b.id)}>
                  {b.name}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          ) : null}
          <Stack.Toolbar.Menu inline title="Page">
            {pages.map((option) => (
              <Stack.Toolbar.MenuAction
                key={option.key}
                isOn={option.key === page}
                onPress={() => onSelectPage(option.key)}>
                {option.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Search" onPress={onSearch} />
      </Stack.Toolbar>
      {NavBarLeadingImage ? (
        <NavBarLeadingImage {...(circle ? { uri: circle } : {})} style={styles.pin} pointerEvents="none" />
      ) : null}
    </>
  );
}

/** A thumb file as a bar image at the screen's scale, so the bitmap rendered for the row's point
 *  size draws at that size. */
function fileIcon(uri: string): ImageURISource {
  return { uri, scale: PixelRatio.get() };
}

const styles = StyleSheet.create({
  pin: { position: 'absolute', width: 0, height: 0 },
});
