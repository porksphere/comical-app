import { useIsLastItem } from "@legendapp/list/react-native";
import { StyleSheet, View } from "react-native";

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
 */
export function RowHairline() {
  const theme = useTheme();
  const isLast = useIsLastItem();
  return isLast ? null : (
    <View style={[styles.line, { backgroundColor: theme.hairline }]} />
  );
}

const styles = StyleSheet.create({
  line: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
