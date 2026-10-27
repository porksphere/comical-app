import { Stack } from 'expo-router';
import { PixelRatio, type ImageURISource } from 'react-native';

import type { PageOption } from '@/data/browse-page';
import type { Bridge } from '@/data/types';
import { initialSymbol } from '@/lib/initial-symbol';
import { BAR_THUMB_RADIUS, MENU_THUMB_RADIUS, useMenuThumbFiles } from '@/lib/menu-thumb-files';

/**
 * Browse's controls in the iOS navigation bar: ONE leading button, the current bridge's icon as
 * a bare circle — no glass capsule behind it (`hidesSharedBackground`), the way a round account
 * picture is itself the button in Apple's own bars — opening a system menu with Bridge and Page
 * as submenus of checkmarked rows; the search is the trailing button. No custom view stands in
 * the bar, so every item is a standard UIBarButtonItem: UIKit lays the bar out itself (an image
 * item joins the vertical bar of a folded or landscape display) and would morph the leading item
 * into the back button of a screen Browse pushed natively. The series page is not one: it is a
 * transparent modal animating itself out of the card (tab-stack.tsx), so its bar replaces this
 * one outright.
 *
 * The bar draws an item's and a row's image as the plain UIImage it is given, so the shape is in
 * the file: `menu-thumb-files.ts` renders the thumbnail once per shape (a circle for the button,
 * the tile's corner for the rows). Until a file is ready, or for a bridge without art, the
 * initial in an SF circle or square stands in. A file is handed over at the screen's scale so
 * it draws at its point size instead of pixel for point.
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
          hidesSharedBackground
          accessibilityLabel={current ? `${current.name}, bridge and page` : 'Bridge and page'}>
          {withBridges ? (
            <Stack.Toolbar.Menu title="Bridge" icon="puzzlepiece.extension">
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
          <Stack.Toolbar.Menu title="Page" icon="rectangle.grid.2x2">
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
    </>
  );
}

/** A thumb file as a bar image at the screen's scale, so the bitmap rendered for the row's point
 *  size draws at that size. */
function fileIcon(uri: string): ImageURISource {
  return { uri, scale: PixelRatio.get() };
}
