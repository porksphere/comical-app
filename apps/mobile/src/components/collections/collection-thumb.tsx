import type { ImageStyle, StyleProp } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import { AsteriskIcon } from '@/components/icons/ui-icons';
import { useTheme } from '@/hooks/use-theme';

/**
 * A collection's tile — the letter tile a bridge with no art gets, so Library's scopes are marked
 * the way Browse's are wherever either is listed. `name` is `null` for "All": it is not a
 * collection, so it takes a mark where the others take an initial.
 */
export function CollectionThumb({
  name,
  size,
  style,
}: {
  name: string | null;
  size: number;
  style?: StyleProp<ImageStyle>;
}) {
  const theme = useTheme();
  // An EVEN number of pixels smaller than the tile, so the margin either side of the mark is a whole
  // pixel and the same one: lucide's asterisk is drawn about its box's centre, and a half-pixel
  // split is the only thing that could put it off the tile's. The asterisk spans half its box, so
  // a box nearly the tile's size is what stands it as tall as the others' initials.
  const mark = size - 2 * Math.round(size * 0.07);
  return (
    <BridgeThumb
      label={name ?? 'All'}
      glyph={name === null ? <AsteriskIcon color={theme.text} size={mark} strokeWidth={2.5} /> : undefined}
      size={size}
      style={style}
    />
  );
}
