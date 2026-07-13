import { Platform, Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { TrashIcon } from '@/components/icons/ui-icons';
import { SettingsGutter, SettingsRow } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

/** Width of the revealed action pane. Also how far the row rests open. */
const ACTION_WIDTH = 88;

// Constant for the process, so the branch in `SwipeableSettingsRow` is stable and each platform
// only ever renders one of the two implementations below — their hooks never interleave.
const IS_WEB = Platform.OS === 'web';

// Whether this web client has a hovering pointer at all. A touchscreen laptop/tablet on web fires no
// hover events ever, so a hover-revealed trash would be permanently invisible there — those clients
// get it shown outright instead.
const CAN_HOVER = IS_WEB && typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;

type Props = {
  label: string;
  description?: string;
  descriptionColor?: string;
  /** Tapping the row body (e.g. opening the item's detail page). */
  onPress?: () => void;
  /** Caption under the trash glyph in the revealed pane. */
  actionLabel?: string;
  /** Invoked when the user commits to the destructive action — open a confirm overlay here. */
  onAction: () => void;
};

/**
 * A `SettingsRow` whose destructive action is reached by swiping, iOS-style: drag the row left and
 * it rests open over a red Delete pane, which you then tap. The swipe alone never destroys
 * anything — `onAction` should still confirm.
 *
 * Android gets the same rest-open behavior rather than Material's fling-to-dismiss: dismissal there
 * is only safe paired with an undo snackbar, and this app has no snackbar system.
 *
 * On web there is no swipe at all — dragging a row with a mouse is not something anyone would try.
 * The row instead reveals a trash button on hover (and shows it unconditionally on a touch screen,
 * which never hovers).
 *
 * Must live inside a `<SettingsSection bleed>` so the pane runs to the card's edge and is clipped
 * by its corners.
 */
export function SwipeableSettingsRow(props: Props) {
  return IS_WEB ? <HoverDeleteRow {...props} /> : <SwipeRow {...props} />;
}

function SwipeRow({ label, description, descriptionColor, onPress, actionLabel = 'Delete', onAction }: Props) {
  const theme = useTheme();
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      // The swipe CONTAINER cancels the screen's gutter (rather than the row inside it), so the
      // delete pane it reveals runs all the way to the screen's edge. The row therefore only pads —
      // it must not pull itself out a second time. See `SettingsGutter`.
      containerStyle={styles.swipeContainer}
      // The row slides OVER the action pane, so it needs an opaque background of its own — the pane
      // is rendered behind it and would otherwise show through the row's transparent body.
      childrenContainerStyle={{ backgroundColor: theme.background }}
      onSwipeableWillOpen={hapticImpactLight}
      renderRightActions={(_progress, translation) => (
        <DeleteAction translation={translation} label={actionLabel} onPress={onAction} />
      )}>
      <SettingsRow
        label={label}
        description={description}
        descriptionColor={descriptionColor}
        escapeGutter={false}
        onPress={onPress}
      />
    </ReanimatedSwipeable>
  );
}

/** The red pane behind the row. `translation` is the row's horizontal offset (negative while open),
 *  so shifting the pane by `translation + ACTION_WIDTH` keeps it pinned to the row's trailing edge
 *  — it slides in with the row instead of sitting statically underneath it. */
function DeleteAction({ translation, label, onPress }: { translation: SharedValue<number>; label: string; onPress: () => void }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: translation.value + ACTION_WIDTH }] }));
  return (
    <Animated.View style={[styles.actionPane, style]}>
      <Pressable
        onPress={() => {
          hapticImpactLight();
          onPress();
        }}
        style={[styles.action, { backgroundColor: theme.danger }]}
        accessibilityRole="button"
        accessibilityLabel={label}>
        <TrashIcon color={theme.accentOn} size={20} />
        <ThemedText type="small" style={{ color: theme.accentOn }}>
          {label}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

function HoverDeleteRow({ label, description, descriptionColor, onPress, actionLabel = 'Delete', onAction }: Props) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  // The trash is a SIBLING of the row, not something inside its `right` slot: react-native-web
  // renders an accessibilityRole="button" Pressable as a real <button>, and a <button> inside a
  // <button> is invalid HTML — React rejects it, and the two click targets overlap. So the trash
  // gets its own lane to the row's right, which is also exactly where the swipe pane sits on native.
  // Both halves feed the same `hovered`, so crossing from the row onto the trash doesn't hide it.
  return (
    <View style={styles.webRow}>
      <View style={styles.webRowBody}>
        <SettingsRow
          label={label}
          description={description}
          descriptionColor={descriptionColor}
          escapeGutter={false}
          onPress={onPress}
          onHoverIn={onHoverIn}
          onHoverOut={onHoverOut}
        />
      </View>
      <Pressable
        onPress={onAction}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
        // Faded out until the pointer is somewhere over the row. Pointer-less clients (a touchscreen
        // on web fires no hover events at all) keep it visible — see CAN_HOVER.
        style={[styles.webTrash, CAN_HOVER && !hovered && styles.webTrashIdle]}
        accessibilityRole="button"
        accessibilityLabel={`${actionLabel} ${label}`}>
        <TrashIcon color={theme.danger} size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    marginHorizontal: -SettingsGutter,
  },
  actionPane: {
    width: ACTION_WIDTH,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    cursor: 'pointer',
  },
  webRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // Cancels the screen's gutter for the same reason the native swipe container does: the row's
    // hover highlight should reach the screen's edge, and the trash lane should sit in the margin
    // rather than inside the text column.
    marginHorizontal: -SettingsGutter,
  },
  webRowBody: {
    flex: 1,
  },
  webTrash: {
    justifyContent: 'center',
    alignItems: 'center',
    // A fixed lane, so the trash occupies the same space whether or not it's currently shown and
    // the row's text never reflows as it fades in.
    width: SettingsGutter + 20,
    paddingRight: SettingsGutter,
    cursor: 'pointer',
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  webTrashIdle: {
    opacity: 0,
  },
});
