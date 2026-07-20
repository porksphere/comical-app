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
 * The same accent count pill as the tab pip, but laid out inline in a row (not overlaid on an icon).
 * Used on the Settings landing screen's Bridges/Trackers rows so the thing that surfaced the tab pip
 * is visible in the page too — matching color and count makes the connection unmistakable.
 */
export function InlineUpdatePip({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.pip, styles.inline, { backgroundColor: theme.accent }]} testID="settings-update-pip">
      <ThemedText style={[styles.label, { color: theme.accentOn }]}>{count > 9 ? '9+' : count}</ThemedText>
    </View>
  );
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
  // Cancels the tab-icon overlay positioning so the same pill sits inline in a settings row.
  inline: {
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
