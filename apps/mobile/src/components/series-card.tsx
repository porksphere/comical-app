import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardBadge, UnreadBadge } from '@/components/card-badge';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/mock';

// Shared cover card used by both the browse grid and the rails. `size` picks the
// fixed rail widths; `grid` fills its parent slot (the grid controls columns).
// Mirrors `.card` in the reference: chrome-less cover (2:3, radius 10) with
// overlaid badges, a clamped title, and an optional subtitle.

export type CardSize = 'grid' | 'rail' | 'ranked' | 'hero';

const WIDTHS: Record<Exclude<CardSize, 'grid'>, number> = {
  rail: 130,
  ranked: 150,
  hero: 240,
};

export function SeriesCard({
  entry,
  size = 'grid',
  rank,
}: {
  entry: SeriesEntry;
  size?: CardSize;
  rank?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const fixedWidth = size === 'grid' ? undefined : WIDTHS[size];

  return (
    <Link
      href={{ pathname: '/series', params: { id: entry.id, title: entry.title } }}
      asChild>
      {/* Flatten to a single style object: as the `asChild` of <Link>, the
          Pressable is cloned by expo-router's <Slot>, which rejects array styles. */}
      <Pressable style={StyleSheet.flatten([styles.card, fixedWidth != null && { width: fixedWidth }])}>
        {({ pressed }) => (
          <>
            <View style={[styles.cover, pressed && styles.coverPressed]}>
              <Image
                source={{ uri: entry.cover }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                onLoad={() => setLoaded(true)}
              />
              {!loaded && <Skeleton style={StyleSheet.absoluteFill} />}
              {entry.badges?.map((b, i) => <CardBadge key={i} badge={b} />)}
              {entry.unread != null && <UnreadBadge count={entry.unread} />}
              {rank != null && (
                <View style={styles.rank}>
                  <ThemedText style={styles.rankText}>{rank}</ThemedText>
                </View>
              )}
            </View>
            <ThemedText type="small" numberOfLines={size === 'grid' ? 3 : 2} style={styles.title}>
              {entry.title}
            </ThemedText>
            {entry.sub ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.sub}>
                {entry.sub}
              </ThemedText>
            ) : null}
          </>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.one,
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  coverPressed: {
    borderColor: '#60a5fa',
    opacity: 0.85,
  },
  title: {
    fontWeight: '600',
    lineHeight: 18,
  },
  sub: {
    fontSize: 12,
    lineHeight: 16,
  },
  rank: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    zIndex: 2,
    backgroundColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  rankText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
});
