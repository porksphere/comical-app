import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { TagStrip } from '@/components/chip';
import { buildMetaLine } from '@/components/series-card-context-menu';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { seriesDetailQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { SeriesEntry } from '@/data/types';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';
import { clampThumbAspect, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';

const PAD = Spacing.three;
const COVER_W = 118;
const DESC_LINES = 3;

/**
 * What iOS's system context menu grows a held series into (series-card-menu.ios.tsx): the Android
 * hold popup's panel (series-card-context-menu.tsx) without what it lets you tap, since UIKit's
 * preview takes no touches. The page rail goes with them; the tags stay, to read.
 */
export function SeriesCardPreview({
  bridgeId,
  entry,
  direct,
  coverAspect,
}: {
  bridgeId: string;
  entry: SeriesEntry;
  direct?: boolean;
  coverAspect?: number;
}) {
  const theme = useTheme();
  const ds = useDataSource();
  const mock = useMockActive();
  // The same query and options the card's press-in warms (useWarmSeriesDetail), so it is usually here.
  const detail = useQuery(
    seriesDetailQuery(ds, mock, bridgeId, entry.id, {
      direct: !!direct,
      title: entry.title,
      cover: entry.cover,
    }),
  );
  const cover = useResolvedAsset(entry.cover);
  const loaded = !!detail.data && !detail.isPlaceholderData;
  const metaLine = buildMetaLine(detail.data?.meta, detail.data?.chapterCount, direct);
  const coverH = COVER_W / clampThumbAspect(coverAspect ?? DEFAULT_THUMB_ASPECT);

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundPanel }]}>
      <View style={styles.topRow}>
        <View style={[styles.cover, { height: coverH, backgroundColor: theme.backgroundElement }]}>
          {cover ? (
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : null}
        </View>
        <View style={styles.info}>
          <ThemedText style={styles.title} numberOfLines={3}>
            {entry.title}
          </ThemedText>
          {loaded ? (
            <>
              {metaLine ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {metaLine}
                </ThemedText>
              ) : null}
              {detail.data?.description ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={DESC_LINES}>
                  {detail.data.description}
                </ThemedText>
              ) : null}
            </>
          ) : (
            <View style={styles.skeletons}>
              <Skeleton style={[styles.line, styles.metaLine]} />
              <Skeleton style={styles.line} />
              <Skeleton style={styles.line} />
              <Skeleton style={[styles.line, styles.shortLine]} />
            </View>
          )}
        </View>
      </View>
      {loaded ? <TagStrip groups={detail.data?.tagGroups} contentInset={PAD} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Vertical padding only: the tag strip runs to the edges and carries its own inset.
  panel: {
    paddingVertical: PAD,
    gap: Spacing.three,
  },
  topRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: PAD,
  },
  cover: {
    ...ContinuousCorner,
    width: COVER_W,
    borderRadius: 10,
    overflow: 'hidden',
  },
  info: {
    flex: 1,
    gap: Spacing.one,
  },
  title: {
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 21,
  },
  skeletons: {
    gap: 8,
    paddingTop: 4,
  },
  line: {
    height: 12,
    borderRadius: 4,
  },
  metaLine: {
    width: '70%',
    marginBottom: 4,
  },
  shortLine: {
    width: '55%',
  },
});
