import { StyleSheet } from 'react-native';

import type { SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { useApiBase } from '@/data/api';
import { useMockDataToggle } from '@/data/source';
import { devProfiler$, useDevProfilerEnabled } from '@/lib/dev-profiler-flag';

/** Dev-build-only: lets local development iterate against mock data without a running backend, and
 *  shows which server real requests target. The Settings screen only links here when
 *  `PROFILING_ENABLED`; the route itself stays registered unconditionally, since a route that exists
 *  but is unreachable costs nothing while a conditional <Stack.Screen> would just be noise. */
export default function DeveloperSettingsScreen() {
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  const [apiBase] = useApiBase();
  const profilerOn = useDevProfilerEnabled();

  const sections: SettingsFormSection[] = [
    {
      fields: [
        {
          kind: 'toggle',
          label: 'Use mock data',
          description: 'Browse/Series/Reader render generated sample content instead of calling the API.',
          value: mockEnabled,
          onChange: setMockEnabled,
        },
        {
          kind: 'toggle',
          label: 'JS profiler button',
          description:
            'Shows a floating on-device Hermes profiler that captures a JS sampling profile and uploads it to the dev server.',
          value: profilerOn,
          onChange: (v) => devProfiler$.enabled.set(v),
        },
        { kind: 'value', label: 'Server', description: apiBase, selectable: true },
      ],
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Developer" />
      <SettingsList sections={sections} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
