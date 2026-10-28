import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useMemo, useState } from 'react';
import { PixelRatio } from 'react-native';

import shapedImage from '../../modules/shaped-image';

/**
 * A menu row's picture as a FILE: a system menu (the navigation bar's `Stack.Toolbar` menus, the
 * settings rows' `menu-anchor` menus) takes a row's image only as a local file, so a bridge's
 * thumbnail — a URL, or the bundled Comical asset — is rendered down to one once and kept for
 * the session. The file is the size the row shows it at — `MENU_THUMB_PX` points, rendered at
 * the screen's scale — and the SHAPE is in the file too: a UIMenu draws the bitmap it is handed,
 * past any modifier, so a tile is clipped by the `shaped-image` module (`radius`: the row's
 * corner, or `BAR_THUMB_RADIUS` for the circle a bar button shows). The bar reads the file
 * through React Native's loader at the `scale` the source says; `menu-anchor` decodes it itself
 * at `UIScreen.main.scale`.
 */
export const MENU_THUMB_PX = 28;
/** The tile's corner, in points — the overlay menus' `thumb` radius. */
export const MENU_THUMB_RADIUS = 6;
/** Half the side: the circle a bar button's picture is clipped to. */
export const BAR_THUMB_RADIUS = MENU_THUMB_PX / 2;

const files = new Map<string, Promise<string | null>>();

/** Resolves to the `file://` URI of `source`'s tile, clipped to `radius` points where the
 *  shaping module is linked (the square tile elsewhere), or null when it can't be loaded. */
export function menuThumbFile(source: string | number, radius?: number): Promise<string | null> {
  const key = `${typeof source === 'number' ? `asset:${source}` : source}#${radius ?? ''}`;
  let file = files.get(key);
  if (!file) {
    file = renderTile(source)
      .then((uri) =>
        radius && shapedImage ? shapedImage.clip(uri, radius, PixelRatio.get()).catch(() => uri) : uri,
      )
      .catch(() => null);
    files.set(key, file);
  }
  return file;
}

async function renderTile(source: string | number): Promise<string> {
  const px = Math.round(MENU_THUMB_PX * PixelRatio.get());
  const loaded = await Image.loadAsync(source, { maxWidth: 4 * px, maxHeight: 4 * px });
  try {
    const { width, height } = loaded;
    const side = Math.min(width, height);
    let context = ImageManipulator.manipulate(loaded);
    if (width !== height) {
      context = context.crop({
        originX: Math.floor((width - side) / 2),
        originY: Math.floor((height - side) / 2),
        width: side,
        height: side,
      });
    }
    const tile = await context.resize({ width: px, height: px }).renderAsync();
    try {
      return (await tile.saveAsync({ format: SaveFormat.PNG })).uri;
    } finally {
      tile.release();
    }
  } finally {
    loaded.release();
  }
}

/** The tiles for a selector's options, keyed by option, filling in as each renders. */
export function useMenuThumbFiles(
  thumbnails?: Record<string, string>,
  sources?: Record<string, number>,
  radius?: number,
): Record<string, string> {
  const wanted = useMemo(() => ({ ...thumbnails, ...sources }), [thumbnails, sources]);
  const [ready, setReady] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const [key, source] of Object.entries(wanted)) {
      void menuThumbFile(source, radius).then((uri) => {
        if (!live || !uri) return;
        setReady((prev) => (prev[key] === uri ? prev : { ...prev, [key]: uri }));
      });
    }
    return () => {
      live = false;
    };
  }, [wanted, radius]);
  return ready;
}
