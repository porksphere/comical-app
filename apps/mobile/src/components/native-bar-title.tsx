import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';

/**
 * The iOS navigation bar's title slot holding the custom bar's cluster — thumbnail, name ▾ — in place
 * of a title. The title slot is the one place in the bar UIKit never wraps in a Liquid Glass capsule
 * (every leading/trailing item is a bar button item and gets one), so the cluster reads as it does in
 * the custom bar: a picture and plain text with a caret, with only the real buttons beside it as
 * glass.
 *
 * UIKit centres a title view in whatever is left between the bar's items, and iOS has no leading
 * alignment for it. So the row asks for the whole bar's width: UIKit clamps a title view to the
 * space it has and centres THAT, which puts its leading edge at the bar's margin — and the row,
 * shrinkable, lays its cluster out from that edge. The cluster lands where the custom bar's did.
 */
export function NativeBarTitle({ children }: { children: ReactNode }) {
  const width = useContentWidth();
  return (
    <Stack.Title asChild>
      <View style={[styles.row, { width }]}>{children}</View>
    </Stack.Title>
  );
}

/**
 * What is left of the row for its selectors' text once the bar's margins and its `items`
 * trailing capsules are placed — what a selector may grow to before truncating. The capsule's
 * width and the margin are UIKit's own (iOS 26), measured rather than exposed.
 */
export function useNativeBarTitleRoom(items: number): number {
  return useContentWidth() - 2 * BAR_MARGIN - items * BAR_ITEM_WIDTH;
}

const BAR_MARGIN = 16;
const BAR_ITEM_WIDTH = 52;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    // The custom bar's `selectorRow` gap: the tile, bridge ▾ and page ▾ read as three things, not
    // one run of text.
    gap: Spacing.three,
    // The width above is a request; the bar hands the title view what is left between its items
    // and the row shrinks to it, the labels inside truncating rather than the row overflowing.
    flexShrink: 1,
    minWidth: 0,
  },
});
