import { useEffect, useState } from 'react';
import { Dimensions } from 'react-native';

import { concentric, SQUARE, type Radii } from '@/components/reader/page-curl-geometry';
import ScreenCorners from '../../../modules/screen-corners';

/** The window's corners as last read, by the window's size, which is what changes them (a turn of
 *  the device, a fold, a resize). Shared by every reader that asks. */
let cached: { key: string; corners: Promise<Radii> } | null = null;

function windowCorners(): Promise<Radii> {
  const { width, height } = Dimensions.get('window');
  const key = `${width}x${height}`;
  if (cached?.key !== key) {
    const read = ScreenCorners?.windowCorners().catch(() => null) ?? Promise.resolve(null);
    cached = { key, corners: read.then((radii) => radii ?? SQUARE) };
  }
  return cached.corners;
}

/**
 * The corners of a reader viewport `width` × `height`, which sits in the window `top` down from its
 * top and centred across it — where the reader is placed. Each takes the window's corner, the
 * display's own rounding, as far as the viewport reaches into it (`concentric`): the whole radius
 * for a reader drawn edge to edge, less for one inset from the screen's edges, none at a hard edge.
 * Square on the web and wherever the system won't say.
 */
export function useViewportCorners(width: number, height: number, top = 0): Radii {
  const [window, setWindow] = useState<Radii>(SQUARE);
  useEffect(() => {
    let live = true;
    void windowCorners().then((radii) => {
      if (live) setWindow(radii);
    });
    return () => {
      live = false;
    };
  }, [width, height]);
  const screen = Dimensions.get('window');
  const side = Math.max(0, (screen.width - width) / 2);
  const bottom = Math.max(0, screen.height - height - top);
  return [
    concentric(window[0], side, top),
    concentric(window[1], side, top),
    concentric(window[2], side, bottom),
    concentric(window[3], side, bottom),
  ];
}
