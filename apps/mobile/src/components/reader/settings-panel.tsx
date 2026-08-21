import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MoveLeftIcon, MoveRightIcon, MoveVerticalIcon, SettingsIcon } from '@/components/icons/reader-icons';
import type { IconProps } from '@/components/icons/ui-icons';
import { openCollectionPicker } from '@/components/collection-picker';
import { OverlayHeading, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dlGetSeries } from '@/data/api';
import { deriveSeriesState } from '@/data/downloads/derive';
import { enqueueChapter } from '@/data/downloads/engine';
import { downloadsScreenRoute } from '@/data/downloads/nav';
import { queryKeys } from '@/data/queries';
import { useFavorite } from '@/hooks/use-favorite';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useSeriesSave } from '@/hooks/use-series-save';
import { useItemCollections } from '@/hooks/use-item-collections';
import { usePageCollected } from '@/hooks/use-page-collected';
import { useSeriesSubPath } from '@/lib/series-nav';
import { useRouter } from '@/lib/nav';
import {
  useReaderSettings,
  type PageFit,
  type PrefetchAhead,
  type ReaderDirection,
  type ReaderSettings,
} from '@/hooks/use-reader-settings';
import { testId } from '@/lib/test-id';

/** Gear button that opens reader settings in the app's shared overlay system — a
 *  near-full-width bottom sheet on mobile/narrow web, an anchored popover
 *  (matching Browse's filter buttons) on wide desktop web.
 *
 *  Rendered inline in the reader toolbar's trailing slot, so it inherits that
 *  bar's fade/auto-hide rather than positioning or animating itself. */
export function SettingsControl({
  bridgeId,
  seriesId,
  title,
  thumbnailUrl,
  author,
  direct,
  page,
}: {
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
  /** The page currently on screen, for the "This page" action. Omitted before the reader has
   *  reported one. Shares `usePageCollected`'s cache key with the toolbar heart, so toggling from
   *  either place keeps both in lockstep. */
  page?: PageActionTarget;
}) {
  const { ref, openAt } = useAnchoredOverlay();

  return (
    <Pressable
      testID="reader.settings.open"
      ref={ref}
      hitSlop={12}
      onPress={() =>
        openAt(() => (
          <SettingsContent
            bridgeId={bridgeId}
            seriesId={seriesId}
            title={title}
            thumbnailUrl={thumbnailUrl}
            author={author}
            direct={direct}
            page={page}
          />
        ))
      }
      style={styles.gear}
      accessibilityRole="button"
      accessibilityLabel="Reader settings">
      <SettingsIcon color="#fff" size={20} />
    </Pressable>
  );
}

/** Reader settings content, rendered inside the overlay (sheet or popover).
 *  Note: the overlay panel follows the app's theme (`useTheme`), so under a
 *  light appearance it renders light while the reader keeps its own always-dark
 *  viewing surface — an intentional split, matching how media
 *  readers stay dark for immersion while their controls track the app theme. */
/** The page the sheet's "This page" action acts on — the reader's currently visible page, with the
 *  chapter it actually belongs to (mid-crossing that is a neighbouring segment). */
export type PageActionTarget = {
  chapterId: string;
  chapterName?: string;
  pageIndex: number;
  pageCount?: number;
  sourceUrl?: string;
  /** The chapter's re-anchor identity, sent when filing the CHAPTER. Together these let
   *  `syncChapters` find it again after a source re-uploads the chapter under a new id. */
  chapterNumber?: number;
  languageCode?: string;
};

function SettingsContent({
  bridgeId,
  seriesId,
  title,
  thumbnailUrl,
  author,
  direct,
  page,
}: {
  bridgeId?: string;
  seriesId?: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
  direct?: boolean;
  page?: PageActionTarget;
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
      {bridgeId && seriesId && page && (
        <PageActionRow bridgeId={bridgeId} seriesId={seriesId} seriesTitle={title ?? seriesId} page={page} />
      )}
      {bridgeId && seriesId && page && page.chapterId !== DIRECT_CHAPTER_ID && (
        <ChapterActionRow bridgeId={bridgeId} seriesId={seriesId} seriesTitle={title ?? seriesId} page={page} />
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
 * The "This page" section — a mirror of the toolbar's save button, for discoverability. Shares
 * `usePageCollected`'s cache key with it, so acting on either surface moves both.
 *
 * Kept as its own segment above "This series" rather than a fifth cell in that 2×2 grid: it acts on
 * a different subject, and conflating the two is exactly the confusion the collections model is
 * trying to avoid.
 *
 * Two buttons rather than the toolbar's tap/long-press pair, because a sheet can afford the width
 * and a long press is undiscoverable in a list of labelled actions: save/remove, and "Collections…"
 * which always opens the picker.
 */
function PageActionRow({
  bridgeId,
  seriesId,
  seriesTitle,
  page,
}: {
  bridgeId: string;
  seriesId: string;
  seriesTitle: string;
  page: PageActionTarget;
}) {
  const { closeTop } = useOverlay();
  const snapshot = () => ({
    seriesTitle,
    ...(page.chapterName !== undefined && { chapterName: page.chapterName }),
    ...(page.pageCount !== undefined && { pageCount: page.pageCount }),
    ...(page.sourceUrl !== undefined && { sourceUrl: page.sourceUrl }),
  });
  const { collected, toggle } = usePageCollected(
    bridgeId,
    seriesId,
    page.chapterId,
    page.pageIndex,
    snapshot,
  );

  const openPicker = () => {
    closeTop(); // close the sheet so the picker isn't stacked behind it
    openCollectionPicker({
      kind: 'page',
      bridgeId,
      seriesId,
      chapterId: page.chapterId,
      pageIndex: page.pageIndex,
      title: page.chapterName ? `${seriesTitle} — ${page.chapterName}` : seriesTitle,
      snapshot,
    });
  };

  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>This page</ThemedText>
      <View style={styles.segRow}>
        <Pressable
          testID="reader.settings.collect-page"
          onPress={() => {
            void toggle().then((result) => {
              if (result === 'needs-pick') openPicker();
            });
          }}
          style={[styles.opt, collected && styles.optOn]}
          disabled={collected === null}>
          <ThemedText style={[styles.optText, collected && styles.optTextOn]}>
            {collected ? '✓  Saved' : '＋  Save page'}
          </ThemedText>
        </Pressable>
        <Pressable testID="reader.settings.page-collections" onPress={openPicker} style={styles.opt}>
          <ThemedText style={styles.optText}>Collections…</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The "This chapter" section — files the whole chapter into a collection.
 *
 * One button, straight to the picker, rather than a one-tap save: saving a chapter is a
 * deliberate act taken from a menu, not a reflex like saving the page you're looking at, so there
 * is no last-used shortcut to justify here.
 *
 * Hidden for a direct (chapterless) series — `__direct__` is a sentinel, not a real chapter, and
 * filing it would duplicate the series item.
 */
function ChapterActionRow({
  bridgeId,
  seriesId,
  seriesTitle,
  page,
}: {
  bridgeId: string;
  seriesId: string;
  seriesTitle: string;
  page: PageActionTarget;
}) {
  const { closeTop } = useOverlay();
  const { collectionIds } = useItemCollections({
    kind: 'chapter',
    bridgeId,
    seriesId,
    chapterId: page.chapterId,
    snapshot: () => ({
      seriesTitle,
      ...(page.chapterName !== undefined && { chapterName: page.chapterName }),
      ...(page.chapterNumber !== undefined && { number: page.chapterNumber }),
      ...(page.languageCode !== undefined && { languageCode: page.languageCode }),
    }),
  });
  const saved = collectionIds.length > 0;

  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>This chapter</ThemedText>
      <View style={styles.segRow}>
        <Pressable
          testID="reader.settings.collect-chapter"
          onPress={() => {
            closeTop();
            openCollectionPicker({
              kind: 'chapter',
              bridgeId,
              seriesId,
              chapterId: page.chapterId,
              title: page.chapterName ? `${seriesTitle} — ${page.chapterName}` : seriesTitle,
              snapshot: () => ({
                seriesTitle,
                ...(page.chapterName !== undefined && { chapterName: page.chapterName }),
                ...(page.chapterNumber !== undefined && { number: page.chapterNumber }),
                ...(page.languageCode !== undefined && { languageCode: page.languageCode }),
              }),
            });
          }}
          style={[styles.opt, saved && styles.optOn]}>
          <ThemedText style={[styles.optText, saved && styles.optTextOn]}>
            {saved ? '✓  In a collection' : '＋  Add chapter to collection'}
          </ThemedText>
        </Pressable>
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
    ...(title ? { seriesTitle: title } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(author ? { author } : {}),
  });

  const save = useSeriesSave(bridgeId, seriesId, snapshot, title ?? seriesId);
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

  // `toSubPath` keeps these pushes inside the series page's nested stack when this panel is
  // opened from that page's in-place reader — see useSeriesSubPath.
  const toSubPath = useSeriesSubPath();
  const openSeriesDownloads = (select: boolean) => {
    closeTop(); // close the reader sheet before pushing the download screen over the reader
    router.push({
      pathname: toSubPath('/series-downloads'),
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
    if (dlComplete || dlInProgress) {
      // A direct series has no chapter roster to manage — its row on the Downloads screen is the
      // whole download (see downloads/nav.ts).
      if (direct) {
        closeTop(); // close the reader sheet before pushing over the reader, as openSeriesDownloads does
        const route = downloadsScreenRoute(bridgeId, seriesId);
        router.push({ ...route, pathname: toSubPath(route.pathname) });
        return;
      }
      return openSeriesDownloads(false);
    }
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
  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>This series</ThemedText>
      <View style={styles.segRow}>
        {/* ONE cell where there were two — the old "Library" and "Add to collection" became the
            same action when the library dissolved into collections. See useSeriesSave. */}
        <Pressable
          testID="reader.settings.save"
          onPress={() => {
            // A tap that opens the picker must not leave it stacked behind this sheet; a tap that
            // saves outright should leave the reader panel up, so the label change is visible.
            if (!save.quickSaves) closeTop();
            save.onPress();
          }}
          style={[styles.opt, save.saved && styles.optOn]}
          disabled={save.saved === null}>
          <ThemedText numberOfLines={1} style={[styles.optText, save.saved && styles.optTextOn]}>
            {save.saved ? `✓  ${save.label}` : `＋  ${save.label}`}
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
  gear: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
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
