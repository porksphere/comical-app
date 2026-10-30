import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import type { MenuRowSpec, SubmenuSpec } from '@/components/context-menu-material';
import { CheckIcon, DownloadsIcon, LogInIcon, PlayIcon, PlusIcon, RetryIcon, StarIcon } from '@/components/icons/ui-icons';
import { seriesDetailQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { SeriesEntry } from '@/data/types';
import { useCollections } from '@/hooks/use-collections';
import { useFavorite } from '@/hooks/use-favorite';
import { useItemCollections } from '@/hooks/use-item-collections';
import { useResetReadProgress } from '@/hooks/use-reset-read-progress';
import { useSeriesDownloadAction } from '@/hooks/use-series-download-action';
import { useSeriesSave } from '@/hooks/use-series-save';
import { useStartReading } from '@/hooks/use-start-reading';
import { useRouter } from '@/lib/nav';

type CardMenuRowsProps = {
  bridgeId: string;
  bridge?: string;
  entry: SeriesEntry;
  direct?: boolean;
  children: (rows: MenuRowSpec[]) => ReactElement;
};

/** What a saved series is filed with, the same snapshot every card-menu write sends. */
function seriesSnapshot(entry: SeriesEntry) {
  return {
    seriesTitle: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
    ...(entry.cover && entry.coverAspect !== undefined ? { thumbnailAspect: entry.coverAspect } : {}),
  };
}

/**
 * The web card menu's rows: the native popup's (series-card-context-menu.tsx), in its order and
 * wording, for the generic menu host to draw. Mounted only while the menu is open, so its queries run
 * once per open rather than once per card in the grid.
 *
 * Two departures, both because there is no preview here: Save never expands in place (a saved
 * series opens the collection picker, which is what that submenu stands in for), and nothing hands
 * off a zoom, since web has no zoom entrance. The iOS system menu takes the submenu back
 * (`SeriesCardSystemMenuRows`), since a system submenu is native there.
 */
export function SeriesCardMenuRows({
  bridgeId,
  bridge,
  entry,
  direct,
  saveSubmenu,
  children,
}: CardMenuRowsProps & { saveSubmenu?: () => SubmenuSpec }) {
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
  const save = useSeriesSave(bridgeId, entry.id, () => seriesSnapshot(entry), entry.title, !!direct);
  const resetProgress = useResetReadProgress(bridgeId, entry.id, entry.title);
  const download = useSeriesDownloadAction(
    bridgeId,
    entry.id,
    !!direct,
    { title: entry.title, ...(entry.cover ? { cover: entry.cover } : {}) },
    true,
    !!entry.removed || detail.data?.removal !== undefined,
  );

  const rows: MenuRowSpec[] = [
    {
      label: reading.label,
      Icon: PlayIcon,
      symbol: 'play',
      primary: true,
      loading: false,
      testID: 'series.card-menu.read',
      onPress: reading.start,
    },
    {
      label: save.menuLabel,
      Icon: save.saved ? CheckIcon : PlusIcon,
      symbol: save.saved ? 'checkmark.circle' : 'plus',
      loading: save.saved === null,
      active: !!save.saved,
      testID: 'series.card-menu.save',
      ...(save.saved && saveSubmenu && { submenu: saveSubmenu }),
      onPress: () => void save.onPress(),
    },
    ...(favoriteStatus === 'login' && loginSettings
      ? [
          {
            label: 'Log in to favorite',
            Icon: LogInIcon,
            symbol: 'person.crop.circle',
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
              symbol: favorited ? 'star.fill' : 'star',
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
      symbol: 'arrow.down.circle',
      loading: download.loading,
      active: download.active,
      disabled: download.disabled,
      testID: 'series.card-menu.download',
      onPress: download.onPress,
    },
    {
      label: 'Reset read progress',
      Icon: RetryIcon,
      symbol: 'arrow.counterclockwise',
      loading: false,
      destructive: true,
      testID: 'series.card-menu.reset-progress',
      onPress: resetProgress,
    },
  ];
  return children(rows);
}

/**
 * The iOS system menu's rows (series-card-menu.ios.tsx): the web rows, with Save on a saved series
 * opening the native popup's collections submenu in place. Its checkmarks follow the memberships as
 * they toggle, and the menu stays up through them.
 */
export function SeriesCardSystemMenuRows(props: CardMenuRowsProps) {
  const { bridgeId, entry, direct } = props;
  const { collections } = useCollections();
  const { collectionIds, loading, setCollections, remove } = useItemCollections({
    kind: 'series',
    bridgeId,
    seriesId: entry.id,
    snapshot: () => seriesSnapshot(entry),
    direct: !!direct,
  });
  const saveSubmenu = (): SubmenuSpec => ({
    label: 'Save to collection',
    testID: 'series.card-menu.collections.submenu',
    rows: [
      ...collections.map((c) => ({
        label: c.name,
        active: collectionIds.includes(c.id),
        loading,
        onPress: () =>
          setCollections(
            collectionIds.includes(c.id) ? collectionIds.filter((x: string) => x !== c.id) : [...collectionIds, c.id],
          ),
        testID: `series.card-menu.collections.${c.id}`,
      })),
      {
        label: 'Remove from Library',
        loading,
        destructive: true,
        onPress: () => void remove(),
        testID: 'series.card-menu.collections.remove',
      },
    ],
  });
  return <SeriesCardMenuRows {...props} saveSubmenu={saveSubmenu} />;
}
