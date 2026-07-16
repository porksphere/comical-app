/**
 * Storage — a Settings sub-page for on-device space: the reclaimable image cache (size + clear + a
 * max that's enforced on launch) and the durable downloads footprint (with a link to manage them).
 *
 * The image cache is the usual space hog: the app disk-caches every cover, thumbnail, and READ page
 * via expo-image with no cap, so heavy reading grows it into the GBs independent of downloads. Sizes
 * are the ACTUAL bytes on disk (a synchronous directory walk), measured after paint with a
 * "measuring…" placeholder. Native only — on web the probes report 0.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { SettingsSelectRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { downloadsDiskUsage } from '@/data/downloads/blob-store';
import { formatBytes } from '@/data/downloads/format';
import { cacheDiskUsage, cachePrefs$, clearImageCache, useCachePrefs } from '@/data/image-cache';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';

const GB = 1024 * 1024 * 1024;
/** Max image-cache size, as byte-count strings (0 = unlimited) for the select row. */
const CACHE_MAX_OPTIONS: SettingsOption<string>[] = [
  { value: '0', label: 'Unlimited', description: 'Never auto-clear cached images.' },
  { value: String(0.5 * GB), label: '512 MB', description: 'Clear the image cache on launch if it exceeds this.' },
  { value: String(GB), label: '1 GB', description: 'Clear the image cache on launch if it exceeds this.' },
  { value: String(2 * GB), label: '2 GB', description: 'Clear the image cache on launch if it exceeds this.' },
  { value: String(4 * GB), label: '4 GB', description: 'Clear the image cache on launch if it exceeds this.' },
];

export default function StorageScreen() {
  const contentPadding = useSettingsScrollPadding();
  const router = useRouter();
  const cacheMax = useCachePrefs().maxBytes;

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
            description="Cleared on launch if it grows past this."
            value={String(cacheMax)}
            options={CACHE_MAX_OPTIONS}
            onChange={(v) => cachePrefs$.maxBytes.set(Number(v))}
            placeholder="Unlimited"
          />
        </SettingsSection>

        <SettingsSection title="Downloads">
          <SettingsRow
            label="Downloads on disk"
            description={dlDiskSize === null ? 'Measuring…' : `${formatBytes(dlDiskSize)} — kept for offline reading`}
          />
          <SettingsRow
            label="Manage downloads"
            description="View and delete downloaded series and chapters."
            onPress={() => router.push('/downloads')}
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
