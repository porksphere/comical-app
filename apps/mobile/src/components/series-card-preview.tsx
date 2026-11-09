import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ContinuousCorner } from '@/constants/theme';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';

/** The preview's widest, on a tablet or a desktop window. */
const MAX_WIDTH = 360;
/** The most of the window's height the cover may take, leaving the menu room beneath it. */
const MAX_HEIGHT_SHARE = 0.5;
/** The resting cover's corner. */
export const COVER_PREVIEW_RADIUS = 12;

/**
 * The size a held series' cover grows to: as large as `room` allows at the cover's own `aspect`
 * (width over height), capped so the menu still fits beneath it. What Books and Photos do with a
 * held item, and what both menus draw: iOS's system preview, Android's hold popup.
 */
export function coverPreviewSize(aspect: number, room: { width: number; height: number }): { width: number; height: number } {
  const width = Math.round(Math.min(room.width, MAX_WIDTH, room.height * MAX_HEIGHT_SHARE * aspect));
  return { width, height: Math.round(width / aspect) };
}

/** The cover alone, filling the box it is given: what iOS's system context menu grows a held
 *  series into (series-card-menu.ios.tsx). UIKit's preview takes no touches. */
export function SeriesCardPreview({ cover }: { cover: string }) {
  const theme = useTheme();
  const uri = useResolvedAsset(cover);
  return (
    <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...ContinuousCorner,
    flex: 1,
    borderRadius: COVER_PREVIEW_RADIUS,
    overflow: 'hidden',
  },
});
