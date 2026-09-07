/**
 * Storage — a Settings sub-page for Comical's storage footprint. The shared `StorageBreakdownBar`
 * (the same labeled colour-key widget the Downloads page uses per-series) splits it into three
 * segments: **downloads** and **library** from whichever HOST owns them (this device when embedded,
 * the remote server otherwise — labeled "(server)"), and the **image cache**, always this device's.
 * Sections below break each down: downloads (durable, with a link to manage them) and the image
 * cache (reclaimable — size + clear + a max the native layer LRU-evicts against).
 *
 * The image cache is the usual space hog: the app disk-caches every cover, thumbnail, and READ page
 * via expo-image, so heavy reading grows it into the GBs independent of downloads. Its size is the
 * ACTUAL bytes of the whole Caches dir (a synchronous walk, so bridge-bundle cache rides along),
 * measured after paint. Native only for the cache/free-space probes — on web they report 0.
 *
 * The cumulative download-progress radial lives on the Downloads screen, not here — this page is about
 * space occupied, not work in flight.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, StyleSheet, View } from 'react-native';

import { StorageBreakdownBar, STORAGE_PALETTE } from '@/components/downloads/storage-breakdown-bar';
import { SettingsSelectRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { dlStorageUsage, libraryUsage } from '@/data/api';
import { readDiskInfo } from '@/data/downloads/disk';
import { EMPTY_STORAGE_USAGE } from '@/data/downloads/derive';
import { formatBytes } from '@/data/downloads/format';
import { getResolvedModeSync } from '@/data/embedded/preference';
import { queryKeys } from '@/data/queries';
import { applyImageCacheConfig, cachePrefs$, clearImageCache, measureCacheUsage, useCachePrefs } from '@/data/image-cache';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useRouter } from '@/lib/nav';

const MB = 1024 * 1024;
const GB = 1024 * MB;
/** Max image-cache size, as byte-count strings (0 = unlimited) for the select row. The native cache
 *  LRU-evicts to stay under whichever cap is chosen (see the row's own description). Steps are
 *  roughly ×1.5 apart: close enough that a phone with a few GB free can land near what it can
 *  actually spare, rather than choosing between halving and doubling. */
const CACHE_MAX_OPTIONS: SettingsOption<string>[] = [
  { value: '0', label: 'Unlimited' },
  ...[
    [256 * MB, '256 MB'],
    [512 * MB, '512 MB'],
    [768 * MB, '768 MB'],
    [GB, '1 GB'],
    [1.5 * GB, '1.5 GB'],
    [2 * GB, '2 GB'],
    [3 * GB, '3 GB'],
    [4 * GB, '4 GB'],
    [6 * GB, '6 GB'],
    [8 * GB, '8 GB'],
    [12 * GB, '12 GB'],
    [16 * GB, '16 GB'],
  ].map(([bytes, label]) => ({ value: String(bytes), label: label as string })),
];

/** Friendly names for the Caches subfolders we can recognise; anything else shows its raw name. */
function cacheEntryLabel(name: string): string {
  if (name.includes('SDImageCache') || name.startsWith('com.hackemist')) return 'Images (expo-image)';
  if (name === 'comical-bundles') return 'Bridge bundles';
  if (name.includes('NSURLCache') || name === 'fsCachedData' || name.startsWith('Cache.db')) return 'Network cache';
  return name;
}

export default function StorageScreen() {
  const contentPadding = useSettingsScrollPadding();
  const router = useRouter();
  const queryClient = useQueryClient();
  const cacheMax = useCachePrefs().maxBytes;
  const embedded = getResolvedModeSync() === 'embedded';

  // Downloads footprint + counts from the manifest (cross-platform); a backend without the module
  // yields an empty tree, not an error. `diskBytes` is the owning host's true blob size.
  const { data: usage = EMPTY_STORAGE_USAGE } = useQuery({
    queryKey: queryKeys.downloadsUsage(),
    queryFn: () => dlStorageUsage().catch(() => EMPTY_STORAGE_USAGE),
  });
  // The library's footprint on the same host (store docs + captured covers); null without the module.
  const { data: libUsage = null } = useQuery({
    queryKey: queryKeys.libraryUsage(),
    queryFn: () => libraryUsage().catch(() => null),
  });

  // True on-disk cache bytes (native only; 0 on web where the probe can't read disk), with the
  // per-entry split of the Caches dir — what shares it beyond expo-image's images (bridge bundles,
  // NSURLCache, framework caches), which is why the total can exceed the max cap. A cached query,
  // not a per-open walk: within the stale window a re-open shows the last measurement at once, and
  // a cold start shows the persisted one while the walk refreshes it. The row re-measures on tap.
  const {
    data: cacheUsage,
    isFetching: measuring,
    refetch: remeasure,
  } = useQuery({ queryKey: queryKeys.cacheUsage(), queryFn: measureCacheUsage });
  const cacheSize = cacheUsage?.bytes ?? null;
  const breakdown = cacheUsage?.breakdown ?? [];

  const clearCache = async () => {
    await clearImageCache();
    await queryClient.invalidateQueries({ queryKey: queryKeys.cacheUsage() });
  };

  // The breakdown segments: downloads and library come from whichever HOST owns them (this device
  // when embedded, the server when remote — labeled as such), the image cache is always this
  // device's. Fixed palette positions so the colours never shuffle as numbers tick.
  const hostSuffix = embedded ? '' : ' (server)';
  const downloadsBytes = usage.diskBytes ?? usage.totalBytes;
  const libraryBytes = libUsage?.diskBytes ?? 0;
  const segments = [
    { key: 'downloads', label: `Downloads${hostSuffix}`, bytes: downloadsBytes, color: STORAGE_PALETTE[0] },
    { key: 'library', label: `Library${hostSuffix}`, bytes: libraryBytes, color: STORAGE_PALETTE[4] },
    { key: 'cache', label: 'Image cache', bytes: cacheSize ?? 0, color: STORAGE_PALETTE[3] },
  ];
  const disk = readDiskInfo();

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Storage" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection>
          <View style={styles.summary}>
            <StorageBreakdownBar segments={segments} totalBytes={downloadsBytes + libraryBytes + (cacheSize ?? 0)} />
            {disk.usable && (
              <ThemedText type="small" themeColor="textSecondary">
                {formatBytes(disk.available)} free on this device
              </ThemedText>
            )}
          </View>
        </SettingsSection>

        <SettingsSection title="Downloads">
          {/* Totals come from whichever HOST owns the bytes. Embedded: the manifest rollup, shown
              beside the bar's actual-disk number so a gap surfaces orphaned blobs. Remote: the
              server's true blob-root size (`diskBytes`), labeled as such — none of it occupies this
              device, which is why the device bar above excludes it. */}
          <SettingsRow
            label="Downloaded content"
            description={
              usage.seriesCount === 0
                ? 'Nothing downloaded yet.'
                : `${embedded ? formatBytes(usage.totalBytes) : `${formatBytes(usage.diskBytes ?? usage.totalBytes)} on the server`} · ${usage.seriesCount} series · ${usage.chapterCount} chapter${usage.chapterCount === 1 ? '' : 's'} · ${usage.pageCount} page${usage.pageCount === 1 ? '' : 's'}`
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
            description={
              cacheSize === null
                ? 'Measuring…'
                : `${formatBytes(cacheSize)} — covers & pages you've viewed${measuring ? ' · re-measuring…' : ' · tap to re-measure'}`
            }
            onPress={() => void remeasure()}
          />
          {breakdown.length > 0 && (
            <View style={styles.breakdown}>
              {breakdown.map((e) => (
                <View key={e.name} style={styles.breakdownRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.breakdownName} numberOfLines={1}>
                    {cacheEntryLabel(e.name)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatBytes(e.bytes)}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
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
  summary: {
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  breakdown: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.one,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  breakdownName: {
    flexShrink: 1,
  },
});
