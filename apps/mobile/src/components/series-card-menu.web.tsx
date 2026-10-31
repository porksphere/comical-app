import { CardMenuTrigger } from '@/components/card-menu-trigger';
import { SeriesCardMenuRows } from '@/components/series-card-actions-menu';
import type { SeriesCardMenuProps } from '@/components/series-card-menu';

/**
 * Web variant of the per-card quick-actions menu (see `series-card-menu.tsx` for the native
 * long-press version). The affordance is `CardMenuTrigger`'s — a 3-dot button on hover, and a
 * right-click — and the menu it opens is the native popup's menu without its preview: the same
 * rows, in the generic host's panel.
 *
 * Web has no lifted preview and no zoom entrance, so the props that shape them go unread, and
 * `children` never gets a long-press handler or `hidden`: only `menuOpen`, while THIS card's menu
 * is open.
 */
export function SeriesCardMenu({ enabled, bridgeId, bridge, entry, direct, children }: SeriesCardMenuProps) {
  if (!enabled || !bridgeId) return <>{children({ onLongPress: undefined, hidden: false, menuOpen: false })}</>;

  return (
    <CardMenuTrigger
      testID="series.card-menu.trigger"
      label="Series actions"
      rows={(render) => (
        <SeriesCardMenuRows
          bridgeId={bridgeId}
          entry={entry}
          {...(bridge !== undefined && { bridge })}
          {...(direct !== undefined && { direct })}>
          {render}
        </SeriesCardMenuRows>
      )}>
      {(menuOpen) => children({ onLongPress: undefined, hidden: false, menuOpen })}
    </CardMenuTrigger>
  );
}
