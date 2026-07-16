/**
 * The unified Downloads screen (a Settings sub-page): a device-storage bar, the download preferences,
 * and an expandable series → chapters breakdown — ordered queue-first then most-recent, each row
 * showing a progress radial while in flight and swipe/hover actions that match its state (Cancel an
 * in-flight download, Resume a cancelled one, Delete a finished one).
 *
 * Downloads are device data (not source content), so this reads the `/downloads` manifest directly
 * through `api.ts`; a backend without the module yields an empty tree. Deletions cascade in the core
 * (`Downloads.delete*` returns the blob paths), then this removes those bytes and prunes the offline
 * index; cancel/resume go through the engine so an in-flight chapter aborts promptly.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CumulativeDownloadRadial } from '@/components/downloads/cumulative-radial';
import { DiskSpaceBar } from '@/components/downloads/disk-space-bar';
import { DownloadStatusIndicator } from '@/components/downloads/download-status-indicator';
import { ChevronDownIcon, ChevronRightIcon, ClearIcon, PauseIcon, PlayIcon, RetryIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { SwipeableSettingsRow, type SwipeRowAction } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { dlDeleteAll, dlDeleteChapter, dlDeleteSeries, dlStorageUsage } from '@/data/api';
import { applyBackgroundDownloads } from '@/data/downloads/background';
import { removeAllBlobs, removeBlobs } from '@/data/downloads/blob-store';
import {
  bySortValue,
  chapterSortValue,
  deriveSeriesState,
  displayChapterState,
  overallProgress,
  seriesFraction,
  seriesSortValue,
} from '@/data/downloads/derive';
import {
  kickDownloads,
  pauseChapter,
  pauseSeries,
  resumeChapterDownload,
  resumeSeriesDownload,
  retryChapter,
} from '@/data/downloads/engine';
import { clearDownloadIndex, forgetChapter, forgetSeries } from '@/data/downloads/index-cache';
import { formatBytes } from '@/data/downloads/format';
import { downloadPrefs$, useDownloadPrefs } from '@/data/downloads/prefs';
import { chapterProgressKey, useLiveDownloadProgress } from '@/data/downloads/state';
import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import type { DownloadState, StorageUsage, StorageUsageSeries } from '@comical/downloads';

const EMPTY_USAGE: StorageUsage = { totalBytes: 0, seriesCount: 0, chapterCount: 0, pageCount: 0, bySeries: [] };

function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
}

const seriesKey = (s: { bridgeId: string; seriesId: string }) => `${s.bridgeId}:${s.seriesId}`;

interface RowHandlers {
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  /** Discard the in-flight download (series: drop the incomplete chapters; chapter: delete it). */
  onCancel: () => void;
  onDelete: () => void;
}

// Actions are laid out left→right and the LAST one sits at the swipe edge (revealed FIRST). So the
// primary action (Pause/Resume/Retry) goes LAST (nearest the edge), and the destructive one
// (Cancel/Delete) goes FIRST (further to the left) — you reach Pause with a short swipe, the
// destructive action only with a longer one.
const PAUSE = (onPress: () => void): SwipeRowAction => ({ label: 'Pause', icon: PauseIcon, onPress });
const RESUME = (onPress: () => void): SwipeRowAction => ({ label: 'Resume', icon: PlayIcon, onPress });
const RETRY = (onPress: () => void): SwipeRowAction => ({ label: 'Retry', icon: RetryIcon, onPress });
const CANCEL = (onPress: () => void): SwipeRowAction => ({ label: 'Cancel', icon: ClearIcon, destructive: true, onPress });
const DELETE = (onPress: () => void): SwipeRowAction => ({ label: 'Delete', icon: TrashIcon, destructive: true, onPress });

/** Series swipe actions: while downloading you get Pause + Cancel (Cancel discards the in-flight
 *  downloads, after which the series is complete-only → Delete). */
function seriesActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  if (state === 'complete') return [DELETE(h.onDelete)];
  if (state === 'paused') return [DELETE(h.onDelete), RESUME(h.onResume)];
  if (state === 'failed') return [DELETE(h.onDelete), RETRY(h.onRetry)];
  return [CANCEL(h.onCancel), PAUSE(h.onPause)]; // downloading / queued
}

/** Chapter swipe actions: a chapter is atomic, so its destructive action is always Delete. */
function chapterActions(state: DownloadState, h: RowHandlers): SwipeRowAction[] {
  if (state === 'complete') return [DELETE(h.onDelete)];
  if (state === 'paused') return [DELETE(h.onDelete), RESUME(h.onResume)];
  if (state === 'failed') return [DELETE(h.onDelete), RETRY(h.onRetry)];
  return [DELETE(h.onDelete), PAUSE(h.onPause)]; // downloading / queued
}

export default function DownloadsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const { wifiOnly, background } = useDownloadPrefs();
  const live = useLiveDownloadProgress();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Deep-link / series-button focus: expand a series and scroll it into view.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const listTop = useRef(0);
  const rowY = useRef<Map<string, number>>(new Map());
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const { data: usage = EMPTY_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    queryFn: () => dlStorageUsage().catch(() => EMPTY_USAGE),
  });

  useEffect(() => {
    if (!focus) return;
    setExpanded((prev) => new Set(prev).add(focus));
    setPendingScroll(focus);
  }, [focus]);

  const tryScroll = useCallback(() => {
    if (!pendingScroll) return;
    const y = rowY.current.get(pendingScroll);
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, listTop.current + y - Spacing.three), animated: true });
      setPendingScroll(null);
    }
  }, [pendingScroll]);
  useEffect(() => {
    tryScroll();
  }, [tryScroll, usage]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const deleteSeries = async (s: StorageUsageSeries) => {
    const { files } = await dlDeleteSeries(s.bridgeId, s.seriesId);
    removeBlobs(files);
    forgetSeries(s.bridgeId, s.seriesId);
    refresh();
  };
  const deleteChapter = async (s: StorageUsageSeries, chapterId: string) => {
    const { files } = await dlDeleteChapter(s.bridgeId, s.seriesId, chapterId);
    removeBlobs(files);
    forgetChapter(s.bridgeId, s.seriesId, chapterId);
    refresh();
  };
  const deleteAll = async () => {
    await dlDeleteAll();
    removeAllBlobs();
    clearDownloadIndex();
    refresh();
  };
  // Retrying a whole series re-queues each of its failed chapters.
  const retrySeries = (s: StorageUsageSeries) => {
    for (const c of s.chapters) if (c.state === 'failed') void retryChapter(c.bridgeId, c.seriesId, c.chapterId);
  };
  // Cancel a series' in-flight downloads: stop them, then discard the incomplete chapters (their
  // partial bytes). Completed chapters are kept — so the series drops to complete-only (or is removed
  // if nothing finished), and its swipe naturally becomes Delete.
  const cancelSeriesInflight = async (s: StorageUsageSeries) => {
    await pauseSeries(s.bridgeId, s.seriesId);
    for (const c of s.chapters) {
      if (c.state !== 'complete') await deleteChapter(s, c.chapterId);
    }
  };

  // Queue-first, then most-recent (see derive.ts).
  const orderedSeries = [...usage.bySeries].sort((a, b) =>
    bySortValue(seriesSortValue(a.chapters), seriesSortValue(b.chapters)),
  );

  const overall = overallProgress(usage.bySeries, live);

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Downloads" />
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection>
          <View style={styles.summary}>
            <View style={styles.summaryHead}>
              {overall.inProgress && (
                <CumulativeDownloadRadial fraction={overall.fraction} size={56} showLabel />
              )}
              <View style={styles.summaryText}>
                <ThemedText type="title">{formatBytes(usage.totalBytes)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {usage.seriesCount} series · {usage.chapterCount} chapter{usage.chapterCount === 1 ? '' : 's'} ·{' '}
                  {usage.pageCount} page{usage.pageCount === 1 ? '' : 's'}
                </ThemedText>
              </View>
            </View>
            <DiskSpaceBar downloadsBytes={usage.totalBytes} />
          </View>
          <SettingsToggleRow
            label="Download over Wi-Fi only"
            description="Hold downloads until you're on Wi-Fi."
            value={wifiOnly}
            onChange={(v) => {
              downloadPrefs$.wifiOnly.set(v);
              // Turning the gate off (or changing it) should resume held-back downloads right away.
              kickDownloads();
            }}
          />
          <SettingsToggleRow
            label="Download in background"
            description="Continue in OS-granted windows after leaving the app."
            value={background}
            onChange={(v) => {
              downloadPrefs$.background.set(v);
              applyBackgroundDownloads(v);
            }}
          />
        </SettingsSection>

        {orderedSeries.length > 0 ? (
          <View onLayout={(e) => (listTop.current = e.nativeEvent.layout.y)} style={styles.list}>
            {orderedSeries.map((s) => {
              const key = seriesKey(s);
              const open = expanded.has(key);
              const state = deriveSeriesState(s.chapters, live);
              const frac = seriesFraction(s.chapters, live);
              const chapters = [...s.chapters].sort((a, b) => bySortValue(chapterSortValue(a), chapterSortValue(b)));
              return (
                <View key={key} onLayout={(e) => rowY.current.set(key, e.nativeEvent.layout.y)}>
                  <SwipeableSettingsRow
                    label={s.title}
                    description={`${s.chapterCount} chapter${s.chapterCount === 1 ? '' : 's'} · ${formatBytes(s.bytes)}`}
                    leading={
                      state === 'complete' ? (
                        <Chevron open={open} />
                      ) : (
                        <DownloadStatusIndicator
                          state={state}
                          fraction={frac}
                          size={22}
                          interactive={false}
                          onPause={() => void pauseSeries(s.bridgeId, s.seriesId)}
                          onResume={() => void resumeSeriesDownload(s.bridgeId, s.seriesId)}
                          onRetry={() => retrySeries(s)}
                        />
                      )
                    }
                    onPress={() => toggle(key)}
                    actions={seriesActions(state, {
                      onPause: () => void pauseSeries(s.bridgeId, s.seriesId),
                      onResume: () => void resumeSeriesDownload(s.bridgeId, s.seriesId),
                      onRetry: () => retrySeries(s),
                      onCancel: () => void cancelSeriesInflight(s),
                      onDelete: () => void deleteSeries(s),
                    })}
                  />
                  {open &&
                    chapters.map((c) => {
                      // Radial AND the "X/Y" count both read the same done value — the live per-page
                      // count while the engine is working this chapter, else the manifest's — so they
                      // can never disagree (was: radial live/fresh vs. count manifest/stale).
                      const liveStatus = live[chapterProgressKey(c.bridgeId, c.seriesId, c.chapterId)];
                      const shownDone = liveStatus && liveStatus.total > 0 ? liveStatus.done : c.completedPages;
                      const cFrac = c.pageCount > 0 ? shownDone / c.pageCount : 0;
                      // Real-time state (live overlay) — the manifest state lags at queued mid-download.
                      const cState = displayChapterState(c, live);
                      return (
                        <SwipeableSettingsRow
                          key={c.chapterId}
                          label={c.chapterName ?? (c.number !== undefined ? `Chapter ${c.number}` : c.chapterId)}
                          description={chapterDescription(c, cState, shownDone)}
                          leading={
                            cState === 'complete' ? undefined : (
                              <DownloadStatusIndicator
                                state={cState}
                                fraction={cFrac}
                                size={20}
                                onPause={() => void pauseChapter(c.bridgeId, c.seriesId, c.chapterId)}
                                onResume={() => void resumeChapterDownload(c.bridgeId, c.seriesId, c.chapterId)}
                                onRetry={() => void retryChapter(c.bridgeId, c.seriesId, c.chapterId)}
                              />
                            )
                          }
                          actions={chapterActions(cState, {
                            onPause: () => void pauseChapter(c.bridgeId, c.seriesId, c.chapterId),
                            onResume: () => void resumeChapterDownload(c.bridgeId, c.seriesId, c.chapterId),
                            onRetry: () => void retryChapter(c.bridgeId, c.seriesId, c.chapterId),
                            onCancel: () => void deleteChapter(s, c.chapterId),
                            onDelete: () => void deleteChapter(s, c.chapterId),
                          })}
                        />
                      );
                    })}
                </View>
              );
            })}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No downloads yet. Open a series and tap Download to keep chapters for offline reading.
          </ThemedText>
        )}

        {orderedSeries.length > 0 && (
          <SettingsSection>
            <SettingsRow
              label="Delete all downloads"
              description="Remove every downloaded chapter from this device."
              descriptionColor="danger"
              onPress={() => void deleteAll()}
            />
          </SettingsSection>
        )}
      </ScrollView>
    </ThemedView>
  );
}

/** Expand chevron for a completed series row (in-progress rows show the status indicator instead). */
function Chevron({ open }: { open: boolean }) {
  const theme = useTheme();
  return open ? (
    <ChevronDownIcon color={theme.textSecondary} size={18} />
  ) : (
    <ChevronRightIcon color={theme.textSecondary} size={18} />
  );
}

function chapterDescription(c: StorageUsageSeries['chapters'][number], state: DownloadState, shownDone: number): string {
  const size = `${c.pageCount} page${c.pageCount === 1 ? '' : 's'} · ${formatBytes(c.bytes)}`;
  if (state === 'complete') return size;
  const label = state === 'downloading' ? `${shownDone}/${c.pageCount}` : state;
  return `${size} · ${label}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  summary: {
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  summaryText: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  list: {
    width: '100%',
  },
  empty: {
    paddingHorizontal: Spacing.three,
    textAlign: 'center',
  },
});
