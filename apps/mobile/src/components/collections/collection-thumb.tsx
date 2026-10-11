import type { ImageStyle, StyleProp } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import { AsteriskIcon } from '@/components/icons/ui-icons';
import { isAllView } from '@/data/selected-collection';
import { useTheme } from '@/hooks/use-theme';

/**
 * A Library view's tile — the letter tile a bridge with no art gets, so Library's scopes are marked
 * the way Browse's are wherever either is listed. `view` is the selection (any All view, or a
 * collection id); only a collection takes an initial, from `name`.
 */
export function CollectionThumb({
  view,
  name,
  size,
  style,
}: {
  view: string | null;
  name: string;
  size: number;
  style?: StyleProp<ImageStyle>;
}) {
  const theme = useTheme();
  // An EVEN number of pixels smaller than the tile, so the margin either side of the mark is a whole
  // pixel and the same one: lucide's asterisk is drawn about its box's centre, and a half-pixel
  // split is the only thing that could put it off the tile's. The asterisk spans half its box, so
  // a box nearly the tile's size is what stands it as tall as the others' initials.
  const mark = size - 2 * Math.round(size * 0.07);
  const glyph = isAllView(view) ? <AsteriskIcon color={theme.text} size={mark} strokeWidth={2.5} /> : undefined;
  return <BridgeThumb label={name} glyph={glyph} size={size} style={style} />;
}
