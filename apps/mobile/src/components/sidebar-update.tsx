/**
 * Where the shell's own update stands, in the rail's footer beside Settings — so a download that
 * finished while you were reading is a button in the corner of the window rather than a line
 * buried in Settings → About. Only the two states the shell itself is in (fetching, or ready for a
 * restart): "an update exists" stays with the toast and the About row, since it asks for a
 * decision rather than reporting on one already taken.
 */
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { RefreshIcon } from '@/components/icons/ui-icons';
import { ContinuousCorner, Fonts, Spacing } from '@/constants/theme';
import { useAppUpdateAction } from '@/data/use-app-update';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

/** Matches the footer's other controls, which it sits in a row with. */
export const SIDEBAR_UPDATE_HEIGHT = 36;

export function SidebarUpdate({ compact }: { compact: boolean }) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  const update = useAppUpdateAction();
  if (update?.step !== 'restart' && update?.step !== 'downloading') return null;

  if (update.step === 'downloading') {
    return (
      <View
        testID="sidebar.update.downloading"
        accessibilityRole="progressbar"
        accessibilityLabel="Downloading update"
        style={[styles.pill, compact && styles.square]}>
        <ActivityIndicator size="small" color={theme.textSecondary} />
        {compact ? null : (
          <Text numberOfLines={1} style={[styles.label, { color: theme.textSecondary }]}>
            Downloading update…
          </Text>
        )}
      </View>
    );
  }

  return (
    <Pressable
      {...handlers}
      testID="sidebar.update.restart"
      onPress={update.run}
      accessibilityRole="button"
      accessibilityLabel={`Restart to update${update.version ? ` to ${update.version}` : ''}`}
      style={({ pressed }) => [
        styles.pill,
        styles.button,
        compact && styles.square,
        { backgroundColor: hovered ? theme.accentHover : theme.accent },
        pressed && styles.pressed,
      ]}>
      <RefreshIcon color={theme.accentOn} size={16} />
      {compact ? null : (
        <Text numberOfLines={1} style={[styles.label, styles.labelOn, { color: theme.accentOn }]}>
          Restart to update
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: SIDEBAR_UPDATE_HEIGHT,
    paddingHorizontal: Spacing.three,
    // Shrinks to the rail, which can be dragged narrower than the label.
    flexShrink: 1,
    minWidth: 0,
    ...ContinuousCorner,
    borderRadius: Spacing.two,
  },
  button: {
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  square: {
    width: SIDEBAR_UPDATE_HEIGHT,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    flexShrink: 1,
  },
  labelOn: {
    fontWeight: '600',
  },
});
