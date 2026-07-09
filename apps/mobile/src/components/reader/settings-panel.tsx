import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoveLeftIcon, MoveRightIcon, MoveVerticalIcon, SettingsIcon } from '@/components/icons/reader-icons';
import type { IconProps } from '@/components/icons/ui-icons';
import { OverlayHeading, useAnchoredOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import {
  useReaderSettings,
  type PageFit,
  type PrefetchAhead,
  type ReaderDirection,
  type ReaderSettings,
} from '@/hooks/use-reader-settings';

/** Gear button (bottom-right) that opens reader settings in the app's shared
 *  overlay system — a near-full-width bottom sheet on mobile/narrow web, an
 *  anchored popover (matching Browse's filter buttons) on wide desktop web. */
export function SettingsControl({
  visible,
  bridgeId,
  seriesId,
  title,
  thumbnailUrl,
  author,
}: {
  visible: boolean;
  /** When both are set, "This series" Library/Favorite rows are shown — omitted on
   *  bridges/pages where the reader was opened without a resolvable series (shouldn't
   *  normally happen). */
  bridgeId?: string;
  seriesId?: string;
  /** Snapshot for a new library entry (title/cover/author) — only used if the
   *  toggle is actually switched on; omitted fields are simply left off the entry. */
  title?: string;
  thumbnailUrl?: string;
  author?: string;
}) {
  const insets = useSafeAreaInsets();
  const { ref, openAt } = useAnchoredOverlay();
  const style = useAnimatedStyle(() => ({ opacity: withTiming(visible ? 1 : 0, { duration: 200 }) }));

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: insets.bottom + Spacing.two }, style]}>
      <Pressable
        ref={ref}
        onPress={() =>
          openAt(() => (
            <SettingsContent
              bridgeId={bridgeId}
              seriesId={seriesId}
              title={title}
              thumbnailUrl={thumbnailUrl}
              author={author}
            />
          ))
        }
        style={styles.gear}
        accessibilityRole="button"
        accessibilityLabel="Reader settings">
        <SettingsIcon color="#fff" size={20} />
      </Pressable>
    </Animated.View>
  );
}

/** Reader settings content, rendered inside the overlay (sheet or popover).
 *  Note: the overlay panel follows the app's theme (`useTheme`), so under a
 *  light appearance it renders light while the reader keeps its own always-dark
 *  viewing surface (see `reader.tsx`) — an intentional split, matching how media
 *  readers stay dark for immersion while their controls track the app theme. */
function SettingsContent({
  bridgeId,
  seriesId,
  title,
  thumbnailUrl,
  author,
}: {
  bridgeId?: string;
  seriesId?: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
}) {
  const [settings, set] = useReaderSettings();
  return (
    <View style={styles.content}>
      <OverlayHeading>Reader settings</OverlayHeading>
      <DirectionRow settings={settings} set={set} />
      <Segment
        label="Page fit"
        value={settings.pageFit}
        options={[
          ['fit-page', 'Fit page'],
          ['fit-width', 'Fit width'],
        ]}
        onChange={(v) => set({ pageFit: v as PageFit })}
      />
      {settings.mode === 'webtoon' && (
        <ThemedText style={styles.hint}>
          {settings.pageFit === 'fit-page' ? 'One page at a time, like Paged' : 'Continuous scroll'}
        </ThemedText>
      )}
      <Segment
        label="Preload ahead"
        value={String(settings.prefetchAhead)}
        options={[1, 2, 3, 4, 6, 8].map((n) => [String(n), String(n)] as [string, string])}
        onChange={(v) => set({ prefetchAhead: Number(v) as PrefetchAhead })}
      />
      {bridgeId && seriesId && (
        <>
          <LibraryRow bridgeId={bridgeId} seriesId={seriesId} title={title} thumbnailUrl={thumbnailUrl} author={author} />
          <FavoriteRow bridgeId={bridgeId} seriesId={seriesId} />
        </>
      )}
    </View>
  );
}

const DIRECTION_OPTIONS: { value: 'ltr' | 'vertical' | 'rtl'; label: string; Icon: ComponentType<IconProps> }[] = [
  { value: 'ltr', label: 'L → R', Icon: MoveRightIcon },
  { value: 'vertical', label: 'Vertical', Icon: MoveVerticalIcon },
  { value: 'rtl', label: 'R → L', Icon: MoveLeftIcon },
];

/** Merges "Mode" (Paged/Webtoon) and "Direction" (L→R/R→L) into one 3-way row —
 *  reading direction is really one choice, not two independent settings. Picking
 *  "Vertical" only touches `mode`; `direction` is left as whatever it was, so
 *  switching back to L→R/R→L restores it (harmless — unread while webtoon). */
function DirectionRow({
  settings,
  set,
}: {
  settings: ReaderSettings;
  set: (patch: Partial<ReaderSettings>) => void;
}) {
  const value = settings.mode === 'webtoon' ? 'vertical' : settings.direction;
  const onChange = (v: 'ltr' | 'vertical' | 'rtl') =>
    v === 'vertical' ? set({ mode: 'webtoon' }) : set({ mode: 'paged', direction: v as ReaderDirection });
  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>Reading direction</ThemedText>
      <View style={styles.segRow}>
        {DIRECTION_OPTIONS.map(({ value: v, label, Icon }) => {
          const on = value === v;
          return (
            <Pressable key={v} onPress={() => onChange(v)} style={[styles.opt, styles.optIcon, on && styles.optOn]}>
              <Icon color={on ? '#fff' : 'rgba(255,255,255,0.8)'} size={18} />
              <ThemedText style={[styles.optText, on && styles.optTextOn]}>{label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** "This series" → Library toggle, mirroring the series screen's own toggle and
 *  cache (same query key), so adding/removing from either place stays in sync.
 *  The snapshot (title/cover/author) is best-effort — whatever the reader screen
 *  already has cached — since this panel doesn't otherwise fetch series details. */
function LibraryRow({
  bridgeId,
  seriesId,
  title,
  thumbnailUrl,
  author,
}: {
  bridgeId: string;
  seriesId: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
}) {
  // Shared hook (see useLibrary) — same cache key + optimistic flow as the Series screen, so
  // toggling from either place stays in sync. The ADD snapshot is built lazily from the reader props.
  const { inLibrary, toggle } = useLibrary(bridgeId, seriesId, () => ({
    ...(title ? { title } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(author ? { author } : {}),
  }));

  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>This series</ThemedText>
      <Pressable
        onPress={toggle}
        style={[styles.opt, inLibrary && styles.optOn]}
        disabled={inLibrary === null}>
        <ThemedText style={[styles.optText, inLibrary && styles.optTextOn]}>
          {inLibrary ? '✓  In Library' : '＋  Library'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** "This series" → Favorite toggle, mirroring the series screen's star button and cache
 *  (same query key), so favoriting from either place stays in sync. Best-effort: a bridge
 *  without the "favorites" capability just leaves the star unfilled rather than erroring. */
function FavoriteRow({ bridgeId, seriesId }: { bridgeId: string; seriesId: string }) {
  // Shared hook (see useFavorite) — same cache key as the Series screen's star, so favoriting from
  // either place stays in sync.
  const { favorited, toggle } = useFavorite(bridgeId, seriesId);

  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>This series</ThemedText>
      <Pressable
        onPress={toggle}
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
  content: {
    gap: Spacing.three,
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
  optIcon: {
    gap: 4,
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
  hint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
  },
});
