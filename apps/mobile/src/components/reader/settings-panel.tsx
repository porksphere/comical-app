import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoveLeftIcon, MoveRightIcon, MoveVerticalIcon, SettingsIcon } from '@/components/icons/reader-icons';
import type { IconProps } from '@/components/icons/ui-icons';
import { openListPicker } from '@/components/list-picker';
import { OverlayHeading, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dlGetSeries } from '@/data/api';
import { deriveSeriesState } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { queryKeys } from '@/data/queries';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import {
  useReaderSettings,
  type PageFit,
  type PrefetchAhead,
  type ReaderDirection,
  type ReaderSettings,
} from '@/hooks/use-reader-settings';
import { testId } from '@/lib/test-id';
import { isTranslationSupported } from '@/translation';

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
  direct,
}: {
  visible: boolean;
  /** When both are set, the "This series" actions are shown — omitted on bridges/pages where the
   *  reader was opened without a resolvable series (shouldn't normally happen). */
  bridgeId?: string;
  seriesId?: string;
  /** Snapshot for a new library entry (title/cover/author) — only used if the
   *  toggle is actually switched on; omitted fields are simply left off the entry. */
  title?: string;
  thumbnailUrl?: string;
  author?: string;
  /** A direct (chapterless) series downloads as one unit; otherwise Download opens chapter select. */
  direct?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { ref, openAt } = useAnchoredOverlay();
  const style = useAnimatedStyle(() => ({ opacity: withTiming(visible ? 1 : 0, { duration: 200 }) }));

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: insets.bottom + Spacing.two }, style]}>
      <Pressable
        testID="reader.settings.open"
        ref={ref}
        onPress={() =>
          openAt(() => (
            <SettingsContent
              bridgeId={bridgeId}
              seriesId={seriesId}
              title={title}
              thumbnailUrl={thumbnailUrl}
              author={author}
              direct={direct}
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
  direct,
}: {
  bridgeId?: string;
  seriesId?: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
  direct?: boolean;
}) {
  const [settings, set] = useReaderSettings();
  return (
    <View style={styles.content}>
      <OverlayHeading>Reader settings</OverlayHeading>
      <DirectionRow settings={settings} set={set} />
      <Segment
        label="Page fit"
        testIdPrefix="reader.settings.page-fit"
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
        testIdPrefix="reader.settings.preload-ahead"
        value={String(settings.prefetchAhead)}
        options={[1, 2, 3, 4, 6, 8].map((n) => [String(n), String(n)] as [string, string])}
        onChange={(v) => set({ prefetchAhead: Number(v) as PrefetchAhead })}
      />
      {isTranslationSupported() && (
        <>
          <Segment
            label="Live translate"
            testIdPrefix="reader.settings.live-translate"
            value={settings.liveTranslate ? 'on' : 'off'}
            options={[
              ['off', 'Off'],
              ['on', 'On'],
            ]}
            onChange={(v) => set({ liveTranslate: v === 'on' })}
          />
          {settings.liveTranslate && (
            <ThemedText style={styles.hint}>
              OCR + translation run on-device. Models & languages: Settings → Translation
            </ThemedText>
          )}
        </>
      )}
      {bridgeId && seriesId && (
        <SeriesActionsRow
          bridgeId={bridgeId}
          seriesId={seriesId}
          title={title}
          thumbnailUrl={thumbnailUrl}
          author={author}
          direct={direct}
        />
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
            <Pressable
              key={v}
              testID={testId('reader.settings.direction', v)}
              onPress={() => onChange(v)}
              style={[styles.opt, styles.optIcon, on && styles.optOn]}>
              <Icon color={on ? '#fff' : 'rgba(255,255,255,0.8)'} size={18} />
              <ThemedText style={[styles.optText, on && styles.optTextOn]}>{label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The single "This series" section: Library / Favorite / Download / Add-to-list, in a 2×2 grid.
 * Each action mirrors its Series-screen counterpart and shares its cache key/hook, so toggling from
 * either place stays in sync. The library/list snapshot (title/cover/author) is best-effort —
 * whatever the reader already had cached — since this panel doesn't fetch series details itself.
 *
 * (`styles.opt` is `flex: 1`, so the buttons MUST live inside a `segRow`; directly in the column
 * `seg` they'd collapse on the vertical axis to an untappable sliver.)
 */
function SeriesActionsRow({
  bridgeId,
  seriesId,
  title,
  thumbnailUrl,
  author,
  direct,
}: {
  bridgeId: string;
  seriesId: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
  direct?: boolean;
}) {
  const router = useRouter();
  const { closeTop } = useOverlay();
  const snapshot = () => ({
    ...(title ? { title } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(author ? { author } : {}),
  });

  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, seriesId, snapshot);
  const { favorited, toggle: toggleFavorite, available: favAvailable } = useFavorite(bridgeId, seriesId);

  // Download state from the same manifest query the Series screen's button reads (so it shows
  // "Downloaded"/"Downloading" in step). Partial-vs-complete needs the full chapter list, which the
  // reader panel doesn't have — so this shows the coarse manifest state and defers the fine-grained
  // picking to the download screen it opens.
  const { data: dl } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });
  const dlChapters = dl?.chapters ?? [];
  const dlState = dlChapters.length > 0 ? deriveSeriesState(dlChapters) : undefined;
  const dlComplete = dlState === 'complete';
  const dlInProgress = dlState !== undefined && dlState !== 'complete';
  const downloadLabel = dlComplete ? '✓  Downloaded' : dlInProgress ? 'Downloading' : '⤓  Download';

  const openSeriesDownloads = (select: boolean) => {
    closeTop(); // close the reader sheet before pushing the download screen over the reader
    router.push({
      pathname: '/series-downloads',
      params: {
        bridgeId,
        id: seriesId,
        title: title ?? seriesId,
        all: '1',
        ...(select ? { select: '1' } : {}),
        ...(thumbnailUrl ? { cover: thumbnailUrl } : {}),
        ...(author ? { author } : {}),
      },
    });
  };
  const onDownload = () => {
    // Already downloading or done → open the manage view; a direct series is one unit → enqueue it
    // outright; otherwise open chapter selection (mirrors SeriesDownloadButton, minus partial).
    if (dlComplete || dlInProgress) return openSeriesDownloads(false);
    if (direct) {
      void enqueueChapter({
        bridgeId,
        seriesId,
        chapterId: seriesId,
        direct: true,
        title: title ?? seriesId,
        ...(thumbnailUrl && { thumbnailUrl }),
        ...(author && { author }),
      });
      return;
    }
    openSeriesDownloads(true);
  };
  const onAddToList = () => {
    closeTop(); // close the reader sheet so the list picker isn't stacked behind it
    openListPicker({ bridgeId, seriesId, title, snapshot });
  };

  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>This series</ThemedText>
      <View style={styles.segRow}>
        <Pressable
          testID="reader.settings.library"
          onPress={toggleLibrary}
          style={[styles.opt, inLibrary && styles.optOn]}
          disabled={inLibrary === null}>
          <ThemedText style={[styles.optText, inLibrary && styles.optTextOn]}>
            {inLibrary ? '✓  In Library' : '＋  Library'}
          </ThemedText>
        </Pressable>
        <Pressable
          testID="reader.settings.favorite"
          onPress={toggleFavorite}
          style={[styles.opt, favorited && styles.optOn, !favAvailable && styles.optDisabled]}
          // Greyed when this bridge's favorites need a login that isn't set (see useFavorite).
          disabled={!favAvailable || favorited === null}>
          <ThemedText style={[styles.optText, favorited && styles.optTextOn]}>
            {favorited ? '★  Favorited' : '☆  Favorite'}
          </ThemedText>
        </Pressable>
      </View>
      <View style={styles.segRow}>
        <Pressable
          testID="reader.settings.download"
          onPress={onDownload}
          style={[styles.opt, dlComplete && styles.optOn]}>
          <ThemedText style={[styles.optText, dlComplete && styles.optTextOn]}>{downloadLabel}</ThemedText>
        </Pressable>
        <Pressable testID="reader.settings.lists" onPress={onAddToList} style={styles.opt}>
          <ThemedText style={styles.optText}>Add to list</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function Segment({
  label,
  value,
  options,
  onChange,
  testIdPrefix,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  testIdPrefix: string;
}) {
  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>{label}</ThemedText>
      <View style={styles.segRow}>
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <Pressable
              key={v}
              testID={testId(testIdPrefix, v)}
              onPress={() => onChange(v)}
              style={[styles.opt, on && styles.optOn]}>
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
  optDisabled: {
    opacity: 0.4,
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
