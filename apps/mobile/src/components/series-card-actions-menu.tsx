import { View, StyleSheet } from 'react-native';

import { MenuActionRow, MenuHeader } from '@/components/context-menu';
import { CheckIcon, DownloadsIcon, ListPlusIcon, PlusIcon, StarIcon } from '@/components/icons/ui-icons';
import { openListPicker } from '@/components/list-picker';
import { OptionList, useOverlay } from '@/components/overlay/overlay';
import { Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { useFavorite } from '@/hooks/use-favorite';
import { useLibrary } from '@/hooks/use-library';
import { useSeriesDownloadAction } from '@/hooks/use-series-download-action';

/**
 * The per-series quick-actions menu content, shared by the native long-press menu and the web 3-dot
 * menu. It's rendered inside the app overlay (a bottom sheet on phones, an anchored popover on
 * desktop-web) and mounted ONLY while the menu is open — so the two status queries (`useFavorite` /
 * `useLibrary`) run once, on open, instead of once per card. That's what lets the grid drop the
 * per-card native context-menu host (the iOS scroll tax) without losing the actions or the
 * full-title / cover reveal that the old iOS lifted preview provided.
 *
 * Chrome comes from the shared context-menu module (`MenuHeader` + `MenuActionRow`), which every
 * other long-press menu (e.g. the chapter rows') renders with too.
 */
export function SeriesActionsMenu({
  bridgeId,
  entry,
  direct,
  coverAspect,
}: {
  bridgeId: string;
  entry: SeriesEntry;
  /** Whether the bridge serves a direct (page-thumbnail) series — affects how a download is enqueued. */
  direct?: boolean;
  coverAspect?: number;
}) {
  const { closeTop } = useOverlay();
  const { favorited, toggle: toggleFavorite, available: favoritesAvailable } = useFavorite(bridgeId, entry.id);
  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, entry.id, () => ({
    title: entry.title,
    ...(entry.cover ? { thumbnailUrl: entry.cover } : {}),
  }));
  // Lazy — this menu is mounted only while open, so the download-status query runs once, on open.
  const download = useSeriesDownloadAction(
    bridgeId,
    entry.id,
    !!direct,
    { title: entry.title, ...(entry.cover ? { cover: entry.cover } : {}) },
    true,
  );
  return (
    <View style={styles.menu}>
      <MenuHeader title={entry.title} {...(entry.cover !== undefined && { cover: entry.cover })} {...(coverAspect !== undefined && { coverAspect })} />
      <OptionList>
        <MenuActionRow
          testID="series.card-menu.download"
          label={download.label}
          Icon={DownloadsIcon}
          loading={download.loading}
          active={download.active}
          onPress={() => {
            // Close FIRST: onPress may push the download sheet, and closing after would pop it.
            closeTop();
            download.onPress();
          }}
        />
        <MenuActionRow
          testID="series.card-menu.library"
          label={inLibrary ? 'Remove from Library' : 'Add to Library'}
          Icon={inLibrary ? CheckIcon : PlusIcon}
          loading={inLibrary === null}
          active={!!inLibrary}
          onPress={() => {
            toggleLibrary();
            closeTop();
          }}
        />
        <MenuActionRow
          testID="series.card-menu.lists"
          label="Add to list"
          Icon={ListPlusIcon}
          // Close this overlay sheet first, THEN open the picker (a root host that renders under the
          // overlay stack, so it must not overlap this menu). No stacking here — that's the native
          // long-press menu's job (series-card-context-menu.tsx).
          onPress={() => {
            closeTop();
            openListPicker({
              bridgeId,
              seriesId: entry.id,
              title: entry.title,
              snapshot: () => ({ title: entry.title, ...(entry.cover ? { thumbnailUrl: entry.cover } : {}) }),
            });
          }}
        />
        <MenuActionRow
          testID="series.card-menu.favorite"
          label={favorited ? 'Unfavorite' : 'Favorite'}
          Icon={StarIcon}
          loading={favorited === null}
          // Greyed + inert when this bridge's favorites need a login that isn't set (see useFavorite).
          disabled={!favoritesAvailable}
          active={!!favorited}
          onPress={() => {
            toggleFavorite();
            closeTop();
          }}
        />
      </OptionList>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    gap: Spacing.three,
  },
});
