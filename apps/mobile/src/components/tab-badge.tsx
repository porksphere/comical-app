/**
 * The unread-count pip overlaid on a tab bar icon. `TabBadge` is the dumb pill; `ActivityTabBadge`
 * is the self-subscribing wrapper `app-tabs` renders — it MUST own the subscription itself
 * (rather than the count being passed down) because `app-tabs` memoizes its trigger elements, so
 * a count change re-renders only this leaf, never the whole bar.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { useSettingsBadgeCount } from '@/data/use-settings-badge';
import { useTheme } from '@/hooks/use-theme';

export function TabBadge({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View pointerEvents="none" style={[styles.pip, { backgroundColor: theme.accent }]} testID="tab-badge">
      <ThemedText style={[styles.label, { color: theme.accentOn }]}>{count > 9 ? '9+' : count}</ThemedText>
    </View>
  );
}

/** The Activity tab's pip — unread new chapters (drains on read/mark-read/clear, not on look). */
export function ActivityTabBadge() {
  return <TabBadge count={useActivityBadgeCount()} />;
}

/** The Settings tab's pip — bridge/tracker updates available from the user's registries. */
export function SettingsTabBadge() {
  return <TabBadge count={useSettingsBadgeCount()} />;
}

/**
 * The bare accent count pill (no positioning of its own — the parent places it). Used on the Settings
 * landing screen, overlaid on a category ROW's icon exactly the way the tab pip sits on the tab icon,
 * so the thing that surfaced the tab dot is visible in the page too. Matching color and count make
 * the connection unmistakable.
 */
export function UpdatePip({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.pip, styles.static, { backgroundColor: theme.accent }]} testID="settings-update-pip">
      <ThemedText style={[styles.label, { color: theme.accentOn }]}>{count > 9 ? '9+' : count}</ThemedText>
    </View>
  );
}

/**
 * A bare accent dot (no count) — marks a SINGLE item that has an update, e.g. one bridge row, where a
 * number would be noise (it's always "1"). Same accent as `UpdatePip`, so a row's dot reads as the
 * per-item form of the category pill it rolls up into. The parent positions it.
 */
export function UpdateDot() {
  const theme = useTheme();
  return <View style={[styles.dot, { backgroundColor: theme.accent }]} testID="update-dot" pointerEvents="none" />;
}

const styles = StyleSheet.create({
  pip: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  // Drops the tab-icon overlay offsets so the pill flows where its parent puts it (the settings row
  // wraps it in its own absolutely-positioned overlay over the category icon).
  static: {
    position: 'relative',
    top: 0,
    right: 0,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
  },
});
