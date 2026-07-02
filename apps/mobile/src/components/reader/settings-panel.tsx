import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsIcon } from '@/components/icons/reader-icons';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { isFavoriteQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import {
  useReaderSettings,
  type PageFit,
  type PrefetchAhead,
  type ReaderDirection,
  type ReaderMode,
} from '@/hooks/use-reader-settings';

/** Gear button (bottom-right) that toggles a small reader-settings card. */
export function SettingsControl({
  visible,
  bridgeId,
  seriesId,
}: {
  visible: boolean;
  /** When both are set, a "This series" Favorite row is shown — omitted on bridges/pages
   *  where the reader was opened without a resolvable series (shouldn't normally happen). */
  bridgeId?: string;
  seriesId?: string;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [settings, set] = useReaderSettings();
  const style = useAnimatedStyle(() => ({ opacity: withTiming(visible ? 1 : 0, { duration: 200 }) }));

  return (
    <Animated.View
      style={[styles.wrap, { bottom: insets.bottom + Spacing.two }, style]}
      pointerEvents={visible ? 'box-none' : 'none'}>
      {open && (
        <View style={styles.panel}>
          <Segment
            label="Mode"
            value={settings.mode}
            options={[
              ['paged', 'Paged'],
              ['webtoon', 'Webtoon'],
            ]}
            onChange={(v) => set({ mode: v as ReaderMode })}
          />
          {settings.mode === 'paged' && (
            <>
              <Segment
                label="Direction"
                value={settings.direction}
                options={[
                  ['ltr', 'L → R'],
                  ['rtl', 'R → L'],
                ]}
                onChange={(v) => set({ direction: v as ReaderDirection })}
              />
              <Segment
                label="Page fit"
                value={settings.pageFit}
                options={[
                  ['fit-page', 'Fit page'],
                  ['fit-width', 'Fit width'],
                ]}
                onChange={(v) => set({ pageFit: v as PageFit })}
              />
            </>
          )}
          <Segment
            label="Preload ahead"
            value={String(settings.prefetchAhead)}
            options={[1, 2, 3, 4, 6, 8].map((n) => [String(n), String(n)] as [string, string])}
            onChange={(v) => set({ prefetchAhead: Number(v) as PrefetchAhead })}
          />
          {bridgeId && seriesId && <FavoriteRow bridgeId={bridgeId} seriesId={seriesId} />}
        </View>
      )}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.gear}
        accessibilityRole="button"
        accessibilityLabel="Reader settings">
        <SettingsIcon color="#fff" size={20} />
      </Pressable>
    </Animated.View>
  );
}

/** "This series" → Favorite toggle, mirroring the series screen's star button and cache
 *  (same query key), so favoriting from either place stays in sync. Best-effort: a bridge
 *  without the "favorites" capability just leaves the star unfilled rather than erroring. */
function FavoriteRow({ bridgeId, seriesId }: { bridgeId: string; seriesId: string }) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const favKey = queryKeys.isFavorite(mock, bridgeId, seriesId);
  const { data: favData, isError: favIsError } = useQuery({
    ...isFavoriteQuery(ds, mock, bridgeId, seriesId),
    retry: false,
  });
  const favorited = favData ?? (favIsError ? false : null);

  const favMutation = useMutation({
    mutationFn: (next: boolean) => (next ? ds.addFavorite(bridgeId, seriesId) : ds.removeFavorite(bridgeId, seriesId)),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: favKey });
      const prev = queryClient.getQueryData<boolean>(favKey);
      queryClient.setQueryData(favKey, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) queryClient.setQueryData(favKey, ctx.prev ?? false);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites', mock, bridgeId] });
    },
  });

  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>This series</ThemedText>
      <Pressable
        onPress={() => favorited !== null && favMutation.mutate(!favorited)}
        style={[styles.opt, favorited && styles.optOn]}
        disabled={favorited === null}>
        <ThemedText style={[styles.optText, favorited && styles.optTextOn]}>
          {favorited ? '★  Favorited' : '☆  Favorite'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function Segment({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>{label}</ThemedText>
      <View style={styles.segRow}>
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <Pressable key={v} onPress={() => onChange(v)} style={[styles.opt, on && styles.optOn]}>
              <ThemedText style={[styles.optText, on && styles.optTextOn]}>{l}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing.three,
    alignItems: 'flex-end',
    gap: Spacing.two,
    zIndex: 2,
  },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panel: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(20,20,22,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    minWidth: 180,
  },
  seg: {
    gap: Spacing.one,
  },
  segLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  segRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  opt: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  optOn: {
    backgroundColor: '#3478F6',
  },
  optText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  optTextOn: {
    color: '#fff',
    fontWeight: '600',
  },
});
