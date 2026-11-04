import { useIsLastItem } from "@legendapp/list/react-native";
import { StyleSheet, View } from "react-native";

import { useSideInsets } from "@/hooks/use-content-width";
import { useIsDesktop } from "@/hooks/use-responsive";
import { useTheme } from "@/hooks/use-theme";

/**
 * The divider under a list row, drawn inside the row's own box instead of as an
 * `ItemSeparatorComponent`.
 *
 * LegendList renders a separator as a sibling of the item inside that item's container, so it lands
 * in the container's measured height — where a hairline is smaller than both the 1/8pt the list
 * floors sizes to and the `1/PixelRatio + 0.01` delta under which it discards a re-measure. A row
 * that re-measures mid-animation can lose its divider and that pixel of height with it. Absolutely
 * positioned it measures as nothing, so there is nothing left to lose.
 *
 * Not drawn on desktop: there the rows have the room to separate themselves, and a line that stops
 * at the content column's edge reads as a rule that ran out, not as a divider.
 *
 * Runs out past the safe area's sides, which the rows keep clear of (the lists pad their content
 * by them): on the folded iPhone Duo those sides are the vertical bar, and a rule that stopped at
 * its edge read as cut off. The row's own content, its `⋯` included, stays where it is.
 */
export function RowHairline() {
  const theme = useTheme();
  const isLast = useIsLastItem();
  const desktop = useIsDesktop();
  const sides = useSideInsets();
  return isLast || desktop ? null : (
    <View style={[styles.line, { backgroundColor: theme.hairline, left: -sides.left, right: -sides.right }]} />
  );
}

const styles = StyleSheet.create({
  line: {
    position: "absolute",
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
