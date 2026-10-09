/**
 * "Import list" — the pushed screen that brings a tracker's list (AniList, MAL…) into the library.
 * Opened from that tracker's settings page. The same multi-select screen as the bridge favorites
 * import (`favorites-import.tsx`): select mode permanently on, the check rail, the "…" staging menu,
 * one Import verb — plus two things a tracker list needs that a favorites list doesn't:
 *
 *   - A tracker entry isn't a bridge series. The host matches what it can against the library
 *     (`in-library`, `linked`); anything else has to be FOUND on a bridge first — the "Find on…" row
 *     runs one bridge's search over every unresolved entry, batched so a long list shows progress
 *     and can be cancelled, and a row with several possible matches is tapped to pick one.
 *   - Sync is push-only. Importing never writes the tracker's progress into a series that is already
 *     here; it links it, and pushes if the library is further ahead. A series that ISN'T here yet is
 *     the one case the tracker may seed — the toggle above the list, default on.
 *
 * Row order is load-bearing (see `planRows`): the selectable rows are the list's leading indices,
 * which is what the check-rail drag sweep's index math needs. The header above them is fine — the
 * sweep measures from the row the drag started on.
 */
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Holdable } from '@/components/context-menu';
import { openContextMenu } from '@/components/context-menu-host';
import type { MenuRowSpec } from '@/components/context-menu-material';
import { BridgesIcon, CheckIcon, ClearIcon, ListPlusIcon, ReadingIcon, SearchIcon } from '@/components/icons/ui-icons';
import { ImportCover, importStyles as styles } from '@/components/import/import-list';
import { PILL_HEIGHT, SelectLead, SelectPillBar, useDragSelect, useSelectMode } from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { RowIcon } from '@/components/settings/row-icon';
import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsRow } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { SettingsRowHeight, Spacing } from '@/constants/theme';
import { TRACKER_IMPORT_BATCH, type TrackerImportResult } from '@/data/api';
import { resolveDefaultCollection } from '@/data/default-collection';
import { getDefaultCollectionId, setDefaultCollectionId } from '@/data/default-collection-store';
import { collectionsQuery, queryKeys, trackerImportPreviewQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useSettingsScrollPadding, useSettingsSidePad } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { hapticSelection } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';
import { scrollbarInset } from '@/lib/scrollbar-inset';
import { testId } from '@/lib/test-id';
import {
  chunk,
  importSummary,
  itemsForImport,
  mergeResolutions,
  planRows,
  readingKeys,
  rowDescription,
  selectableKeys,
  sumImportResults,
  unresolvedEntries,
  type ImportRow,
  type Resolution,
} from '@/lib/tracker-import';

type Progress = { done: number; total: number };

export default function TrackerImportScreen() {
  const params = useLocalSearchParams<{ trackerId?: string; trackerName?: string }>();
  const trackerId = params.trackerId ?? '';
  const trackerName = params.trackerName ?? 'this tracker';

  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { paddingTop } = useSettingsScrollPadding();
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const { byId, nameOf } = useBridgeMap();

  const sidePad = useSettingsSidePad(width);

  const { data, error, isLoading, refetch, isFetching } = useQuery(trackerImportPreviewQuery(ds, mock, trackerId));

  // The screen's own facts on top of the host's classification: what a bridge search found per
  // entry, and whether new series get their progress seeded.
  const [resolutions, setResolutions] = useState<ReadonlyMap<string, Resolution>>(() => new Map());
  const [seed, setSeed] = useState(true);

  const rows = useMemo(() => planRows(data?.items ?? [], resolutions), [data, resolutions]);
  const allKeys = useMemo(() => selectableKeys(rows), [rows]);
  const reading = useMemo(() => readingKeys(rows), [rows]);
  const pending = useMemo(() => unresolvedEntries(rows), [rows]);

  const mode = useSelectMode(true);
  const ms = useMultiSelect(allKeys);
  const listExtra = useMemo(() => ({ selected: ms.selected, resolutions, seed }), [ms.selected, resolutions, seed]);

  // Seed ONCE per resolved preview: everything actionable checked. Keyed on the items array identity
  // so a refetch re-seeds but the user unchecking everything is never undone by a re-render.
  const seededRef = useRef<unknown>(null);
  useEffect(() => {
    if (!data || seededRef.current === data.items) return;
    seededRef.current = data.items;
    ms.selectOnly(allKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // The live selection, for the async loops below: a search that lands while the user is toggling
  // rows must add its finds to what's checked NOW, not to the closure it started from.
  const selectedRef = useRef(ms.selected);
  useEffect(() => {
    selectedRef.current = ms.selected;
  }, [ms.selected]);

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

  const [banner, setBanner] = useState<string | null>(null);

  // ── Find on a bridge ────────────────────────────────────────────────────────────────────────────
  const [resolving, setResolving] = useState<(Progress & { bridgeId: string }) | null>(null);
  const resolveAbort = useRef<AbortController | null>(null);
  useEffect(() => () => resolveAbort.current?.abort(), []);

  const resolveOn = async (bridgeId: string) => {
    if (resolving || pending.length === 0) return;
    const ac = new AbortController();
    resolveAbort.current = ac;
    setBanner(null);
    setResolving({ bridgeId, done: 0, total: pending.length });
    try {
      for (const batch of chunk(pending, TRACKER_IMPORT_BATCH)) {
        const results = await ds.resolveTrackerImport(trackerId, bridgeId, batch, ac.signal);
        if (ac.signal.aborted) return;
        setResolutions((prev) => mergeResolutions(prev, bridgeId, results));
        // A fresh exact hit is what the user asked for — check it, as the preview's defaults were.
        const hits = results.filter((r) => r.exact).map((r) => String(r.externalId));
        if (hits.length > 0) ms.selectSet(new Set([...selectedRef.current, ...hits]));
        setResolving((p) => (p ? { ...p, done: p.done + batch.length } : p));
      }
    } catch (e) {
      if (!ac.signal.aborted) setBanner(friendlyError(e, `Could not search ${nameOf(bridgeId)}`));
    } finally {
      if (resolveAbort.current === ac) resolveAbort.current = null;
      setResolving(null);
    }
  };

  const cancelResolve = () => resolveAbort.current?.abort();

  // Every configured bridge that can search, as a menu hanging from the "Find on…" row.
  const findRowRef = useRef<View>(null);
  const openFindMenu = () => {
    const bridges = [...byId.values()].filter((b) => b.capabilities.includes('search'));
    const menuRows: MenuRowSpec[] = bridges.map((b) => ({
      label: b.name,
      Icon: BridgesIcon,
      loading: false,
      onPress: () => void resolveOn(b.id),
      testID: testId('tracker-import.find', b.id),
    }));
    if (menuRows.length === 0) {
      setBanner('No bridge can search — add one first.');
      return;
    }
    findRowRef.current?.measureInWindow((x, y, w) =>
      openContextMenu({ title: `Find ${pending.length} on…`, rows: menuRows, x: x + w / 2, y }),
    );
  };

  // A row with several possible matches: the user picks which one it is.
  const openCandidatePicker = (row: ImportRow, x: number, y: number) => {
    const res = row.resolution;
    if (!res || res.candidates.length === 0) return;
    openContextMenu({
      title: row.item.title,
      rows: res.candidates.map((c) => ({
        label: c.title,
        Icon: SearchIcon,
        loading: false,
        onPress: () => {
          setResolutions((prev) => new Map(prev).set(row.key, { ...res, chosen: c }));
          ms.selectSet(new Set([...selectedRef.current, row.key]));
        },
        testID: testId('tracker-import.candidate', row.key, c.id),
      })),
      x,
      y,
    });
  };

  // ── Import ──────────────────────────────────────────────────────────────────────────────────────
  const [importing, setImporting] = useState<Progress | null>(null);
  const importAbort = useRef<AbortController | null>(null);
  useEffect(() => () => importAbort.current?.abort(), []);

  const runImport = async () => {
    if (importing || resolving) return;
    const items = itemsForImport(rows, ms.selected);
    if (items.length === 0) return;
    const ac = new AbortController();
    importAbort.current = ac;
    setBanner(null);
    setImporting({ done: 0, total: items.length });
    try {
      // New series are filed where a single Save would put them, so an import never leaves a pile
      // of unfiled series behind.
      const collectionId = await resolveDefaultCollection(
        {
          list: () => queryClient.fetchQuery(collectionsQuery(ds, mock)),
          create: (name) => ds.createCollection(name),
          rename: (id, name) => ds.renameCollection(id, name),
          storedId: getDefaultCollectionId,
          remember: setDefaultCollectionId,
        },
        ac.signal,
      );
      const results: TrackerImportResult[] = [];
      for (const batch of chunk(items, TRACKER_IMPORT_BATCH)) {
        results.push(await ds.importTrackerEntries(trackerId, batch, { collectionIds: [collectionId], seedProgress: seed }, ac.signal));
        if (ac.signal.aborted) return;
        setImporting((p) => (p ? { ...p, done: p.done + batch.length } : p));
      }
      const total = sumImportResults(results);
      // Library-side state moved (new series, links, read marks, history) — no bridge content did.
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.collectionItemsAll(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.history(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trackerImportPreview(mock, trackerId) });
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'inLibrary' || q.queryKey[0] === 'chapterProgress' || q.queryKey[0] === 'trackerLinks',
      });
      showToast(importSummary(total));
      if (total.failed.length > 0 && total.failed.length === items.length) {
        setBanner(`Nothing imported: ${total.failed[0]?.error ?? 'unknown error'}`);
        return;
      }
      router.back();
    } catch (e) {
      if (!ac.signal.aborted) setBanner(friendlyError(e, 'Could not import'));
    } finally {
      if (importAbort.current === ac) importAbort.current = null;
      setImporting(null);
    }
  };

  // ── Chrome ──────────────────────────────────────────────────────────────────────────────────────
  const selectedCount = allKeys.filter((k) => ms.selected.has(k)).length;
  const allSelected = allKeys.length > 0 && selectedCount === allKeys.length;
  const stagingRows: MenuRowSpec[] = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('tracker-import.menu', 'all'),
    },
    {
      label: 'Reading only',
      Icon: ReadingIcon,
      loading: false,
      disabled: reading.length === 0,
      onPress: () => ms.selectOnly(reading),
      testID: testId('tracker-import.menu', 'reading'),
    },
  ];

  const title = importing
    ? `Importing ${Math.min(importing.done + 1, importing.total)} of ${importing.total}…`
    : selectedCount > 0
      ? `${selectedCount} selected`
      : 'Import list';

  const findDescription = resolving
    ? `Searching ${nameOf(resolving.bridgeId)} — ${resolving.done} of ${resolving.total}`
    : pending.length === 0
      ? 'Everything is matched'
      : `${pending.length} not in your library yet — search a bridge for them`;

  const header =
    rows.length > 0 ? (
      <View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
          {`Your ${trackerName} list. Series already in your library keep their progress; the tracker is updated if you're further ahead.`}
        </ThemedText>
        <SettingsToggleRow
          label="Mark chapters read"
          description="New series only, up to the tracker's progress"
          value={seed}
          onChange={setSeed}
        />
        <View ref={findRowRef} collapsable={false}>
          <SettingsRow
            testID="tracker-import.find"
            label={resolving ? 'Searching…' : 'Find on…'}
            description={findDescription}
            leading={<RowIcon fallback={(color, size) => <SearchIcon color={color} size={size} />} />}
            {...(resolving
              ? {
                  right: (
                    <Pressable testID="tracker-import.cancel-find" onPress={cancelResolve} hitSlop={8} accessibilityRole="button">
                      <ThemedText type="smallBold" style={{ color: theme.accent }}>
                        Cancel
                      </ThemedText>
                    </Pressable>
                  ),
                }
              : pending.length === 0
                ? { right: <View /> }
                : { onPress: openFindMenu })}
          />
        </View>
        <View pointerEvents="none" style={[styles.divider, { backgroundColor: theme.hairline }]} />
      </View>
    ) : null;

  const renderItem = ({ item: row, index }: { item: ImportRow; index: number }) => {
    const selectable = row.kind === 'in-library' || row.kind === 'resolved';
    const pickable = row.kind === 'unresolved' && (row.resolution?.candidates.length ?? 0) > 0;
    return (
      <RowAnchor divider={index < rows.length - 1}>
        {(measure) => (
          <Holdable
            enabled={selectable}
            onHold={() => {
              hapticSelection();
              ms.rangeFill(row.key);
            }}>
            {({ onLongPress }) => (
              <SettingsRow
                testID={`tracker-import.row.${row.key}`}
                label={row.item.title}
                description={rowDescription(row, { seed, nameOf })}
                {...(pickable ? { descriptionColor: theme.accent } : {})}
                leading={
                  <>
                    <SelectLead
                      progress={mode.progress}
                      selected={ms.selected.has(row.key)}
                      done={row.kind === 'linked'}
                      itemKey={row.key}
                      edgeOffset={sidePad}
                      {...(selectable ? { gesture: dragSelect.gestureFor(index) } : {})}
                    />
                    <ImportCover url={row.target?.series.thumbnailUrl ?? row.item.thumbnailUrl} />
                  </>
                }
                right={<View />}
                {...(selectable
                  ? { onPress: () => ms.toggle(row.key), onLongPress }
                  : pickable
                    ? { onPress: () => measure((x, y, w, h) => openCandidatePicker(row, x + w / 2, y + h / 2)) }
                    : {})}
              />
            )}
          </Holdable>
        )}
      </RowAnchor>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title={title} />

      {banner && (
        <ThemedText type="small" style={[styles.banner, { color: theme.danger, paddingHorizontal: sidePad }]}>
          {banner}
        </ThemedText>
      )}

      <LegendList
        ref={listRef}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        style={[styles.list, scrollbarInset(paddingTop)]}
        data={rows}
        keyExtractor={(r) => r.key}
        recycleItems
        estimatedItemSize={SettingsRowHeight}
        getFixedItemSize={() => SettingsRowHeight}
        maintainVisibleContentPosition={{ data: false, size: false }}
        extraData={listExtra}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={
          data?.truncated ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
              Showing the first {rows.length} — this list is longer than one import can walk.
            </ThemedText>
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.state}>
              <ActivityIndicator size="small" />
              <ThemedText type="small" themeColor="textSecondary">
                Loading your list…
              </ThemedText>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <ThemedText type="small" style={[styles.stateText, { color: theme.danger }]}>
                {friendlyError(error, 'Could not load the list')}
              </ThemedText>
              <Pressable testID="tracker-import.retry" onPress={() => void refetch()} hitSlop={8} accessibilityRole="button">
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {isFetching ? 'Retrying…' : 'Retry'}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.state}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stateText}>
                Your {trackerName} list is empty.
              </ThemedText>
            </View>
          )
        }
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop,
          paddingLeft: sidePad,
          paddingRight: sidePad,
          paddingBottom: PILL_HEIGHT + Spacing.six,
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />

      <SelectPillBar
        left={sidePad}
        right={sidePad}
        bottom={Math.max(insets.bottom, Spacing.three)}
        options={stagingRows}
        optionsTestID="tracker-import.select-options"
        verbs={
          selectedCount > 0 && !importing
            ? [
                {
                  key: 'import',
                  label: `Import ${selectedCount} series`,
                  Icon: ListPlusIcon,
                  color: theme.accent,
                  onPress: () => void runImport(),
                  testID: 'tracker-import.confirm',
                },
              ]
            : []
        }
      />
    </ThemedView>
  );
}

/**
 * A row that can say where it is: `SettingsRow`'s press carries no event, and a list row is recycled,
 * so a menu that should hang from the row gets the row's window rect measured at press time instead.
 */
function RowAnchor({
  children,
  divider,
}: {
  children: (measure: (cb: (x: number, y: number, w: number, h: number) => void) => void) => ReactNode;
  divider: boolean;
}) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  return (
    <View ref={ref} collapsable={false}>
      {/* eslint-disable-next-line react-hooks/refs -- the render prop only hands this on to the row's press handler; the ref is read when the row is tapped, never while rendering */}
      {children((cb) => ref.current?.measureInWindow(cb))}
      {divider && <View pointerEvents="none" style={[styles.divider, { backgroundColor: theme.hairline }]} />}
    </View>
  );
}
