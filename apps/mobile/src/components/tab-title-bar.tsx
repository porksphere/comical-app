import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { BarSurface } from '@/components/bar-surface';
import { ThemedText } from '@/components/themed-text';
import { MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { testId } from '@/lib/test-id';

/**
 * The plain title bar used by the tab screens that just name themselves (Library, History, Activity,
 * Settings). All four had a byte-identical copy of this — same styles, same structure — so a change
 * to any of it had to be made four times, which is how bars drifted apart in the first place.
 *
 * Overlays the screen's content (which pads itself by `insets.top + useTopBarHeight()`), so the list
 * scrolls under it and shows through the frost — see BarSurface.
 *
 * `titleSlot` replaces the plain title text with arbitrary leading content (e.g. the Library's list
 * selector); `right` fills a trailing slot pushed to the far edge (e.g. the Library's search icon).
 */
export function TabTitleBar({ title, titleSlot, right }: { title?: string; titleSlot?: ReactNode; right?: ReactNode }) {
  const barHeight = useTopBarHeight();
  return (
    <BarSurface style={styles.topBar}>
      {/* Cap+centre only on web; native fills the width so the title aligns with the full-width grids. */}
      <View style={[styles.titleRow, { height: barHeight, maxWidth: Platform.OS === 'web' ? MaxTopLevelWidth : undefined }]}>
        {titleSlot ?? (
          <ThemedText testID={title ? testId('screen-title', title) : undefined} numberOfLines={1} style={styles.title}>
            {title}
          </ThemedText>
        )}
        {right != null && <View style={styles.right}>{right}</View>}
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
  // the bar's frosted background stays full-bleed.
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
});
