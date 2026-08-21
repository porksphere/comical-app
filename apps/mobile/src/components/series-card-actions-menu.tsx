import { View, StyleSheet } from 'react-native';

import { MenuActionRow, MenuHeader } from '@/components/context-menu';
import { CheckIcon, DownloadsIcon, PlusIcon, RetryIcon, StarIcon } from '@/components/icons/ui-icons';
import { OptionList, useOverlay } from '@/components/overlay/overlay';
import { Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { useFavorite } from '@/hooks/use-favorite';
import { useResetReadProgress } from '@/hooks/use-reset-read-progress';
import { useSeriesSave } from '@/hooks/use-series-save';
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
  const save = useSeriesSave(
    bridgeId,
    entry.id,
    () => ({ seriesTitle: entry.title, ...(entry.cover ? { thumbnailUrl: entry.cover } : {}) }),
    entry.title,
  );
  const resetProgress = useResetReadProgress(bridgeId, entry.id, entry.title);
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
        {/* ONE row where there were two — "Add to Library" and "Add to collection" became the same
            action when the library dissolved into collections. Unsaved: files into the last-used
            collection, and the label then names it. Saved: opens the picker. See useSeriesSave. */}
        <MenuActionRow
          testID="series.card-menu.save"
          label={save.label}
          Icon={save.saved ? CheckIcon : PlusIcon}
          loading={save.saved === null}
          active={!!save.saved}
          onPress={() => {
            // Close this overlay sheet FIRST — the picker is a root host that renders under the
            // overlay stack, so it must not overlap this menu. No stacking here; that's the native
            // long-press menu's job (series-card-context-menu.tsx).
            closeTop();
            void save.onPress();
          }}
        />
        <MenuActionRow
          testID="series.card-menu.reset-progress"
          label="Reset read progress"
          // RotateCcw — the same "put it back" glyph the retry rows use.
          Icon={RetryIcon}
          onPress={() => {
            closeTop();
            resetProgress();
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
