/**
 * The Activity badge count — unread new chapters across the whole feed. Inbox-style but sticky:
 * opening the Activity tab does NOT clear it; an item only leaves the count when its chapter is
 * read (actually read, or the row's "Mark read" swipe) or its feed entry is cleared. One hook
 * feeds both badges: whatever component subscribes renders the tab pip, and a side effect mirrors
 * the same number onto the app icon.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { syncAppBadge } from '@/data/activity/app-badge';
import { activityCountQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

export function useActivityBadgeCount(): number {
  const ds = useDataSource();
  const mock = useMockActive();
  const { data } = useQuery(activityCountQuery(ds, mock));
  const count = data ?? 0;

  useEffect(() => syncAppBadge(count), [count]);

  return count;
}
