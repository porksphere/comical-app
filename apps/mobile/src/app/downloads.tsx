/**
 * The unified Downloads screen (a Settings sub-page): total storage used, an expandable
 * series → chapters breakdown with per-node size, swipe/hover-to-delete at each level, and the
 * device-local download preferences.
 *
 * Downloads are device data (not source content), so this reads the `/downloads` manifest directly
 * through `api.ts` rather than `useDataSource()`; a backend without the module simply yields an empty
 * tree (the screen shows an empty state, mirroring how the app degrades when the library store is
 * absent). Deletions cascade in the core (`Downloads.delete*` returns the blob paths), then this
 * removes those bytes from the filesystem and prunes the offline index.
 */
import { use$ } from '@legendapp/state/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ChevronDownIcon, ChevronRightIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { dlDeleteAll, dlDeleteChapter, dlDeleteSeries, dlStorageUsage } from '@/data/api';
import { applyBackgroundDownloads } from '@/data/downloads/background';
import { removeAllBlobs, removeBlobs } from '@/data/downloads/blob-store';
import { formatBytes } from '@/data/downloads/format';
import { clearDownloadIndex, forgetChapter, forgetSeries } from '@/data/downloads/index-cache';
import { downloadPrefs$ } from '@/data/downloads/prefs';
import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import type { StorageUsage, StorageUsageSeries } from '@comical/downloads';

const EMPTY_USAGE: StorageUsage = { totalBytes: 0, seriesCount: 0, chapterCount: 0, pageCount: 0, bySeries: [] };

function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
}

export default function DownloadsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const wifiOnly = use$(downloadPrefs$.wifiOnly);
  const background = use$(downloadPrefs$.background);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: usage = EMPTY_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    // A backend without the downloads module 404s — show an empty tree rather than an error.
    queryFn: () => dlStorageUsage().catch(() => EMPTY_USAGE),
  });

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

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Downloads" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection>
          <StorageSummaryRow usage={usage} />
          <SettingsToggleRow
            label="Download over Wi-Fi only"
            description="Hold downloads until you're on Wi-Fi."
            value={wifiOnly}
            onChange={(v) => downloadPrefs$.wifiOnly.set(v)}
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

        {usage.bySeries.length > 0 ? (
          <SettingsSection>
            {usage.bySeries.map((s) => {
              const key = `${s.bridgeId}:${s.seriesId}`;
              const open = expanded.has(key);
              return (
                <View key={key}>
                  <SwipeableSettingsRow
                    label={s.title}
                    description={`${s.chapterCount} chapter${s.chapterCount === 1 ? '' : 's'} · ${formatBytes(s.bytes)}`}
                    leading={<Chevron open={open} />}
                    onPress={() => toggle(key)}
                    actions={[{ label: 'Delete', icon: TrashIcon, destructive: true, onPress: () => void deleteSeries(s) }]}
                  />
                  {open &&
                    s.chapters.map((c) => (
                      <SwipeableSettingsRow
                        key={c.chapterId}
                        label={c.chapterName ?? (c.number !== undefined ? `Chapter ${c.number}` : c.chapterId)}
                        description={`${c.pageCount} page${c.pageCount === 1 ? '' : 's'} · ${formatBytes(c.bytes)}${c.state !== 'complete' ? ` · ${c.state}` : ''}`}
                        actions={[
                          { label: 'Delete', icon: TrashIcon, destructive: true, onPress: () => void deleteChapter(s, c.chapterId) },
                        ]}
                      />
                    ))}
                </View>
              );
            })}
          </SettingsSection>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No downloads yet. Open a series and tap Download to keep chapters for offline reading.
          </ThemedText>
        )}

        {usage.bySeries.length > 0 && (
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

function StorageSummaryRow({ usage }: { usage: StorageUsage }) {
  return (
    <View style={styles.summary}>
      <ThemedText type="title">{formatBytes(usage.totalBytes)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {usage.seriesCount} series · {usage.chapterCount} chapter{usage.chapterCount === 1 ? '' : 's'} · {usage.pageCount} page
        {usage.pageCount === 1 ? '' : 's'}
      </ThemedText>
    </View>
  );
}

function Chevron({ open }: { open: boolean }) {
  const theme = useTheme();
  return open ? (
    <ChevronDownIcon color={theme.textSecondary} size={18} />
  ) : (
    <ChevronRightIcon color={theme.textSecondary} size={18} />
  );
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
    gap: Spacing.one,
  },
  empty: {
    paddingHorizontal: Spacing.three,
    textAlign: 'center',
  },
});
