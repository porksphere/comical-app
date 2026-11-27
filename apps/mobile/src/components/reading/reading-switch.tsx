import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { useSidebarListsScopes } from '@/hooks/use-content-width';
import { READING_VIEWS, setReadingView, useReadingView } from '@/hooks/use-reading-view';
import { useTheme } from '@/hooks/use-theme';

/**
 * The Reading tab's switch between its views, as the first row of the view's list (and above its
 * empty state). Android and web: tabs, the platform's control for views of one screen. iOS draws
 * the system's segmented control instead (`reading-switch.ios`).
 *
 * In the list, not pinned under the bar: on iOS nothing may stand between the bar and the list it
 * follows (AGENTS.md → the TOP bar), and one placement for every platform keeps the views alike.
 * Nothing where the sidebar lists the views as rows of its own.
 */
export function ReadingSwitch() {
  const theme = useTheme();
  const listed = useSidebarListsScopes();
  const view = useReadingView();
  const unread = useActivityBadgeCount();
  if (listed) return null;
  return (
    <View accessibilityRole="tablist" style={[styles.row, { borderBottomColor: theme.barHairline }]}>
      {READING_VIEWS.map((option) => {
        const selected = option.id === view;
        return (
          <Pressable
            key={option.id}
            testID={`reading.switch.${option.id}`}
            onPress={() => setReadingView(option.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={styles.tab}>
            <Text style={[styles.label, { color: selected ? theme.text : theme.textSecondary }]}>{option.label}</Text>
            {option.id === 'new' && unread > 0 ? (
              <Text style={[styles.count, { backgroundColor: theme.accent, color: theme.accentOn }]}>
                {unread > 99 ? '99+' : unread}
              </Text>
            ) : null}
            {selected ? <View style={[styles.indicator, { backgroundColor: theme.accent }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    height: 48,
    marginBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    fontWeight: '500',
  },
  count: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    overflow: 'hidden',
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  indicator: {
    position: 'absolute',
    bottom: -StyleSheet.hairlineWidth,
    width: 64,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
});
