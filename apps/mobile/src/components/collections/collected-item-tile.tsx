import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type View as ViewType } from 'react-native';

import { ChapterItemIcon, PageItemIcon, SeriesItemIcon } from '@/components/icons/collection-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ApiCollectionItem } from '@/data/api';
import { useTheme } from '@/hooks/use-theme';
import { useIsZoomingSeries, useZoomOriginSource, useZoomSurfaceKey } from '@/lib/series-zoom';

/**
 * One tile in the collected grid — a saved SERIES, CHAPTER or PAGE. All three are the same 2:3
 * card; the type-icon badge (top-left) is what tells them apart, so the grid reads as one surface
 * instead of three interleaved layouts.
 *
 * Deliberately NOT `PageThumb`. That component exists to render a *bridge-supplied* thumbnail —
 * it lazily self-fetches via `getPageThumb`, which is series-level (no `chapterId`) and would be
 * wrong here, and it carries sprite-sheet cropping and aspect learning that a plain page URL
 * doesn't need. What this tile needs instead is the two states `PageThumb` has no concept of: a
 * source that has died, and an item the server could no longer locate.
 *
 * Image per type: a page shows its page image (resolved per chapter by the grid), a series shows
 * its cover, and a CHAPTER is always the text card — it has no image of its own, and borrowing one
 * of its pages would cost a page-list fetch per chapter just to draw a tile. The text card is also
 * every type's fallback when a source has died, built from the stored snapshot so a row never
 * becomes a blank square; `stale` adds the "may no longer be available" bar on top.
 */
export function CollectedItemTile({
  item,
  uri,
  width,
  height,
  onPress,
  onWarm,
}: {
  item: ApiCollectionItem;
  /** Resolved page URL, or `undefined` while its chapter list is still loading / unavailable.
   *  Only meaningful for a page item; a series carries its own cover, a chapter has no image. */
  uri?: string;
  width: number;
  height: number;
  onPress: () => void;
  /** Start the fetch `onPress` is about to need. Supplied by whoever owns the navigation, since the
   *  three item types go three different places — see library's `onOpen`. */
  onWarm?: () => void;
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

  const source = item.type === 'series' ? item.thumbnailUrl : item.type === 'page' ? uri : undefined;
  const showImage = !!source && !failed;
  const TypeIcon =
    item.type === 'series' ? SeriesItemIcon : item.type === 'chapter' ? ChapterItemIcon : PageItemIcon;
  const chapterName = item.type === 'series' ? undefined : item.chapterName;

  // ── The gallery zoom, exactly as a series card offers it (see lib/series-zoom) ──────────────
  // Press-in captures this tile's box as the zoom SOURCE RECT, so the screen it opens — the reader
  // in sequence mode for a page, the details for a series — grows out of the tile and collapses
  // back into it. The zoom is matched by SERIES id (that is the id the destination instance takes),
  // but the source key is PER ITEM, derived from the item's own id rather than from the list: this
  // grid can legitimately show the same series several times (two saved pages of one series), and
  // a list-level key would blank every sibling on behalf of the one that was tapped. Item-derived
  // also survives recycling for free — a reused tile re-renders with the new item's key.
  //
  // Text-card tiles (chapters, dead sources) don't capture: the transition flies a COPY of the
  // picture, and a tile with no picture would blank into a hole with nothing in the air to stand
  // in for it. They open with the ordinary entrance instead.
  const isWeb = Platform.OS === 'web';
  const zoomKey = useZoomSurfaceKey(`collected:${item.id}`);
  const flying = useIsZoomingSeries(item.seriesId, zoomKey);
  const boxRef = useRef<ViewType>(null);
  // Radius matches styles.tile — the flying copy is drawn with the same corners. The hook also
  // registers this tile as re-measurable for the collapse (see series-zoom).
  const captureZoomOrigin = useZoomOriginSource(item.seriesId, zoomKey, boxRef, 10, !isWeb && showImage);

  return (
    <Pressable
      ref={boxRef}
      testID={`collected.tile.${item.id}`}
      onPressIn={() => {
        captureZoomOrigin();
        onWarm?.();
      }}
      onPress={onPress}
      style={[styles.tile, { width, height, backgroundColor: theme.backgroundElement }]}
      accessibilityRole="button"
      accessibilityLabel={
        item.type === 'series'
          ? `Series, ${item.seriesTitle}`
          : item.type === 'chapter'
            ? `Chapter, ${item.seriesTitle}${chapterName ? `, ${chapterName}` : ''}`
            : `${item.seriesTitle}${chapterName ? `, ${chapterName}` : ''}, page ${item.pageIndex + 1}`
      }>
      {showImage ? (
        // While a zoom this tile is the source of is in the air, a COPY of this picture is what
        // flies — the original (and the overlays drawn on it) blank so there aren't two. Layout is
        // preserved; the tile's background stays, same as a series card's coverHidden.
        <Image
          source={{ uri: source }}
          style={[StyleSheet.absoluteFill, flying && styles.hidden]}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.fallback}>
          <ThemedText type="small" numberOfLines={3} style={styles.fallbackTitle}>
            {item.seriesTitle}
          </ThemedText>
          {!!chapterName && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {chapterName}
            </ThemedText>
          )}
        </View>
      )}

      {/* The badge reads against the image, so it needs its own scrim rather than the theme.
          The icon is the type; a page also carries its number, since "which page of the chapter"
          matters there the way it can't for the other two. */}
      <View style={[styles.badge, flying && styles.hidden]}>
        <TypeIcon color="#fff" size={12} />
        {item.type === 'page' && (
          <ThemedText type="small" style={styles.badgeText}>
            {item.pageIndex + 1}
          </ThemedText>
        )}
      </View>

      {item.stale && (
        <View style={[styles.staleBar, { backgroundColor: theme.danger }, flying && styles.hidden]}>
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
  badge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
    paddingVertical: 2,
    borderRadius: Spacing.one,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  badgeText: {
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
  // Blanks the picture (and its overlays) while this tile's zoom transition is flying a copy of
  // it — leaving the original visible would double it through the collapse's transparency.
  hidden: {
    opacity: 0,
  },
});
