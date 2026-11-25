/**
 * Where the shell's own update stands, in the sidebar's top row beside Settings — so a download
 * that finished while you were reading is a button in the corner of the window rather than a line
 * buried in Settings → About. Only the two states the shell itself is in (fetching, or ready for a
 * restart): "an update exists" stays with the toast and the About row, since it asks for a
 * decision rather than reporting on one already taken.
 */
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { RefreshIcon } from '@/components/icons/ui-icons';
import { useAppUpdateAction } from '@/data/use-app-update';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

/** The top row's other button, which it sits beside. */
const SIZE = 28;

export function SidebarUpdate() {
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
        style={styles.button}>
        <ActivityIndicator size="small" color={theme.textSecondary} />
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
        styles.button,
        styles.restart,
        { backgroundColor: hovered ? theme.accentHover : theme.accent },
        pressed && styles.pressed,
      ]}>
      <RefreshIcon color={theme.accentOn} size={15} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  restart: {
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  pressed: { opacity: 0.6 },
});
