import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useMemo, useState } from 'react';

/**
 * A menu row's picture as a FILE: the system menu (`NativeSelector`) takes a row's image only as a
 * local file it reads itself, so a bridge's thumbnail — a URL, or the bundled Comical asset — is
 * rendered down to one once and kept for the session. The file is the size the row shows it at:
 * a menu draws a 1× image point for pixel, so a tile rendered at `MENU_THUMB_PX` square is a
 * `MENU_THUMB_PX`-point tile, with nothing for the row to scale.
 */
export const MENU_THUMB_PX = 28;

const files = new Map<string, Promise<string | null>>();

/** Resolves to the `file://` URI of `source`'s tile, or null when it can't be loaded. */
export function menuThumbFile(source: string | number): Promise<string | null> {
  const key = typeof source === 'number' ? `asset:${source}` : source;
  let file = files.get(key);
  if (!file) {
    file = renderTile(source).catch(() => null);
    files.set(key, file);
  }
  return file;
}

async function renderTile(source: string | number): Promise<string> {
  const loaded = await Image.loadAsync(source, { maxWidth: 4 * MENU_THUMB_PX, maxHeight: 4 * MENU_THUMB_PX });
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
    const tile = await context.resize({ width: MENU_THUMB_PX, height: MENU_THUMB_PX }).renderAsync();
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
): Record<string, string> {
  const wanted = useMemo(() => ({ ...thumbnails, ...sources }), [thumbnails, sources]);
  const [ready, setReady] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const [key, source] of Object.entries(wanted)) {
      void menuThumbFile(source).then((uri) => {
        if (!live || !uri) return;
        setReady((prev) => (prev[key] === uri ? prev : { ...prev, [key]: uri }));
      });
    }
    return () => {
      live = false;
    };
  }, [wanted]);
  return ready;
}
