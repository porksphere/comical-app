import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type View as ViewType,
} from 'react-native';

import { CollectedItemMenu } from '@/components/collections/collected-item-menu';
import { ChapterItemIcon, PageItemIcon, SeriesItemIcon } from '@/components/icons/collection-icons';
import { CardCaption, COVER_RADIUS_DESKTOP } from '@/components/series-card';
import { SeriesCardMenu } from '@/components/series-card-menu';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ApiCollectionItem } from '@/data/api';
import { useIsDesktop } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { useIsZoomingSeries, useZoomOriginSource, useZoomSurfaceKey } from '@/lib/series-zoom';

/**
 * One tile in the collected grid — a saved SERIES, CHAPTER or PAGE. All three are the same 2:3
 * cover over the series card's caption; the type-icon badge (top-left) is what tells them apart, so
 * the grid reads as one surface instead of three interleaved layouts.
 *
 * Deliberately NOT `PageThumb`. That component exists to render a *bridge-supplied* thumbnail —
 * it lazily self-fetches via `getPageThumb`, which is series-level (no `chapterId`) and would be
 * wrong here, and it carries sprite-sheet cropping and aspect learning that a plain page URL
 * doesn't need. What this tile needs instead is the two states `PageThumb` has no concept of: a
 * source that has died, and an item the server could no longer locate.
 *
 * Image per type: a page shows its page image (resolved per chapter by the grid), a series shows
 * its cover, and a CHAPTER is always the placeholder — it has no image of its own, and borrowing
 * one of its pages would cost a page-list fetch per chapter just to draw a tile. The placeholder is
 * also every type's fallback when a source has died; the caption underneath, built from the stored
 * snapshot, is what still says which item it is. `stale` adds the "may no longer be available" bar.
 *
 * Every tile has a menu. A series takes the series card's, the one its Library card opens; a
 * chapter or a page takes `CollectedItemMenu`.
 */
export function CollectedItemTile({
  item,
  uri,
  sub,
  bridge,
  direct,
  width,
  coverHeight,
  onPress,
  onWarm,
}: {
  item: ApiCollectionItem;
  /** Resolved page URL, or `undefined` while its chapter list is still loading / unavailable.
   *  Only meaningful for a page item; a series carries its own cover, a chapter has no image. */
  uri?: string;
  /** The caption's second line — whatever the series title alone doesn't say about this item. */
  sub?: string;
  /** The bridge's name and whether it is a direct one — a series tile's menu needs both, as a
   *  series card's does. */
  bridge?: string;
  direct?: boolean;
  width: number;
  coverHeight: number;
  onPress: () => void;
  /** Start the fetch `onPress` is about to need. Supplied by whoever owns the navigation, since the
   *  three item types go three different places — see library's `onOpen`. */
  onWarm?: () => void;
}) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Recycle-safety: this tile is reused for a different item as the list scrolls, so a failure
  // recorded for the previous one must not stick. React's own "adjust state on prop change"
  // pattern — a ref would survive a discarded render and leave the wrong item looking broken.
  const [seenId, setSeenId] = useState(item.id);
  if (seenId !== item.id) {
    setSeenId(item.id);
    setFailed(false);
    setHovered(false);
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
  // Placeholder tiles (chapters, dead sources) don't capture: the transition flies a COPY of the
  // picture, and a tile with no picture would blank into a hole with nothing in the air to stand
  // in for it. They open with the ordinary entrance instead.
  const isWeb = Platform.OS === 'web';
  const zoomKey = useZoomSurfaceKey(`collected:${item.id}`);
  const flying = useIsZoomingSeries(item.seriesId, zoomKey);
  const boxRef = useRef<ViewType>(null);
  // Radius matches styles.tile — the flying copy is drawn with the same corners. The hook also
  // registers this tile as re-measurable for the collapse (see series-zoom).
  const captureZoomOrigin = useZoomOriginSource(item.seriesId, zoomKey, boxRef, 10, !isWeb && showImage);

  // `lifted` is the native series menu holding a copy of this cover up as its preview: the same
  // two-of-them problem as a zoom in flight, with the same answer.
  const card = (onLongPress?: (e: GestureResponderEvent) => void, lifted = false) => {
    const blank = flying || lifted;
    return (
      <Pressable
        testID={`collected.tile.${item.id}`}
        onPressIn={() => {
          captureZoomOrigin();
          onWarm?.();
        }}
        onPress={onPress}
        onLongPress={onLongPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.card, { width }]}
        accessibilityRole="button"
        accessibilityLabel={
          item.type === 'series'
            ? `Series, ${item.seriesTitle}`
            : item.type === 'chapter'
              ? `Chapter, ${item.seriesTitle}${chapterName ? `, ${chapterName}` : ''}`
              : `${item.seriesTitle}${chapterName ? `, ${chapterName}` : ''}, page ${item.pageIndex + 1}`
        }>
        <View
          ref={boxRef}
          style={[
            styles.tile,
            desktop && styles.tileDesktop,
            { height: coverHeight, backgroundColor: theme.backgroundElement },
          ]}>
          {showImage ? (
            // While a zoom this tile is the source of is in the air, a COPY of this picture is what
            // flies — the original (and the overlays drawn on it) blank so there aren't two. Layout is
            // preserved; the tile's background stays, same as a series card's coverHidden.
            <Image
              source={{ uri: source }}
              style={[StyleSheet.absoluteFill, blank && styles.hidden]}
              contentFit="cover"
              cachePolicy="memory-disk"
              onError={() => setFailed(true)}
            />
          ) : (
            <View style={styles.fallback}>
              <TypeIcon color={theme.textSecondary} size={32} />
            </View>
          )}

          {/* The badge reads against the image, so it needs its own scrim rather than the theme.
              The icon is the type; a page also carries its number, since "which page of the chapter"
              matters there the way it can't for the other two. */}
          <View style={[styles.badge, desktop && styles.badgeDesktop, blank && styles.hidden]}>
            <TypeIcon color="#fff" size={12} />
            {item.type === 'page' && (
              <ThemedText type="small" style={styles.badgeText}>
                {item.pageIndex + 1}
              </ThemedText>
            )}
          </View>

          {item.stale && (
            <View style={[styles.staleBar, { backgroundColor: theme.danger }, blank && styles.hidden]}>
              <ThemedText type="small" numberOfLines={1} style={styles.staleText}>
                May no longer be available
              </ThemedText>
            </View>
          )}

          {/* The series card's hover ring, so a collection reads as the same grid the rest of the
              library is. Web only: hover fires for a pointer on a tablet too, which has no ring anywhere. */}
          {isWeb && hovered && (
            <View
              style={[
                styles.ring,
                desktop && styles.tileDesktop,
                { borderColor: theme.text, pointerEvents: 'none' },
              ]}
            />
          )}
        </View>
        <CardCaption title={item.seriesTitle} sub={sub} />
      </Pressable>
    );
  };

  if (item.type === 'series') {
    return (
      <SeriesCardMenu
        enabled
        bridgeId={item.bridgeId}
        bridge={bridge}
        entry={{ id: item.seriesId, title: item.seriesTitle, cover: item.thumbnailUrl ?? '' }}
        direct={direct}
        coverAspect={width / coverHeight}
        // The cover, not the card: the preview is a cover, and lifting it from a rect that takes
        // in the caption starts it too tall.
        measureRef={boxRef}
        zoomSource={zoomKey}>
        {({ onLongPress, hidden }) => card(onLongPress, hidden)}
      </SeriesCardMenu>
    );
  }
  return (
    <CollectedItemMenu item={item} onOpen={onPress}>
      {({ onLongPress }) => card(onLongPress)}
    </CollectedItemMenu>
  );
}

const styles = StyleSheet.create({
  // The series card's own gap between a cover and its title.
  card: {
    gap: Spacing.two,
  },
  tile: {
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  tileDesktop: {
    borderRadius: COVER_RADIUS_DESKTOP,
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: 10,
    borderWidth: 2,
  },
  fallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
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
  // The desktop cover's corner curves through where the phone's chip sits, so it moves in to
  // clear it and takes a corner of its own that follows the curve.
  badgeDesktop: {
    top: Spacing.two,
    left: Spacing.two,
    borderRadius: Spacing.two,
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
