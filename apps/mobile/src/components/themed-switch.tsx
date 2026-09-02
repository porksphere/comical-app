import { Platform, Pressable, StyleSheet, Switch, View, type SwitchProps } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';

/**
 * The app's boolean control — ONE component so every toggle in Settings reads the same, on both
 * platforms and both themes.
 *
 * Native gets react-native's real `Switch`, tinted with the app's accent instead of the OS default
 * (green on iOS/Android) and ticking a light haptic on every flip. That control is the platform
 * idiom there and should stay exactly what the OS draws.
 *
 * WEB gets the one below instead. react-native-web renders `Switch` as a DOM approximation of the
 * iOS pill — a ~51x31 fully-rounded track under a large circular thumb — which beside a settings
 * row on a desktop pane reads as a phone control someone dropped in. This one is the same idea at
 * desktop scale: smaller, flatter, hairlined so the off state has an edge on both themes, and with
 * the hover feedback a pointer expects and a touch screen has no use for. No haptics: there is no
 * Taptic Engine behind a trackpad.
 */
export function ThemedSwitch({ onValueChange, style, ...props }: SwitchProps) {
  const theme = useTheme();
  if (Platform.OS === 'web') return <WebSwitch onValueChange={onValueChange} style={style} {...props} />;
  return (
    // eslint-disable-next-line comical/require-test-id -- transparent forwarder: testID flows through {...props}; callers (e.g. SettingsToggleRow) pass it.
    <Switch
      trackColor={{ false: theme.backgroundSelected, true: theme.accent }}
      thumbColor={theme.accentOn}
      ios_backgroundColor={theme.backgroundSelected}
      // RN's iOS Switch hard-codes `alignSelf: 'flex-start'` into its own style, which in a row
      // means TOP and silently beats the row's `alignItems: 'center'` — so on iOS (only) every
      // toggle floated above the middle of its settings row. Ours centers instead, and a caller's
      // own `style` still overrides it (it comes last in the array).
      style={[styles.centered, style]}
      onValueChange={(v) => {
        hapticSelection();
        onValueChange?.(v);
      }}
      {...props}
    />
  );
}

/** Track 34x20 against the platform switch's ~51x31 — a settings row is 44pt tall, and a control
 *  that fills two thirds of it is the row's loudest element rather than its answer. */
const TRACK_W = 34;
const TRACK_H = 20;
const THUMB = 16;
const INSET = (TRACK_H - THUMB) / 2;

function WebSwitch({ value, onValueChange, disabled, style, testID, ...props }: SwitchProps) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  const on = !!value;
  // Animated rather than a re-render per flip: the thumb travels 14pt, which at a re-render is one
  // frame of teleport. `useDerivedValue` off the prop keeps the source of truth in React — this
  // control is not stateful, its parent is.
  const progress = useDerivedValue(() => withTiming(on ? 1 : 0, { duration: 140 }), [on]);
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (TRACK_W - THUMB - INSET * 2) }],
  }));
  return (
    <Pressable
      {...props}
      {...handlers}
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onValueChange?.(!on)}
      style={[styles.centered, disabled && styles.disabled, style]}>
      <View
        style={[
          styles.track,
          {
            backgroundColor: on ? theme.accent : theme.backgroundSelected,
            // The off state is a neutral fill on a neutral surface, which on the light theme is two
            // near-whites — so it carries a border and the on state doesn't (an accent fill is its
            // own edge). Hover lifts the border rather than the fill: a pointer resting on a control
            // should say "this is live", not preview a value it hasn't set.
            borderColor: on ? 'transparent' : hovered ? theme.textSecondary : theme.barHairline,
          },
        ]}>
        <Animated.View style={[styles.thumb, { backgroundColor: theme.accentOn }, thumbStyle]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignSelf: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    padding: INSET,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    // The thumb on the OFF state sits on a pale track on the light theme; without this it is a
    // white disc on near-white and the control looks empty rather than off.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
  },
});
