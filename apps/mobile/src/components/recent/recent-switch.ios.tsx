import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { accessibilityIdentifier, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { RECENT_VIEWS, parseRecentView, setRecentView, useRecentView, type RecentView } from '@/hooks/use-recent-view';
import { useActiveColorScheme } from '@/hooks/use-theme';

/**
 * iOS: the system's segmented control, hosted from SwiftUI. See `recent-switch` for the rest.
 *
 * Each view draws its own control in its own list, so switching the view on the tap replaced the
 * control the finger was on with one already showing the other side, and the thumb never slid.
 * The control takes the pick itself and the view follows once the slide has run.
 */
export function RecentSwitch() {
  const scheme = useActiveColorScheme();
  const view = useRecentView();
  const unread = useActivityBadgeCount();
  const [picked, setPicked] = useState(view);
  const [seen, setSeen] = useState(view);
  if (view !== seen) {
    setSeen(view);
    setPicked(view);
  }
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = (next: RecentView) => {
    setPicked(next);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => setRecentView(next), THUMB_SLIDE_MS);
  };
  return (
    <View style={styles.row}>
      {/* `ignoreSafeArea`: SwiftUI keeps its content out of the safe area, which moves as the bar
          slides away, so the control slid within its row while the list scrolled under it. */}
      <Host colorScheme={scheme} style={styles.host} ignoreSafeArea="all">
        <Picker
          selection={picked}
          onSelectionChange={(v) => {
            const next = parseRecentView(v);
            if (next) pick(next);
          }}
          modifiers={[pickerStyle('segmented'), accessibilityIdentifier('recent.switch')]}>
          {RECENT_VIEWS.map((option) => (
            <Text key={option.id} modifiers={[tag(option.id), accessibilityIdentifier(`recent.switch.${option.id}`)]}>
              {option.id === 'new' && unread > 0 ? `${option.label} (${unread})` : option.label}
            </Text>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

/** About as long as UIKit takes to slide a segmented control's thumb across. */
const THUMB_SLIDE_MS = 250;

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
