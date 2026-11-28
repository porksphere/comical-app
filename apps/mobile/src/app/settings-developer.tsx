import { StyleSheet } from 'react-native';

import { select, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { useApiBase } from '@/data/api';
import { useMockDataToggle } from '@/data/source';
import { setBookCoverShuffle, useBookCoverShuffle } from '@/hooks/use-book-covers';
import {
  setHomeBookshelfStats,
  setHomeHeroStyle,
  setSeriesStickerRead,
  useHomeBookshelfStats,
  useHomeHeroStyle,
  useSeriesStickerRead,
  type HomeHeroStyle,
} from '@/hooks/use-home-bookshelf';
import {
  setSearchBarTrial,
  setSearchTitleTrial,
  useSearchBarTrial,
  useSearchTitleTrial,
  type SearchBarTrial,
  type SearchTitleTrial,
} from '@/hooks/use-search-bar-trial';
import { devProfiler$, useDevProfilerEnabled } from '@/lib/dev-profiler-flag';

const HERO_STYLES = [
  { value: 'shelf', label: '3D bookshelf' },
  { value: 'splash', label: 'Cover splash' },
  { value: 'poster', label: 'Poster' },
] as const;

const SEARCH_BARS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'hides', label: 'Hides' },
  { value: 'titled', label: 'Stays, titled' },
  { value: 'kept', label: 'Stays, buttons only' },
] as const;

const SEARCH_TITLES = [
  { value: 'inline', label: 'In the bar' },
  { value: 'always', label: 'Under the bar' },
] as const;

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
  const stickerRead = useSeriesStickerRead();
  const heroStyle = useHomeHeroStyle();
  const searchBar = useSearchBarTrial();
  const searchTitle = useSearchTitleTrial();

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
        select<HomeHeroStyle>({
          label: 'Home opens on',
          description:
            'A trial. What Comical Home shows of what you are reading, where Settings → General has the bookshelf on: the 3D shelf, the front series’ cover across the top of the page, or its cover whole over its own colours.',
          value: heroStyle,
          options: HERO_STYLES,
          onChange: setHomeHeroStyle,
          testID: 'settings.developer.home-hero',
        }),
        select<SearchBarTrial>({
          label: 'Search tab bar while searching',
          description:
            'A trial, iOS only. What the Search tab’s bar does while its field is in use: goes where its buttons stand in a side column and stays, titled, where it runs along the top; goes everywhere, as the App Store’s does; stays with a small “Search” in it; or stays with only its buttons.',
          value: searchBar,
          options: SEARCH_BARS,
          onChange: setSearchBarTrial,
          testID: 'settings.developer.search-bar',
        }),
        select<SearchTitleTrial>({
          label: 'Search tab title',
          description:
            'A trial, iOS only. Where the Search tab’s large title stands: on the bar’s own row beside its buttons, as every other tab’s does, or on a row of its own under them that shrinks into the bar as you scroll.',
          value: searchTitle,
          options: SEARCH_TITLES,
          onChange: setSearchTitleTrial,
          testID: 'settings.developer.search-title',
        }),
        {
          kind: 'toggle',
          label: 'Bookshelf frame stats',
          description:
            'Shows over the home bookshelf how its frames are going — how many a second of those the display offered, the script and the GPU time each takes, and how many were skipped — and logs a line to Diagnostics each time the shelf has moved.',
          value: shelfStats,
          onChange: setHomeBookshelfStats,
        },
        {
          kind: 'toggle',
          label: 'Series page: Read as a sticker',
          description:
            'A trial. On a phone, the series page reads from the home bookshelf’s sticker, hung on the cover’s corner with the new-chapter burst on the other, in place of the Read capsule.',
          value: stickerRead,
          onChange: setSeriesStickerRead,
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
