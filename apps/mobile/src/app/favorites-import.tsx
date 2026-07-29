/**
 * "Import favorites" — the pushed screen that picks which of a bridge account's favorited series get
 * added to the library. Opened from that bridge's settings row; nothing lands in the library without
 * passing through here first.
 *
 * It's a normal multi-select screen (the same chrome as the Downloads pages — `useMultiSelect` +
 * `SelectLead` circles + the floating `SelectPillBar`), not a popup, with select mode PERMANENTLY on:
 * choosing is the screen's entire purpose, so there's nothing to toggle into and the back button is
 * the way out. That also means the standard gestures come for free — long-press range-fill, the
 * check-rail drag sweep, and the "…" staging menu.
 *
 * The host classifies each favorite for us (see `getFavoritesImportPreview`) into three kinds, and
 * the default selection follows from that:
 *   - `new` — not in the library at all → CHECKED.
 *   - `duplicate` — the same title is already in the library from ANOTHER bridge → UNCHECKED. Left
 *     alone you keep one entry; checking it imports this bridge as a SECOND SOURCE for that series
 *     and records the link (`linkTo`), so the two are known to be the same work.
 *   - `in-library` — already here from this same bridge → inert (a muted, settled check), nothing
 *     to do.
 * Erring toward unchecked on a duplicate is deliberate: a title match is a strong hint, not proof,
 * and one extra library card is a worse outcome than one series the user adds themselves.
 *
 * Row ORDER matters mechanically, not just visually: the actionable rows come first and the inert
 * `in-library` ones sink to the bottom, so the selectable keys line up one-to-one with the list's
 * leading indices — which is what lets `useDragSelect`'s index math (fixed row height, no
 * measurement) work on a list that isn't uniformly selectable.
 */
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Holdable } from '@/components/context-menu';
import { CheckIcon, ClearIcon, ListPlusIcon, StarIcon } from '@/components/icons/ui-icons';
import { PILL_HEIGHT, SelectLead, SelectPillBar, useDragSelect, useSelectMode } from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { SettingsRow } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, SettingsGutter, SettingsRowHeight, Spacing } from '@/constants/theme';
import type { FavoritesImportCandidate, FavoritesImportItem } from '@/data/api';
import { favoritesImportPreviewQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { hapticSelection } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';

/** Cover width in a row. Its 2:3 crop is 45px tall, which clears a 64px settings row's padding. */
const THUMB_W = 30;

export default function FavoritesImportScreen() {
  const params = useLocalSearchParams<{ bridgeId?: string; bridgeName?: string }>();
  const bridgeId = params.bridgeId ?? '';
  const bridgeName = params.bridgeName ?? 'this bridge';

  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { paddingTop } = useSettingsScrollPadding();
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const { nameOf } = useBridgeMap();

  // Full-width scroller centered within the settings column (same treatment as the Downloads pages).
  const sidePad = SettingsGutter + Math.max(0, (width - MaxContentWidth) / 2);

  const { data, error, isLoading, refetch, isFetching } = useQuery(favoritesImportPreviewQuery(ds, mock, bridgeId));

  // Actionable rows first, the inert `in-library` ones last — see the module docstring for why this
  // ordering is load-bearing for drag-select.
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    return [...items.filter((i) => i.status !== 'in-library'), ...items.filter((i) => i.status === 'in-library')];
  }, [data]);
  const allKeys = useMemo(() => rows.filter((i) => i.status !== 'in-library').map((i) => i.seriesId), [rows]);
  const newKeys = useMemo(() => rows.filter((i) => i.status === 'new').map((i) => i.seriesId), [rows]);

  // Select mode is on from the first frame and never turns off (there's no `SelectToggle` here).
  const mode = useSelectMode(true);
  const ms = useMultiSelect(allKeys);
  const listExtra = useMemo(() => ({ selected: ms.selected }), [ms.selected]);

  // Seed ONCE per resolved preview: the `new` rows checked, duplicates left for the user to opt into.
  // Keyed on the items array identity so a refetch that returns a new list re-seeds, but a re-render
  // (or the user unchecking everything) never resurrects the default.
  const seededRef = useRef<FavoritesImportCandidate[] | null>(null);
  useEffect(() => {
    if (!data || seededRef.current === data.items) return;
    seededRef.current = data.items;
    ms.selectOnly(newKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // iOS-style circle drag-select (sweep the check rail; auto-scrolls near the edges).
  const listRef = useRef<LegendListRef>(null);
  const scrollYRef = useRef(0);
  const dragSelect = useDragSelect({
    keys: allKeys,
    selected: ms.selected,
    selectSet: ms.selectSet,
    rowHeight: SettingsRowHeight,
    scrollRef: listRef,
    scrollYRef,
    selecting: true,
  });

  const [importError, setImportError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: () => {
      const chosen: FavoritesImportItem[] = rows
        .filter((i) => ms.selected.has(i.seriesId))
        .map((i) => ({
          seriesId: i.seriesId,
          title: i.title,
          ...(i.thumbnailUrl !== undefined && { thumbnailUrl: i.thumbnailUrl }),
          // A checked duplicate is the user saying "same work" — link it to the entry that's already
          // here. The first match wins; a title matching several entries is rare enough that picking
          // among them isn't worth a second decision on this screen.
          ...(i.status === 'duplicate' && i.matches?.[0] && { linkTo: i.matches[0].key }),
        }));
      return ds.importBridgeFavorites(bridgeId, chosen);
    },
    onSuccess: (result) => {
      // Only library-side state moved — no bridge content changed, so this stays targeted rather
      // than a blanket invalidate.
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraryLists(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoritesImportPreview(mock, bridgeId) });
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'inLibrary' });

      const linked = result.linked > 0 ? ` (${result.linked} linked as another source)` : '';
      showToast(result.imported === 0 ? 'Nothing to import' : `${result.imported} series imported${linked}`);
      router.back();
    },
    onError: (e) => setImportError(friendlyError(e, 'Could not import favorites')),
  });

  const runImport = () => {
    if (importMutation.isPending || ms.count === 0) return;
    setImportError(null);
    importMutation.mutate();
  };

  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('favorites-import.menu', 'all'),
    },
    {
      // The screen's own default, restorable after any amount of fiddling: the not-here-at-all
      // favorites, without the cross-bridge duplicates.
      label: 'Select new only',
      Icon: StarIcon,
      loading: false,
      disabled: newKeys.length === 0,
      onPress: () => ms.selectOnly(newKeys),
      testID: testId('favorites-import.menu', 'new'),
    },
  ];

  const renderItem = ({ item, index }: { item: FavoritesImportCandidate; index: number }) => {
    const inLibrary = item.status === 'in-library';
    const sub = inLibrary
      ? 'Already in library'
      : item.status === 'duplicate'
        ? `Also in library via ${[...new Set(item.matches?.map((m) => nameOf(m.bridgeId)) ?? [])].join(', ')}`
        : undefined;
    return (
      <View>
        <Holdable
          enabled={!inLibrary}
          onHold={() => {
            hapticSelection();
            ms.rangeFill(item.seriesId);
          }}>
          {({ onLongPress }) => (
            <SettingsRow
              testID={`favorites-import.row.${item.seriesId}`}
              label={item.title}
              {...(sub ? { description: sub } : {})}
              {...(item.status === 'duplicate' ? { descriptionColor: theme.accent } : {})}
              leading={
                <>
                  <SelectLead
                    progress={mode.progress}
                    selected={ms.selected.has(item.seriesId)}
                    done={inLibrary}
                    itemKey={item.seriesId}
                    edgeOffset={sidePad}
                    {...(inLibrary ? {} : { gesture: dragSelect.gestureFor(index) })}
                  />
                  <Cover url={item.thumbnailUrl} />
                </>
              }
              // Suppress the chevron a pressable row would otherwise grow — nothing opens from here.
              right={<View />}
              {...(inLibrary ? {} : { onPress: () => ms.toggle(item.seriesId), onLongPress })}
            />
          )}
        </Holdable>
        {index < rows.length - 1 && (
          <View pointerEvents="none" style={[styles.divider, { backgroundColor: theme.hairline }]} />
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title={importMutation.isPending ? 'Importing…' : ms.count > 0 ? `${ms.count} selected` : 'Import favorites'} />

      {importError && (
        <ThemedText type="small" style={[styles.banner, { color: theme.danger, paddingHorizontal: sidePad }]}>
          {importError}
        </ThemedText>
      )}

      <LegendList
        ref={listRef}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        style={styles.list}
        data={rows}
        keyExtractor={(i) => i.seriesId}
        recycleItems
        estimatedItemSize={SettingsRowHeight}
        getFixedItemSize={() => SettingsRowHeight}
        maintainVisibleContentPosition={{ data: false, size: false }}
        // Selection lives outside the row objects (they're the query's own candidates); this tells
        // the list to repaint visible rows when the selection set changes.
        extraData={listExtra}
        renderItem={renderItem}
        ListHeaderComponent={
          rows.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
              {`Favorites on ${bridgeName}. Series already in your library from another source are left unchecked — check one to add it as a second source for that series.`}
            </ThemedText>
          ) : null
        }
        ListFooterComponent={
          data?.truncated ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
              Showing the first {rows.length} — this account has more favorites than one import can walk.
            </ThemedText>
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.state}>
              <ActivityIndicator size="small" />
              <ThemedText type="small" themeColor="textSecondary">
                Loading favorites…
              </ThemedText>
            </View>
          ) : error ? (
            <View style={styles.state}>
              {/* A bridge with no credentials throws its own actionable message ("favorites require
                  a username + password…") — surface it verbatim, since the fields it names are on
                  the very screen this one was pushed from. */}
              <ThemedText type="small" style={[styles.stateText, { color: theme.danger }]}>
                {friendlyError(error, 'Could not load favorites')}
              </ThemedText>
              <Pressable testID="favorites-import.retry" onPress={() => void refetch()} hitSlop={8} accessibilityRole="button">
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {isFetching ? 'Retrying…' : 'Retry'}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.state}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stateText}>
                This account has no favorites on {bridgeName}.
              </ThemedText>
            </View>
          )
        }
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop,
          paddingLeft: sidePad,
          paddingRight: sidePad,
          // Room for the floating pills, so the last rows can scroll clear of them.
          paddingBottom: PILL_HEIGHT + Spacing.six,
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />

      {/* The floating select-mode chrome: staging "…" bottom-left, the lone Import verb bottom-right
          (a solid accent circle, since it's the only verb this screen has). */}
      <SelectPillBar
        left={sidePad}
        right={sidePad}
        bottom={Math.max(insets.bottom, Spacing.three)}
        options={stagingRows}
        optionsTestID="favorites-import.select-options"
        verbs={
          ms.count > 0
            ? [
                {
                  key: 'import',
                  label: `Import ${ms.count} series`,
                  Icon: ListPlusIcon,
                  color: theme.accent,
                  onPress: runImport,
                  testID: 'favorites-import.confirm',
                },
              ]
            : []
        }
      />
    </ThemedView>
  );
}

/** The row's cover. Split out so `useResolvedAsset` (a hook) runs per row, not in `renderItem`. */
function Cover({ url }: { url?: string }) {
  const theme = useTheme();
  const thumb = useResolvedAsset(url);
  if (!thumb) return <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]} />;
  return <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  banner: {
    paddingTop: Spacing.two,
  },
  intro: {
    paddingBottom: Spacing.four,
  },
  thumb: {
    width: THUMB_W,
    aspectRatio: 2 / 3,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  // The settings-standard inset divider (see the Downloads page): absolute so rows stay exactly one
  // settings-row tall for the fixed-size list.
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: -SettingsGutter,
    height: StyleSheet.hairlineWidth,
  },
  state: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.five,
  },
  stateText: {
    textAlign: 'center',
  },
  footerNote: {
    paddingTop: Spacing.four,
    textAlign: 'center',
  },
});
