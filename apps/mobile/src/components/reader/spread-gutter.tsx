import { StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Side } from '@/components/reader/gutter-bands';
import { containedSize, type Size } from '@/components/reader/page-geometry';

export { halfLayout } from '@/components/reader/gutter-bands';
export { useSpreadColors } from '@/components/reader/gutter-colors';

const FADE_MS = 160;
/** How far the fill runs on under its page. Ended at the page's edge as worked out here, it left
 *  a hairline of the black behind both: the image is placed in its box by expo-image, and its edge
 *  falls between pixels, blended with whatever is under it. Under the page, the overlap is hidden. */
const UNDER_PAGE = 1;

/**
 * The fill beside one page of a spread (`spreadFill`): the part of the page's half on its `side`,
 * between the page and the half's edge, in its colour (`useSpreadColors`), level with the
 * page. Drawn under the page, in its half's box, so the page turns with it under the curl, which
 * takes its picture of the whole half. Nothing until the page has loaded and the colour is known:
 * the reader's background, as without the setting.
 */
export function SpreadGutter({
  side,
  width,
  height,
  image,
  color,
}: {
  /** The side of the half filled; the page is against the other side. */
  side: Side;
  /** The half's box. */
  width: number;
  height: number;
  /** The picture's own size, once loaded. */
  image: Size | null;
  color: string | null;
}) {
  if (!image || !color) return null;
  const page = containedSize(image, { width, height });
  const gap = width - page.width;
  if (gap < 0.5) return null;
  const frame = {
    left: side === 'right' ? page.width - UNDER_PAGE : 0,
    top: (height - page.height) / 2,
    width: gap + UNDER_PAGE,
    height: page.height,
    backgroundColor: color,
  };
  return <Animated.View entering={FadeIn.duration(FADE_MS)} pointerEvents="none" style={[styles.fill, frame]} />;
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
  },
});
