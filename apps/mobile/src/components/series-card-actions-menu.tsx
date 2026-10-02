import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import type { MenuRowSpec } from '@/components/context-menu-material';
import { CheckIcon, DownloadsIcon, LogInIcon, PlayIcon, PlusIcon, RetryIcon, StarIcon } from '@/components/icons/ui-icons';
import { seriesDetailQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { SeriesEntry } from '@/data/types';
import { useFavorite } from '@/hooks/use-favorite';
import { useResetReadProgress } from '@/hooks/use-reset-read-progress';
import { useSeriesDownloadAction } from '@/hooks/use-series-download-action';
import { useSeriesSave } from '@/hooks/use-series-save';
import { useStartReading } from '@/hooks/use-start-reading';
import { useRouter } from '@/lib/nav';

/**
 * The web card menu's rows: the native popup's (series-card-context-menu.tsx), in its order and
 * wording, for the generic menu host to draw. Mounted only while the menu is open, so its queries run
 * once per open rather than once per card in the grid.
 *
 * Two departures, both because there is no preview here: Save never expands in place (a saved
 * series opens the collection picker, which is what that submenu stands in for), and nothing hands
 * off a zoom, since web has no zoom entrance.
 */
export function SeriesCardMenuRows({
  bridgeId,
  bridge,
  entry,
  direct,
  children,
}: {
  bridgeId: string;
  bridge?: string;
  entry: SeriesEntry;
  direct?: boolean;
  children: (rows: MenuRowSpec[]) => ReactElement;
}) {
  const router = useRouter();
  const ds = useDataSource();
  const mock = useMockActive();
  const detail = useQuery(
    seriesDetailQuery(ds, mock, bridgeId, entry.id, { direct: !!direct, title: entry.title, cover: entry.cover }),
  );
  const reading = useStartReading({
    bridgeId,
    seriesId: entry.id,
    title: entry.title,
    direct: !!direct,
    readLabel: detail.data?.readLabel,
    ...(bridge ? { bridge } : {}),
    ...(entry.cover ? { cover: entry.cover } : {}),
  });
  const { favorited, toggle: toggleFavorite, status: favoriteStatus, loginSettings } = useFavorite(bridgeId, entry.id);
  const save = useSeriesSave(
    bridgeId,
    entry.id,
    () => ({ seriesTitle: entry.title, ...(entry.cover ? { thumbnailUrl: entry.cover } : {}) }),
    entry.title,
  );
  const resetProgress = useResetReadProgress(bridgeId, entry.id, entry.title);
  const download = useSeriesDownloadAction(
    bridgeId,
    entry.id,
    !!direct,
    { title: entry.title, ...(entry.cover ? { cover: entry.cover } : {}) },
    true,
  );

  const rows: MenuRowSpec[] = [
    {
      label: reading.label,
      Icon: PlayIcon,
      primary: true,
      loading: false,
      testID: 'series.card-menu.read',
      onPress: reading.start,
    },
    {
      label: save.menuLabel,
      Icon: save.saved ? CheckIcon : PlusIcon,
      loading: save.saved === null,
      active: !!save.saved,
      testID: 'series.card-menu.save',
      onPress: () => void save.onPress(),
    },
    ...(favoriteStatus === 'login' && loginSettings
      ? [
          {
            label: 'Log in to favorite',
            Icon: LogInIcon,
            loading: false,
            testID: 'series.card-menu.favorite',
            onPress: () => router.push({ pathname: '/bridge-settings', params: loginSettings }),
          } satisfies MenuRowSpec,
        ]
      : favoriteStatus !== 'unsupported'
        ? [
            {
              label: favorited ? 'Unfavorite' : 'Favorite',
              Icon: StarIcon,
              iconFilled: !!favorited,
              loading: favoriteStatus !== 'ready',
              active: !!favorited,
              testID: 'series.card-menu.favorite',
              onPress: toggleFavorite,
            } satisfies MenuRowSpec,
          ]
        : []),
    {
      label: download.label,
      Icon: DownloadsIcon,
      loading: download.loading,
      active: download.active,
      testID: 'series.card-menu.download',
      onPress: download.onPress,
    },
    {
      label: 'Reset read progress',
      Icon: RetryIcon,
      loading: false,
      testID: 'series.card-menu.reset-progress',
      onPress: resetProgress,
    },
  ];
  return children(rows);
}
