import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { accessibilityIdentifier, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { READING_VIEWS, parseReadingView, setReadingView, useReadingView } from '@/hooks/use-reading-view';
import { useActiveColorScheme } from '@/hooks/use-theme';

/** iOS: the system's segmented control, hosted from SwiftUI. See `reading-switch` for the rest. */
export function ReadingSwitch() {
  const scheme = useActiveColorScheme();
  const view = useReadingView();
  const unread = useActivityBadgeCount();
  return (
    <View style={styles.row}>
      <Host colorScheme={scheme} style={styles.host}>
        <Picker
          selection={view}
          onSelectionChange={(v) => {
            const next = parseReadingView(v);
            if (next) setReadingView(next);
          }}
          modifiers={[pickerStyle('segmented'), accessibilityIdentifier('reading.switch')]}>
          {READING_VIEWS.map((option) => (
            <Text key={option.id} modifiers={[tag(option.id), accessibilityIdentifier(`reading.switch.${option.id}`)]}>
              {option.id === 'new' && unread > 0 ? `${option.label} (${unread})` : option.label}
            </Text>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

// A UISegmentedControl is 32pt tall on every iOS.
const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  host: {
    height: 32,
  },
});
