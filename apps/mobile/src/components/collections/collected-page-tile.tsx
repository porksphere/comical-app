import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { TileItem } from '@/data/collected-rows';
import { useTheme } from '@/hooks/use-theme';

/**
 * One tile in the collected grid — a saved PAGE or a saved SERIES. Both are 2:3 images with a
 * title behind them, so they share a tile rather than duplicating the fallback and stale handling;
 * only the badge and the image source differ.
 *
 * Deliberately NOT `PageThumb`. That component exists to render a *bridge-supplied* thumbnail —
 * it lazily self-fetches via `getPageThumb`, which is series-level (no `chapterId`) and would be
 * wrong here, and it carries sprite-sheet cropping and aspect learning that a plain page URL
 * doesn't need. What this tile needs instead is the two states `PageThumb` has no concept of: a
 * source that has died, and an item the server could no longer locate.
 *
 * Three renders, in order of preference:
 *  - the page image, once its chapter's page list resolves (see `useCollectedPageUris`);
 *  - a TEXT tile built from the stored snapshot, when there is no URL or the image fails — a
 *    bridge can be uninstalled or a source can go dark, and the snapshot is carried precisely so
 *    the row doesn't become a blank square;
 *  - the same text tile with a "may no longer be available" note when the item is `stale`.
 */
export function CollectedPageTile({
  item,
  uri,
  width,
  height,
  onPress,
}: {
  item: TileItem;
  /** Resolved page URL, or `undefined` while its chapter list is still loading / unavailable.
   *  Ignored for a series item, which carries its own cover. */
  uri?: string;
  width: number;
  height: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  // Recycle-safety: this tile is reused for a different item as the list scrolls, so a failure
  // recorded for the previous one must not stick. React's own "adjust state on prop change"
  // pattern — a ref would survive a discarded render and leave the wrong item looking broken.
  const [seenId, setSeenId] = useState(item.id);
  if (seenId !== item.id) {
    setSeenId(item.id);
    setFailed(false);
  }

  // A series item carries its cover directly; a page's URL is resolved per chapter by the grid.
  const source = item.type === 'series' ? item.thumbnailUrl : uri;
  const showImage = !!source && !failed;

  return (
    <Pressable
      testID={`collected.tile.${item.id}`}
      onPress={onPress}
      style={[styles.tile, { width, height, backgroundColor: theme.backgroundElement }]}
      accessibilityRole="button"
      accessibilityLabel={
        item.type === 'series'
          ? item.seriesTitle
          : `${item.seriesTitle}${item.chapterName ? `, ${item.chapterName}` : ''}, page ${item.pageIndex + 1}`
      }>
      {showImage ? (
        <Image
          source={{ uri: source }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.fallback}>
          <ThemedText type="small" numberOfLines={3} style={styles.fallbackTitle}>
            {item.seriesTitle}
          </ThemedText>
          {item.type === 'page' && !!item.chapterName && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {item.chapterName}
            </ThemedText>
          )}
        </View>
      )}

      {/* The badge reads against the image, so it needs its own scrim rather than the theme.
          A page shows its number; a series says what it is, since a bare cover in a grid of pages
          is otherwise indistinguishable from one. */}
      <View style={styles.pageBadge}>
        <ThemedText type="small" style={styles.pageBadgeText}>
          {item.type === 'series' ? 'Series' : item.pageIndex + 1}
        </ThemedText>
      </View>

      {item.stale && (
        <View style={[styles.staleBar, { backgroundColor: theme.danger }]}>
          <ThemedText type="small" numberOfLines={1} style={styles.staleText}>
            May no longer be available
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fallback: {
    ...StyleSheet.absoluteFill,
    padding: Spacing.two,
    justifyContent: 'center',
    gap: Spacing.half,
  },
  fallbackTitle: {
    fontWeight: '700',
  },
  pageBadge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: Spacing.one,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pageBadgeText: {
    color: '#fff',
    fontSize: 11,
  },
  staleBar: {
    paddingHorizontal: Spacing.one,
    paddingVertical: 2,
  },
  staleText: {
    color: '#fff',
    fontSize: 10,
    textAlign: 'center',
  },
});
