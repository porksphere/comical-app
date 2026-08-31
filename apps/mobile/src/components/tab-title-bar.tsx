import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';
import type { AnimatedProps } from 'react-native-reanimated';

import { BarSurface } from '@/components/bar-surface';
import { DesktopNavWidth } from '@/components/app-tabs';
import { ThemedText } from '@/components/themed-text';
import { MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useHasSidebar } from '@/hooks/use-content-width';
import { useIsLargeScreen, useTopBarHeight } from '@/hooks/use-responsive';
import { testId } from '@/lib/test-id';

/**
 * The plain title bar used by the tab screens that just name themselves (Library, History, Activity,
 * Settings). All four had a byte-identical copy of this — same styles, same structure — so a change
 * to any of it had to be made four times, which is how bars drifted apart in the first place.
 *
 * Overlays the screen's content (which pads itself by `insets.top + useTopBarHeight()`), so the list
 * scrolls behind it rather than stopping short of it — see BarSurface.
 *
 * `titleSlot` replaces the plain title text with arbitrary leading content (e.g. the Library's list
 * selector); `right` fills a trailing slot pushed to the far edge (e.g. the Library's search icon).
 */
export function TabTitleBar({
  title,
  titleSlot,
  right,
  barStyle,
}: {
  title?: string;
  titleSlot?: ReactNode;
  right?: ReactNode;
  /** Extra style for the bar surface itself — e.g. an animated rule colour, for a screen whose
   *  pinned section heading takes over the bottom edge (see StickySectionHeader). */
  barStyle?: AnimatedProps<ViewProps>['style'];
}) {
  const barHeight = useTopBarHeight();
  // On wide/desktop viewports app-tabs.tsx overlays its icon-only nav row at this same bar's
  // trailing edge (see its `navRight` comment). Without reserving room for it here, `right`'s own
  // trailing icons render at literally the same coordinates as the nav's icons and swallow taps
  // meant for this bar — see `DesktopNavWidth`'s comment for how that was found and measured.
  // ...but only where that nav is actually rendered. At rail widths it isn't (the sidebar replaced
  // it), so reserving its width there is pure dead space between `right` and the bar's edge.
  const largeScreen = useIsLargeScreen();
  const railNav = useHasSidebar();
  const reserveForDesktopNav = largeScreen && !railNav;
  return (
    <BarSurface style={[styles.topBar, barStyle]}>
      {/* Cap+centre only on web; native fills the width so the title aligns with the full-width grids. */}
      <View style={[styles.titleRow, { height: barHeight, maxWidth: Platform.OS === 'web' ? MaxTopLevelWidth : undefined }]}>
        {titleSlot ?? (
          <ThemedText testID={title ? testId('screen-title', title) : undefined} numberOfLines={1} style={styles.title}>
            {title}
          </ThemedText>
        )}
        {right != null && <View style={[styles.right, reserveForDesktopNav && styles.rightDesktop]}>{right}</View>}
      </View>
    </BarSurface>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: 'flex-end',
  },
  // Capped + centred to the content width, so the title lines up with the grid/rows beneath it while
  // the bar's background stays full-bleed.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  // Pushed to the trailing edge; the title/selector takes the remaining space.
  right: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  rightDesktop: {
    // + Spacing.four as a buffer gap, not flush against the nav's own icons.
    marginRight: DesktopNavWidth + Spacing.four,
  },
});
