/**
 * The Recent group for the sidebar: the tab's two views, History and New chapters, as rows of
 * their own. The same shape as `sidebar-bridges`: a view is a SCOPE of the Recent tab, so a row
 * moves the shared selection (`setRecentView`, the same store the screen's switch writes) and then
 * goes to the tab. Where these rows show, the screen leaves its own switch out (`RecentSwitch`).
 */
import { Bell, History, type LucideIcon } from 'lucide-react-native';

import { SidebarCount, SidebarRow, SidebarThumbSize } from '@/components/app-sidebar';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { RECENT_VIEWS, setRecentView, useRecentView, type RecentView } from '@/hooks/use-recent-view';
import { useTheme } from '@/hooks/use-theme';
import { router } from '@/lib/nav';
import { ROOT_TAB_PATHS } from '@/lib/root-tabs';

const ICONS: Record<RecentView, LucideIcon> = { history: History, new: Bell };

export function SidebarRecent({ active, onReselect }: { active?: boolean; onReselect?: () => void }) {
  const theme = useTheme();
  const view = useRecentView();
  const unread = useActivityBadgeCount();
  return (
    <>
      {RECENT_VIEWS.map((option) => {
        const Icon = ICONS[option.id];
        const current = active === true && option.id === view;
        return (
          <SidebarRow
            key={option.id}
            testID={`sidebar.recent.${option.id}`}
            label={option.label}
            active={current}
            leading={<Icon size={SidebarThumbSize} color={theme.text} />}
            trailing={option.id === 'new' ? <SidebarCount count={unread} /> : undefined}
            onPress={() => {
              if (current) onReselect?.();
              setRecentView(option.id);
              router.navigate(ROOT_TAB_PATHS.recent as never);
            }}
          />
        );
      })}
    </>
  );
}
