/**
 * The Settings tab badge count — bridge and tracker updates available from the user's registries.
 * One combined query (a single number) so the pip subscribes to exactly one cache entry; the
 * per-item detail lives where it always did (the Bridges screen's "Update available" rows and the
 * registry browse screen). Servers without registry support resolve both checks to `null`, so the
 * count is simply 0 there.
 */
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';

export function useSettingsBadgeCount(): number {
  const ds = useDataSource();
  const { data } = useQuery({
    queryKey: queryKeys.registryUpdateCount(),
    queryFn: async ({ signal }) => {
      const [bridges, trackers] = await Promise.all([
        ds.checkRegistryUpdates(signal),
        ds.checkRegistryTrackerUpdates(signal),
      ]);
      return (bridges?.length ?? 0) + (trackers?.length ?? 0);
    },
  });
  return data ?? 0;
}
