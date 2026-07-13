import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsRow, SettingsSection, SettingsTopGap } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useApiBase } from '@/data/api';
import { useMockDataToggle } from '@/data/source';
import { devProfiler$, useDevProfilerEnabled } from '@/lib/dev-profiler-flag';

/** Dev-build-only: lets local development iterate against mock data without a running backend, and
 *  shows which server real requests target. The Settings screen only links here when
 *  `PROFILING_ENABLED`; the route itself stays registered unconditionally, since a route that exists
 *  but is unreachable costs nothing while a conditional <Stack.Screen> would just be noise. */
export default function DeveloperSettingsScreen() {
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  const [apiBase] = useApiBase();
  const profilerOn = useDevProfilerEnabled();

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Developer" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topBarInset + SettingsTopGap, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        <SettingsSection>
          <SettingsRow
            label="Use mock data"
            description="Browse/Series/Reader render generated sample content instead of calling the API."
            right={<ThemedSwitch value={mockEnabled} onValueChange={setMockEnabled} />}
          />
          <SettingsRow
            label="JS profiler button"
            description="Shows a floating on-device Hermes profiler that captures a JS sampling profile and uploads it to the dev server."
            right={<ThemedSwitch value={profilerOn} onValueChange={(v) => devProfiler$.enabled.set(v)} />}
          />
          <SettingsRow label="Server" description={apiBase} descriptionSelectable />
        </SettingsSection>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.five,
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
