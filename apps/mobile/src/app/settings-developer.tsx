import { Platform, StyleSheet } from 'react-native';

import { fields, select, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { useApiBase } from '@/data/api';
import { useMockDataToggle } from '@/data/source';
import { devProfiler$, useDevProfilerEnabled } from '@/lib/dev-profiler-flag';
import { router } from '@/lib/nav';
import { seriesFoldedBacking$, useSeriesFoldedBacking } from '@/lib/series-bar-backing-flag';

/** Dev-build-only: lets local development iterate against mock data without a running backend, and
 *  shows which server real requests target. The Settings screen only links here when
 *  `PROFILING_ENABLED`; the route itself stays registered unconditionally, since a route that exists
 *  but is unreachable costs nothing while a conditional <Stack.Screen> would just be noise. */
export default function DeveloperSettingsScreen() {
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  const [apiBase] = useApiBase();
  const profilerOn = useDevProfilerEnabled();
  const seriesBacking = useSeriesFoldedBacking();

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
    // THROWAWAY: the two backings of the series bar on the folded Duo (lib/series-bar-backing-flag).
    ...(Platform.OS === 'ios'
      ? [
          {
            title: 'Series bar',
            footer: 'Folded Duo only. Takes effect on the next series page opened.',
            fields: [
              select({
                label: 'Backing',
                value: seriesBacking,
                options: [
                  { value: 'own', label: 'Own view', description: 'Fades with the scroll as the title does.' },
                  { value: 'edge', label: 'Scroll edge', description: 'The list\'s hard edge, behind the title once past.' },
                ],
                onChange: (mode) => seriesFoldedBacking$.mode.set(mode),
              }),
            ],
          },
        ]
      : []),
    // THROWAWAY: the bar slide-away test (components/bar-test); its in-tab copy is on the Settings tab.
    {
      title: 'Bar test',
      fields: fields(
        Platform.OS === 'ios' && { kind: 'link', testID: 'developer.bar-test', label: 'Root stack', onPress: () => router.push('/bar-test') },
        Platform.OS === 'ios' && {
          kind: 'link',
          testID: 'developer.bar-test-upstream',
          label: 'Upstream copy',
          onPress: () => router.push('/bar-test-upstream'),
        },
      ),
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
