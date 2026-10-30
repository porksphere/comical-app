import type { LiveMenuRows } from '@/components/context-menu-host';
import { SeriesCardSystemMenuRows } from '@/components/series-card-actions-menu';
import { SeriesCardPreview } from '@/components/series-card-preview';
import type { SeriesCardMenuProps } from '@/components/series-card-menu';
import { SystemContextMenu } from '@/components/system-context-menu';
import { useTheme } from '@/hooks/use-theme';

/**
 * iOS per-card quick actions: the system context menu (components/system-context-menu.tsx), where
 * Android keeps the custom hold popup (`series-card-menu.tsx`). Holding a card lifts its cover (the
 * `liftTarget` around `CoverFrame`), or a whole History or Activity row, into the Android
 * popup's panel (`SeriesCardPreview`), and UIKit draws the menu. Tapping the preview does what
 * tapping the card does.
 *
 * A card costs one plain native view while it scrolls: the rows and the preview mount when a hold
 * begins, from the root host, never per card. The SwiftUI context menu this file once held mounted
 * its rows per card, which is why it was removed. UIKit hides what it lifts, so `hidden` is never
 * set here.
 */
export function SeriesCardMenu({
  enabled,
  bridgeId,
  bridge,
  entry,
  direct,
  coverAspect,
  onOpen,
  children,
}: SeriesCardMenuProps) {
  const theme = useTheme();
  const content = children({ onLongPress: undefined, hidden: false, menuOpen: false });
  if (!bridgeId) return <>{content}</>;
  const rows: LiveMenuRows = (render) => (
    <SeriesCardSystemMenuRows
      bridgeId={bridgeId}
      entry={entry}
      {...(bridge !== undefined && { bridge })}
      {...(direct !== undefined && { direct })}>
      {render}
    </SeriesCardSystemMenuRows>
  );
  return (
    <SystemContextMenu
      enabled={enabled}
      rows={() => rows}
      preview={() => (
        <SeriesCardPreview
          bridgeId={bridgeId}
          entry={entry}
          {...(direct !== undefined && { direct })}
          {...(coverAspect !== undefined && { coverAspect })}
        />
      )}
      // A row lifts whole, filled in the page colour; a card's cover names its own corners.
      previewRadius={12}
      previewBackground={theme.background}
      {...(onOpen && { onPreviewPress: onOpen })}>
      {content}
    </SystemContextMenu>
  );
}
