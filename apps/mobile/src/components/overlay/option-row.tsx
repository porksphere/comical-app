/**
 * The single-select row every overlay menu is built from — the bridge/page selector, both sort
 * menus, the collection picker.
 *
 * It exists because there were FOUR copies of it, identical down to the `rgba(128,128,128,0.5)` in
 * the radio's border, and giving the web ones desktop chrome made them four things to remember
 * rather than one. A menu row is one idea; the differences between those copies (a thumbnail, a
 * second line) are props.
 *
 * Two forms, by platform:
 *
 * - **Native** is a bottom sheet's row: a filled `backgroundElement` pill, `RowHeight` tall, with a
 *   radio at the end. Sized and spaced for a thumb, which is what it is there.
 * - **Web** is the RAIL's row: transparent at rest, `backgroundElement` under the pointer,
 *   `backgroundSelected` when current, 34pt at an 8pt radius, and a check instead of a radio. The
 *   rail already lists these same bridges with these same thumbnails, and it looked like a
 *   different app from the dropdown listing them. Two surfaces showing one list have to agree.
 */
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useOverlayPresentation } from '@/components/overlay/overlay';
import { CheckIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

const IS_WEB = Platform.OS === 'web';

/**
 * The desktop treatment is the POPOVER's, not the web build's.
 *
 * A narrow browser window gets the bottom SHEET — the same surface a phone gets, dragged up from
 * the screen edge — and a sheet's rows are sized and spaced for a thumb. Gating on `Platform` alone
 * shipped 34pt menu rows into that sheet, which is the mobile variant wearing desktop chrome.
 */
function useDesktopRow(): boolean {
  // The hook runs unconditionally — `IS_WEB` is a module constant, but `&&` would still short it
  // out on native and the rule (rightly) can't tell a constant from a prop.
  const presentation = useOverlayPresentation();
  return IS_WEB && presentation === 'popover';
}

export function OptionRow({
  label,
  hint,
  selected,
  leading,
  onPress,
  testID,
}: {
  label: string;
  /** A second, quieter line under the label (the collection picker's item counts). */
  hint?: string;
  selected: boolean;
  /** Rendered before the label — the selector's bridge thumbnail. */
  leading?: React.ReactNode;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const desktop = useDesktopRow();
  const { hovered, handlers } = useHover();
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityState={{ selected }} {...handlers}>
      <View
        style={[
          styles.row,
          desktop && styles.webRow,
          {
            backgroundColor: desktop
              ? selected
                ? theme.overlaySelected
                : hovered
                  ? theme.overlayHover
                  : 'transparent'
              : hovered
                ? theme.overlaySelected
                : theme.overlayHover,
          },
        ]}>
        {leading}
        <View style={styles.text}>
          <ThemedText
            style={desktop && selected ? styles.webLabelSelected : undefined}
            themeColor={desktop && !selected ? 'textSecondary' : 'text'}
            numberOfLines={1}>
            {label}
          </ThemedText>
          {hint ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {hint}
            </ThemedText>
          ) : null}
        </View>
        {/* A CHECK on web, not a radio: the fill already says which row is current (the rail's own
            answer), so the mark confirms rather than carries it — and at 16pt beside a label it
            stops being the loudest thing in the menu. The slot is reserved either way, so selecting
            a row never reflows the labels beside it. */}
        {desktop ? (
          <View style={styles.check}>{selected ? <CheckIcon color={theme.accent} size={16} /> : null}</View>
        ) : (
          <View style={[styles.dot, selected && styles.dotOn]} />
        )}
      </View>
    </Pressable>
  );
}

/** A row that DOES something rather than selecting something (the collection picker's "New
 *  collection…"). Same metrics, accent label, no indicator — so it sits in the same list without
 *  reserving a slot for a mark it will never show. */
export function OptionActionRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const desktop = useDesktopRow();
  const { hovered, handlers } = useHover();
  return (
    <Pressable testID={testID} onPress={onPress} {...handlers}>
      <View
        style={[
          styles.row,
          desktop && styles.webRow,
          {
            backgroundColor: desktop
              ? hovered
                ? theme.overlayHover
                : 'transparent'
              : hovered
                ? theme.overlaySelected
                : theme.overlayHover,
          },
        ]}>
        <ThemedText style={{ color: theme.accent }}>{label}</ThemedText>
      </View>
    </Pressable>
  );
}

/** A group heading inside a menu ("Sort by", "Group by"). Shared with the rows so its indent can't
 *  drift from theirs — on web the rows moved in to 8pt and these were left at 16, which reads as the
 *  heading being outdented from its own list. */
export function OptionSectionLabel({ children }: { children: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    paddingHorizontal: IS_WEB ? Spacing.two : Spacing.three,
    paddingBottom: Spacing.half,
  },
  // Same height as the filter bar's own rows (`CONTROL_HEIGHT` in filter-types.ts) so a picker row
  // reads at the same size as every other tappable row in the app.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // minHeight, not height: a row with a `hint` is two lines, and the collection picker's counts
    // were being clipped by a fixed one.
    minHeight: RowHeight,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
  // The rail's own 34pt at an 8pt radius. A dropdown under a pointer is a menu, and a menu's rows
  // are the size of their text.
  webRow: {
    minHeight: 34,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  // `flex: 1` (not `justifyContent: 'space-between'`) so the label always starts right after the
  // leading slot and always ends right before the indicator, whether or not this row has either.
  text: {
    flex: 1,
  },
  webLabelSelected: {
    fontWeight: '600',
  },
  check: {
    width: 16,
    alignItems: 'center',
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  dotOn: {
    borderColor: '#3478F6',
    backgroundColor: '#3478F6',
  },
});
