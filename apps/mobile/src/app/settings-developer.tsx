import { Platform, StyleSheet } from 'react-native';

import { ScreenScrollView } from '@/components/screen-scroll-marker';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { scrollbarInset } from '@/lib/scrollbar-inset';
import { useApiBase } from '@/data/api';
import { useMockDataToggle } from '@/data/source';
import { barFade$, useBarFadeExperiment } from '@/lib/bar-fade-flag';
import { devProfiler$, useDevProfilerEnabled } from '@/lib/dev-profiler-flag';
import { router } from '@/lib/nav';

/** Dev-build-only: lets local development iterate against mock data without a running backend, and
 *  shows which server real requests target. The Settings screen only links here when
 *  `PROFILING_ENABLED`; the route itself stays registered unconditionally, since a route that exists
 *  but is unreachable costs nothing while a conditional <Stack.Screen> would just be noise. */
export default function DeveloperSettingsScreen() {
  const contentPadding = useSettingsScrollPadding(MaxContentWidth);
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  const [apiBase] = useApiBase();
  const profilerOn = useDevProfilerEnabled();
  const barFadeOn = useBarFadeExperiment();

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Developer" />
      <ScreenScrollView
        style={scrollbarInset(contentPadding.paddingTop)}
        contentContainerStyle={[styles.content, contentPadding]}>
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
        {/* THROWAWAY: the bar slide-away test (components/bar-test); its in-tab copy is on the Settings tab. */}
        {Platform.OS === 'ios' && (
          <SettingsSection title="Bar test">
            <SettingsRow testID="developer.bar-test" label="Root stack" onPress={() => router.push('/bar-test')} />
            <SettingsRow
              testID="developer.bar-test-upstream"
              label="Upstream copy"
              onPress={() => router.push('/bar-test-upstream')}
            />
            {/* THROWAWAY: the series bar's fade candidates (lib/bar-fade-flag). */}
            <SettingsRow
              testID="developer.bar-fade"
              label="Fade the series bar"
              description="Switches the series bar at the page's title with a Core Animation fade, instead of UIKit's scroll-edge crossfade."
              right={<ThemedSwitch value={barFadeOn} onValueChange={(v) => barFade$.enabled.set(v)} />}
            />
          </SettingsSection>
        )}
      </ScreenScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
