import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type View as ViewType,
  type ImageStyle,
} from 'react-native';

import { CollectedItemMenu } from '@/components/collections/collected-item-menu';
import { ChapterItemIcon, PageItemIcon } from '@/components/icons/collection-icons';
import { CardCaption, CoverFrame, useCoverAspect } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ApiSavedItem } from '@/data/api';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { useIsZoomingSeries, useZoomOriginSource, useZoomSurfaceKey } from '@/lib/series-zoom';

/**
 * One tile in the saved grid — a saved CHAPTER or PAGE, drawn as the series card's cover frame over
 * its caption, shaped by the picture as a series card's is.
 *
 * Deliberately NOT `PageThumb`. That component exists to render a *bridge-supplied* thumbnail —
 * it lazily self-fetches via `getPageThumb`, which is series-level (no `chapterId`) and would be
 * wrong here, and it carries sprite-sheet cropping that a plain page URL doesn't need. What this
 * tile needs instead is the two states `PageThumb` has no concept of: a source that has died, and
 * an item the server could no longer locate.
 *
 * A page shows its page image (resolved per chapter by the grid); a CHAPTER is always the
 * placeholder — it has no image of its own, and borrowing one of its pages would cost a page-list
 * fetch per chapter just to draw a tile. The placeholder is also a page's fallback when its source
 * has died; the caption underneath, built from the stored snapshot, is what still says which item
 * it is. `stale` adds the "may no longer be available" bar.
 */
export function CollectedItemTile({
  item,
  uri,
  bridgeName,
  width,
  onPress,
  onWarm,
}: {
  item: ApiSavedItem;
  /** The page's URL as the bridge listed it, or `undefined` while its chapter list is still loading /
   *  unavailable. Only meaningful for a page item; a chapter has no image. */
  uri?: string;
  /** The grid is cross-bridge, so each tile names its source, as a Library series card does. */
  bridgeName: string;
  width: number;
  onPress: () => void;
  /** Start the fetch `onPress` is about to need. Supplied by whoever owns the navigation, since a
   *  chapter and a page open differently. */
  onWarm?: () => void;
}) {
  const theme = useTheme();
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

  // A bridge may list a page as a server-relative resolve route rather than a CDN URL, which
  // `<Image>` can't load as-is.
  const source = useResolvedAsset(item.type === 'page' ? uri : undefined);
  const showImage = !!source && !failed;
  const TypeIcon = item.type === 'chapter' ? ChapterItemIcon : PageItemIcon;
  const { chapterName } = item;

  const [pictureAspect, learnAspect] = useCoverAspect(item.id);
  // A placeholder has no picture to take a shape from, and never will have.
  const aspect = showImage ? pictureAspect : DEFAULT_THUMB_ASPECT;
  // Keyed by the URL it was measured from, so a recycled tile never sizes a new picture by the last.
  const [natural, setNatural] = useState<{ uri: string; aspect: number } | null>(null);
  const whole =
    Platform.OS === 'web' && natural && natural.uri === source ? wholePictureStyle(natural.aspect, aspect) : null;

  // ── The gallery zoom, exactly as a series card offers it (see lib/series-zoom) ──────────────
  // Press-in captures this tile's box as the zoom SOURCE RECT, so the reader it opens (sequence
  // mode, for a page) grows out of the tile and collapses back into it. The zoom is matched by SERIES id (that is the id the destination instance takes),
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
  // Radius matches the frame's — the flying copy is drawn with the same corners. The hook also
  // registers this tile as re-measurable for the collapse (see series-zoom).
  const captureZoomOrigin = useZoomOriginSource(item.seriesId, zoomKey, boxRef, 10, !isWeb && showImage);

  const card = (onLongPress?: (e: GestureResponderEvent) => void, menuOpen = false) => (
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
        item.type === 'chapter'
          ? `Chapter, ${item.seriesTitle}${chapterName ? `, ${chapterName}` : ''}`
          : `${item.seriesTitle}${chapterName ? `, ${chapterName}` : ''}, page ${item.pageIndex + 1}`
      }>
      <CoverFrame
        aspect={aspect}
        coverRef={boxRef}
        hidden={flying}
        ring={hovered || menuOpen}
        // A placeholder is this tile for good, not a moment before its picture, so it sits on the
        // theme's surface rather than the frame's loading grey.
        contentStyle={{ backgroundColor: theme.backgroundElement }}>
        {showImage ? (
          <Image
            source={{ uri: source }}
            style={whole ?? StyleSheet.absoluteFill}
            contentFit={whole ? 'fill' : 'cover'}
            cachePolicy="memory-disk"
            recyclingKey={item.id}
            onLoad={(e) => {
              const { width: w, height: h } = e.source ?? {};
              if (!w || !h) return;
              learnAspect(w, h);
              if (source) setNatural({ uri: source, aspect: w / h });
            }}
            onError={() => setFailed(true)}
          />
        ) : (
          <View style={styles.fallback}>
            <TypeIcon color={theme.textSecondary} size={32} />
          </View>
        )}

        {/* Which page of the chapter — the caption already names the chapter. Its own scrim, since
            it reads against the picture rather than the theme. */}
        {item.type === 'page' && (
          <View style={styles.badge}>
            <PageItemIcon color="#fff" size={12} />
            <ThemedText type="small" style={styles.badgeText}>
              {item.pageIndex + 1}
            </ThemedText>
          </View>
        )}

        {item.stale && (
          <View style={[styles.staleBar, { backgroundColor: theme.danger }]}>
            <ThemedText type="small" numberOfLines={1} style={styles.staleText}>
              May no longer be available
            </ThemedText>
          </View>
        )}
      </CoverFrame>
      <CardCaption title={item.seriesTitle} sub={chapterName ? `${bridgeName} · ${chapterName}` : bridgeName} />
    </Pressable>
  );

  return (
    <CollectedItemMenu item={item} onOpen={onPress}>
      {({ onLongPress, menuOpen }) => card(onLongPress, menuOpen)}
    </CollectedItemMenu>
  );
}

/**
 * The picture at its own shape, scaled to cover a box of `box` aspect and centred — the clip crops it.
 *
 * Web only, and not cosmetic: `object-fit: cover` draws a SUBSET of the image, and Chromium filters a
 * subset draw without mipmaps. A full reader page squeezed ~7× into a tile that way samples its
 * screentone point by point, which comes out as harsh blotches; the same draw over the whole image is
 * mipmapped and smooth. The tile only escaped it when its box happened to match the page's shape
 * exactly — a learned aspect on a revisit — which is why a grid looked broken on its first open and
 * fine on the next.
 */
function wholePictureStyle(picture: number, box: number): ImageStyle {
  if (picture < box) {
    const height = (box / picture) * 100;
    return { position: 'absolute', left: 0, width: '100%', height: `${height}%`, top: `${(100 - height) / 2}%` };
  }
  const width = (picture / box) * 100;
  return { position: 'absolute', top: 0, height: '100%', width: `${width}%`, left: `${(100 - width) / 2}%` };
}

const styles = StyleSheet.create({
  // The series card's own gap between a cover and its title.
  card: {
    gap: Spacing.two,
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
  badgeText: {
    color: '#fff',
    fontSize: 11,
  },
  staleBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.one,
    paddingVertical: 2,
  },
  staleText: {
    color: '#fff',
    fontSize: 10,
    textAlign: 'center',
  },
});
