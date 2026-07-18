/**
 * The unread-count pip overlaid on a tab bar icon. `TabBadge` is the dumb pill; `ActivityTabBadge`
 * is the self-subscribing wrapper `app-tabs` renders — it MUST own the subscription itself
 * (rather than the count being passed down) because `app-tabs` memoizes its trigger elements, so
 * a count change re-renders only this leaf, never the whole bar.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
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

/** The Activity tab's pip — new chapters detected since the tab was last opened. */
export function ActivityTabBadge() {
  return <TabBadge count={useActivityBadgeCount()} />;
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
  label: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
  },
});
