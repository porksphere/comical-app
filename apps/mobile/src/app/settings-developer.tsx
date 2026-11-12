import { StyleSheet } from 'react-native';

import type { SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { useApiBase } from '@/data/api';
import { useMockDataToggle } from '@/data/source';
import { setBookCoverShuffle, useBookCoverShuffle } from '@/hooks/use-book-covers';
import { setHomeBookshelfStats, useHomeBookshelfStats } from '@/hooks/use-home-bookshelf';
import { devProfiler$, useDevProfilerEnabled } from '@/lib/dev-profiler-flag';

/** Dev-build-only: lets local development iterate against mock data without a running backend, and
 *  shows which server real requests target. The Settings screen only links here when
 *  `PROFILING_ENABLED`; the route itself stays registered unconditionally, since a route that exists
 *  but is unreachable costs nothing while a conditional <Stack.Screen> would just be noise. */
export default function DeveloperSettingsScreen() {
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  const [apiBase] = useApiBase();
  const profilerOn = useDevProfilerEnabled();
  const shuffleCovers = useBookCoverShuffle();
  const shelfStats = useHomeBookshelfStats();

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
        {
          kind: 'toggle',
          label: 'Shuffle book covers',
          description:
            'Draws every series as a random kind of book — volume, issue, webtoon or CG set, bound on either side — the same one each time, so each style shows on real covers.',
          value: shuffleCovers,
          onChange: setBookCoverShuffle,
        },
        {
          kind: 'toggle',
          label: 'Bookshelf frame stats',
          description:
            'Shows over the home bookshelf how its frames are going — how many a second of those the display offered, the script and the GPU time each takes, and how many were skipped — and logs a line to Diagnostics each time the shelf has moved.',
          value: shelfStats,
          onChange: setHomeBookshelfStats,
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
