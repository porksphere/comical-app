/**
 * Storage — a Settings sub-page for on-device space. A device-storage bar up top shows Comical's
 * whole footprint at a glance (durable downloads + reclaimable image cache as distinct segments),
 * then two sections break it down: the **downloads** (durable, with a link to manage them) and the
 * **image cache** (reclaimable — size + clear + a max the native layer LRU-evicts against).
 *
 * The image cache is the usual space hog: the app disk-caches every cover, thumbnail, and READ page
 * via expo-image, so heavy reading grows it into the GBs independent of downloads. The cache size is
 * the ACTUAL bytes on disk (a synchronous directory walk), measured after paint with a "measuring…"
 * placeholder; downloads counts come from the manifest. Native only — on web the disk probes report 0.
 *
 * The cumulative download-progress radial lives on the Downloads screen, not here — this page is about
 * space occupied, not work in flight.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { DiskSpaceBar } from '@/components/downloads/disk-space-bar';
import { SettingsSelectRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { dlStorageUsage } from '@/data/api';
import { downloadsDiskUsage } from '@/data/downloads/blob-store';
import { formatBytes } from '@/data/downloads/format';
import { queryKeys } from '@/data/queries';
import { applyImageCacheConfig, cacheDiskUsage, cachePrefs$, clearImageCache, useCachePrefs } from '@/data/image-cache';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import type { StorageUsage } from '@comical/downloads';

const EMPTY_USAGE: StorageUsage = { totalBytes: 0, seriesCount: 0, chapterCount: 0, pageCount: 0, bySeries: [] };

const GB = 1024 * 1024 * 1024;
/** Max image-cache size, as byte-count strings (0 = unlimited) for the select row. The native cache
 *  LRU-evicts to stay under whichever cap is chosen. */
const CACHE_MAX_OPTIONS: SettingsOption<string>[] = [
  { value: '0', label: 'Unlimited', description: 'No cap — the cache can grow freely.' },
  { value: String(0.5 * GB), label: '512 MB', description: 'Evict least-recently-used images past this.' },
  { value: String(GB), label: '1 GB', description: 'Evict least-recently-used images past this.' },
  { value: String(2 * GB), label: '2 GB', description: 'Evict least-recently-used images past this.' },
  { value: String(4 * GB), label: '4 GB', description: 'Evict least-recently-used images past this.' },
];

export default function StorageScreen() {
  const contentPadding = useSettingsScrollPadding();
  const router = useRouter();
  const cacheMax = useCachePrefs().maxBytes;

  // Downloads footprint + counts from the manifest (cross-platform); a backend without the module
  // yields an empty tree, not an error.
  const { data: usage = EMPTY_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    queryFn: () => dlStorageUsage().catch(() => EMPTY_USAGE),
  });

  // True on-disk bytes for the storage bar (native only; 0 on web where the probes can't read disk).
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [dlDiskSize, setDlDiskSize] = useState<number | null>(null);
  const measure = useCallback(() => {
    setCacheSize(cacheDiskUsage());
    setDlDiskSize(downloadsDiskUsage());
  }, []);
  // Measure after paint — the directory walk is synchronous and can be chunky on a large cache.
  useEffect(() => {
    const t = setTimeout(measure, 0);
    return () => clearTimeout(t);
  }, [measure]);

  const clearCache = async () => {
    await clearImageCache();
    measure();
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Storage" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection>
          <DiskSpaceBar downloadsBytes={dlDiskSize ?? 0} cacheBytes={cacheSize ?? 0} />
        </SettingsSection>

        <SettingsSection title="Downloads">
          <SettingsRow
            label="Downloaded content"
            description={
              usage.seriesCount === 0
                ? 'Nothing downloaded yet.'
                : `${formatBytes(usage.totalBytes)} · ${usage.seriesCount} series · ${usage.chapterCount} chapter${usage.chapterCount === 1 ? '' : 's'} · ${usage.pageCount} page${usage.pageCount === 1 ? '' : 's'}`
            }
          />
          <SettingsRow
            label="Manage downloads"
            description="View and delete downloaded series and chapters."
            onPress={() => router.push('/downloads')}
          />
        </SettingsSection>

        <SettingsSection title="Image cache">
          <SettingsRow
            label="Cached images"
            description={cacheSize === null ? 'Measuring…' : `${formatBytes(cacheSize)} — covers & pages you've viewed`}
          />
          <SettingsRow
            label="Clear image cache"
            description="Free the space; images re-download when next viewed."
            onPress={() => void clearCache()}
          />
          <SettingsSelectRow
            label="Max image cache"
            description="Least-recently-used images are evicted to stay under this."
            value={String(cacheMax)}
            options={CACHE_MAX_OPTIONS}
            onChange={(v) => {
              cachePrefs$.maxBytes.set(Number(v));
              applyImageCacheConfig(); // hand the new cap to the native cache immediately
            }}
            placeholder="Unlimited"
          />
        </SettingsSection>
      </ScrollView>
    </ThemedView>
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
});
