import type { ReactNode } from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';

import { CardMenuTrigger } from '@/components/card-menu-trigger';
import { openCollectionPicker } from '@/components/collection-picker';
import { ContextMenuHold, openContextMenu } from '@/components/context-menu-host';
import type { MenuRowSpec } from '@/components/context-menu-material';
import { SeriesItemIcon } from '@/components/icons/collection-icons';
import { CheckIcon, PlayIcon } from '@/components/icons/ui-icons';
import type { ApiCollectionItem } from '@/data/api';
import { useRouter } from '@/lib/nav';

/**
 * The menu on a saved CHAPTER or PAGE tile: the card's 3-dot button and right-click on web, a hold
 * on native. A saved series wears the series card's own menu instead (`SeriesCardMenu`); these two
 * can't, because every row of that one acts on a series — its save row would file the series rather
 * than the tile's item, and its preview lifts a cover neither of them has.
 */
export function CollectedItemMenu({
  item,
  onOpen,
  children,
}: {
  item: Extract<ApiCollectionItem, { type: 'chapter' | 'page' }>;
  /** What a tap on the tile does — the menu's leading row is the same action, spelled out. */
  onOpen: () => void;
  /** `menuOpen` is web's — see `CardMenuTrigger`. */
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void; menuOpen?: boolean }) => ReactNode;
}) {
  const router = useRouter();
  const pickerTitle = item.chapterName ? `${item.seriesTitle} — ${item.chapterName}` : item.seriesTitle;

  const rows: MenuRowSpec[] = [
    {
      label: item.type === 'chapter' ? 'Read chapter' : 'Open page',
      Icon: PlayIcon,
      primary: true,
      loading: false,
      testID: 'collected.tile-menu.open',
      onPress: onOpen,
    },
    {
      label: 'Go to series',
      Icon: SeriesItemIcon,
      loading: false,
      testID: 'collected.tile-menu.series',
      onPress: () =>
        router.push({
          pathname: '/series',
          params: { id: item.seriesId, bridgeId: item.bridgeId, title: item.seriesTitle },
        }),
    },
    {
      // Always "in": a tile only exists while its item is filed somewhere. Unticking the last
      // collection in the picker is how it is removed.
      label: 'In collections',
      Icon: CheckIcon,
      active: true,
      loading: false,
      testID: 'collected.tile-menu.collect',
      onPress: () =>
        openCollectionPicker(
          // The snapshot hands back what the item already stores: the picker re-files with it, and
          // a thinner one would drop fields the server keeps the item findable by.
          item.type === 'chapter'
            ? {
                kind: 'chapter',
                bridgeId: item.bridgeId,
                seriesId: item.seriesId,
                chapterId: item.chapterId,
                title: pickerTitle,
                snapshot: () => ({
                  seriesTitle: item.seriesTitle,
                  ...(item.chapterName !== undefined && { chapterName: item.chapterName }),
                  ...(item.number !== undefined && { number: item.number }),
                  ...(item.languageCode !== undefined && { languageCode: item.languageCode }),
                }),
              }
            : {
                kind: 'page',
                bridgeId: item.bridgeId,
                seriesId: item.seriesId,
                chapterId: item.chapterId,
                pageIndex: item.pageIndex,
                title: pickerTitle,
                snapshot: () => ({
                  seriesTitle: item.seriesTitle,
                  ...(item.chapterName !== undefined && { chapterName: item.chapterName }),
                  ...(item.pageCount !== undefined && { pageCount: item.pageCount }),
                  ...(item.sourceUrl !== undefined && { sourceUrl: item.sourceUrl }),
                  ...(item.contentHash !== undefined && { contentHash: item.contentHash }),
                }),
              },
        ),
    },
  ];

  if (Platform.OS === 'web') {
    return (
      <CardMenuTrigger testID="collected.tile-menu.trigger" label="Item actions" rows={rows}>
        {(menuOpen) => children({ menuOpen })}
      </CardMenuTrigger>
    );
  }
  return (
    <ContextMenuHold onOpen={(pt) => openContextMenu({ x: pt.x, y: pt.y, rows })}>{children}</ContextMenuHold>
  );
}
