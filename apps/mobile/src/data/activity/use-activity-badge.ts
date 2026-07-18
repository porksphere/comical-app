/**
 * The Activity badge count — unread new chapters detected since the user last opened the Activity
 * tab (the seen watermark). One hook feeds both badges: whatever component subscribes renders the
 * tab pip, and a side effect mirrors the same number onto the app icon.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { syncAppBadge } from '@/data/activity/app-badge';
import { useActivitySeenAt } from '@/data/activity/seen';
import { activityCountQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

export function useActivityBadgeCount(): number {
  const ds = useDataSource();
  const mock = useMockActive();
  const seenAt = useActivitySeenAt();
  // Bumping the watermark changes the query key, so opening the Activity tab refetches (to 0)
  // immediately rather than waiting out staleTime on a cached count.
  const { data } = useQuery(activityCountQuery(ds, mock, seenAt));
  const count = data ?? 0;

  useEffect(() => syncAppBadge(count), [count]);

  return count;
}
