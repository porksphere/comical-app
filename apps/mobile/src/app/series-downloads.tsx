/**
 * One series' downloads — the consolidated per-series download screen. The Downloads page's series
 * rows open it (no more inline foldout), and the series page's Download button / card menu open the
 * SAME screen — one place where a series' chapters are watched, managed, and (de)queued.
 *
 * Two entry flavours, one behavior:
 *  - From the Downloads page (`all` unset): the manifest's chapters only — status radials, live
 *    progress, and the standard swipe actions per row. Exactly what the old foldout showed.
 *  - From a series (`all=1`): the FULL logical chapter list, downloaded and not — undownloaded rows
 *    carry a muted download glyph and their release date. `select=1` additionally opens in
 *    multi-select (the series Download button's intent: pick chapters, download).
 *
 * Multi-select (top-right toggle): check circles animate in on the left, pushing row content right;
 * swipe actions are disabled entirely while active. A fixed strip offers the live count plus
 * "Select all" / "Select unread" staging, and the pinned footer holds the two bulk verbs — Download
 * (enqueues the selection's not-yet-kept chapters; failed ones retry) and Delete (removes the
 * selection's downloaded ones). Range-fill long-press works like every multi-select list (through
 * `Holdable` — a bare Pressable long-press doesn't fire inside iOS scroll views).
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openConfirm } from '@/components/confirm-popup';
import { chapterActions, chapterCan } from '@/components/downloads/row-actions';
import { DOWNLOAD_STATE_ICON, NOT_DOWNLOADED_ICON } from '@/components/downloads/state-icon';
import { CheckIcon, ClearIcon, DownloadsIcon, EyeIcon, PauseIcon, PlayIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useSelectMode, useSelectToggle } from '@/components/multi-select/select-mode';
import { SelectPillBar } from '@/components/multi-select/select-pill-bar';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import type { SettingsField, SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { dlDeleteChapter, dlGetSeries } from '@/data/api';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from '@/data/downloads/constants';
import { bySortValue, chapterSortValue, displayChapterState } from '@/data/downloads/derive';
import {
  enqueueChapters,
  kickDownloads,
  pauseChapter,
  resumeChapterDownload,
  retryChapter,
} from '@/data/downloads/engine';
import { formatBytes } from '@/data/downloads/format';
import { forgetChapter } from '@/data/downloads/index-cache';
import { selectableGroups, toEnqueue } from '@/data/downloads/select';
import { relativeTime } from '@/data/mock';
import { queryClient } from '@/data/query-client';
import { queryKeys, seriesListQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { usePreferredGroup } from '@/lib/preferred-group';
import { testId } from '@/lib/test-id';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import type { ChapterGroup } from '@/lib/chapter-order';
import { useLocalSearchParams, useRouter } from '@/lib/nav';
import type { DownloadedChapter, DownloadState } from '@comical/downloads';

/**
 * One chapter row: a manifest chapter, a not-yet-downloaded logical chapter, or both merged.
 * Selection deliberately is NOT a field — rows keep a stable object identity across selection taps
 * AND download ticks (see the identity cache below), and so do the form rows made from them, so a
 * recycled list repaints only the row that ticked.
 */
interface RosterRow {
  key: string;
  name: string;
  desc: string;
  /** The manifest record, when this chapter is downloaded/tracked — drives status + swipe actions. */
  c?: DownloadedChapter;
  /** The logical chapter (series entry only) — the identity a fresh enqueue downloads. */
  group?: ChapterGroup;
  unread: boolean;
}

function chapterDescription(c: DownloadedChapter, state: DownloadState): string {
  // A lazily-enqueued chapter has no page list yet (it resolves when the engine picks it up) —
  // "0 pages · 0 B · queued" would read as an error, so show just the state until the count lands.
  if (c.pageCount === 0 && state !== 'complete') return state;
  const noun = c.onlyPages ? 'saved page' : 'page';
  const size = `${c.pageCount} ${noun}${c.pageCount === 1 ? '' : 's'} · ${formatBytes(c.bytes)}`;
  if (state === 'complete') return size;
  const label = state === 'downloading' ? `${c.completedPages}/${c.pageCount}` : state;
  return `${size} · ${label}`;
}

/** The manifest record to show for a logical chapter (best across the group's versions). */
function bestManifest(versionIds: string[], manifest: DownloadedChapter[]): DownloadedChapter | undefined {
  const rank: Record<DownloadState, number> = { complete: 4, downloading: 3, queued: 2, paused: 1, failed: 0 };
  let best: DownloadedChapter | undefined;
  for (const d of manifest) {
    if (versionIds.includes(d.chapterId) && (!best || rank[d.state] > rank[best.state])) best = d;
  }
  return best;
}

export default function SeriesDownloadsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const contentPadding = useSettingsScrollPadding();
  const ds = useDataSource();
  const mock = useMockActive();
  const preferredGroup = usePreferredGroup();

  // `bridgeId` is the machine id (series.tsx's `bridge` is a display name). `all=1` = include the
  // series' full chapter list (the series-page entry); `select=1` = open in multi-select.
  const params = useLocalSearchParams<{
    bridgeId: string;
    id: string;
    title?: string;
    cover?: string;
    author?: string;
    all?: string;
    select?: string;
    removed?: string;
  }>();
  const bridgeId = params.bridgeId ?? '';
  const seriesId = params.id ?? '';
  const showAll = params.all === '1';

  const { data: dlData } = useQuery({
    queryKey: queryKeys.seriesDownloads(bridgeId, seriesId),
    queryFn: () => dlGetSeries(bridgeId, seriesId).catch(() => null),
  });
  const manifest = useMemo(() => dlData?.chapters ?? [], [dlData]);
  const title = params.title ?? dlData?.series.title ?? 'Downloads';
  const cover = params.cover ?? dlData?.series.thumbnailUrl;
  const author = params.author ?? dlData?.series.author;

  // The full chapter list — only fetched for the series-page entry (a cache hit there).
  const { data: fetched } = useQuery(seriesListQuery(ds, mock, bridgeId, seriesId, false, showAll && !!seriesId));
  const chapters = fetched?.chapters;

  const router = useRouter();

  // ── Multi-select mode (the shared select-mode chrome) ────────────────────────
  // `forcedSelect` = opened as the series' Download intent (`select=1`): select mode is on and
  // CAN'T be turned off (the toggle is hidden — the back button is the way out). Downloading then
  // closes the page IF the visit was purely "pick and download"; but if the user did any management
  // (pause/resume/cancel/delete) first, the visit became a management session, so we stay put.
  const forcedSelect = params.select === '1';
  const mode = useSelectMode(forcedSelect);
  const selecting = mode.selecting;
  const [didManage, setDidManage] = useState(false);

  // Opening this screen nudges the queue to drain — same safety net as the Downloads page.
  useEffect(() => {
    kickDownloads();
  }, []);

  // ── Rows ──────────────────────────────────────────────────────────────────────
  // Series entry: every logical chapter in ascending reading order, merged with its manifest state.
  // Downloads entry: the manifest's chapters in the Downloads page's finished-first order.
  const sel = useMemo(
    () => (showAll && chapters ? selectableGroups(chapters, manifest) : undefined),
    [showAll, chapters, manifest],
  );
  // Row objects are REUSED from `rowCache` while their rendered content is unchanged: a page event
  // patches ONE chapter object in the manifest (the query cache patch keeps every other chapter's
  // identity), so only the ticking chapter's row gets a fresh object. Without this, every progress
  // tick rebuilt all N row objects and LegendList re-rendered every visible row several times a
  // second — which made the select-mode animation stutter during an active download. A state-held
  // Map (stable instance, populated during the memo's own computation) rather than a ref, which
  // must not be read during render.
  // The sort ORDER depends only on completeness + chapter number + addedAt (see chapterSortValue),
  // never on download PROGRESS — so it can't change on a progress tick, only when a chapter completes
  // or the set changes. So recompute the order on a cheap completeness signature instead of re-sorting
  // the whole (large) manifest on every ~3/second progress patch, and decorate-sort-undecorate so
  // chapterSortValue (which allocates a tuple) runs once per chapter, not twice per comparison.
  const orderSig = manifest.map((c) => `${c.chapterId}:${c.state === 'complete' ? 1 : 0}`).join('|');
  const orderedIds = useMemo(
    () =>
      manifest
        .map((c) => ({ id: c.chapterId, sv: chapterSortValue(c) }))
        .sort((a, b) => bySortValue(a.sv, b.sv))
        .map((x) => x.id),
    // Keyed on the completeness signature, NOT `manifest` — a progress tick makes a new manifest but
    // the same order, so this correctly skips the re-sort. (manifest read is intentional here.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderSig],
  );
  const manifestById = useMemo(() => {
    const m = new Map<string, (typeof manifest)[number]>();
    for (const c of manifest) m.set(c.chapterId, c);
    return m;
  }, [manifest]);

  const [rowCache] = useState(() => new Map<string, RosterRow>());
  const rows: RosterRow[] = useMemo(() => {
    const reuse = (next: RosterRow): RosterRow => {
      const prev = rowCache.get(next.key);
      const keep =
        prev && prev.c === next.c && prev.desc === next.desc && prev.name === next.name && prev.unread === next.unread;
      const row = keep ? prev : next;
      rowCache.set(next.key, row);
      return row;
    };
    if (sel) {
      return sel.map((s) => {
        const c = bestManifest(s.group.versions.map((v) => v.id), manifest);
        return reuse({
          key: s.group.key,
          name: s.group.name,
          desc: c ? chapterDescription(c, displayChapterState(c)) : relativeTime(s.group.versions[0]?.date ?? 0),
          ...(c ? { c } : {}),
          group: s.group,
          unread: s.unread,
        });
      });
    }
    // Map the (rarely-recomputed) order onto the LIVE chapter objects, so progress still updates each
    // row's description while the order itself holds steady.
    return orderedIds.flatMap((id) => {
      const c = manifestById.get(id);
      if (!c) return [];
      return [
        reuse({
          key: c.chapterId,
          // A direct (chapterless) series files its single page set under a RESERVED chapter id —
          // never a name to show, so label it for what it is. (The series page's Download button
          // sends a direct series to the Downloads screen instead of here, but its row there still
          // opens this screen.)
          name:
            c.chapterName ??
            (c.chapterId === DIRECT_DOWNLOAD_CHAPTER_ID
              ? 'All pages'
              : c.number !== undefined
                ? `Chapter ${c.number}`
                : c.chapterId),
          desc: chapterDescription(c, displayChapterState(c)),
          c,
          unread: false,
        }),
      ];
    });
  }, [sel, manifest, orderedIds, manifestById, rowCache]);

  const allKeys = useMemo(() => rows.map((r) => r.key), [rows]);
  const unreadKeys = useMemo(() => rows.filter((r) => r.unread && !r.c).map((r) => r.key), [rows]);
  const ms = useMultiSelect(allKeys);

  const toggleSelecting = () => {
    if (selecting) ms.clear();
    mode.toggle();
  };
  const selectToggle = useSelectToggle(selecting, toggleSelecting, 'series.dl.select-toggle');

  // The series-page Download intent (`select=1`): once the chapter list lands, STAGE the default
  // pick — every unread chapter not already marked for download — so the button's most common
  // outcome is one tap away. Deferred a tick: this reacts to the list ARRIVING (async data).
  const [preselectPending, setPreselectPending] = useState(params.select === '1');
  useEffect(() => {
    if (!preselectPending || !sel) return;
    const t = setTimeout(() => {
      if (unreadKeys.length > 0) ms.selectOnly(unreadKeys);
      setPreselectPending(false);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectPending, sel]);

  // ── Bulk verbs (the floating pills, select mode only) ─────────────────────────
  // Each verb surfaces only while the selection makes it valid, using the SAME per-state rules as
  // the rows' swipe actions (`chapterCan` — see row-actions.tsx): Delete only for settled chapters
  // (complete/paused/failed — an actively downloading one must be paused first), Cancel for queued
  // ones, Pause/Resume for in-flight/paused. Download stays the enqueue verb.
  const picked = rows.filter((r) => ms.selected.has(r.key));
  // A series its source removed has nothing left to fetch, so Download never surfaces for it.
  const toDownload =
    params.removed === '1' ? [] : picked.filter((r) => (r.group ? !r.c || r.c.state === 'failed' : r.c?.state === 'failed'));
  const toPause = picked.filter((r) => r.c && chapterCan.pause(r.c.state));
  const toResume = picked.filter((r) => r.c && chapterCan.resume(r.c.state));
  const toCancel = picked.filter((r) => r.c && chapterCan.cancel(r.c.state));
  const toDelete = picked.filter((r) => r.c && chapterCan.delete(r.c.state));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.seriesDownloads(bridgeId, seriesId) });
  };

  // After a bulk action settles: on the Downloads-page entry, leave select mode (the toggle owns
  // it); on the forced series entry, stay in select mode (it can't be turned off) and just clear
  // the acted-on selection so the user can keep managing.
  const afterBulkAction = () => {
    if (forcedSelect) ms.clear();
    else toggleSelecting();
  };
  // Any of these makes the visit a "management session" (see `forcedSelect`).
  const markManaged = () => setDidManage(true);

  const downloadSelected = () => {
    const groups = toDownload.filter((r) => r.group).map((r) => r.group!);
    if (groups.length > 0) {
      enqueueChapters(
        { bridgeId, seriesId, title, ...(cover && { thumbnailUrl: cover }), ...(author && { author }) },
        toEnqueue(groups, preferredGroup),
      );
    }
    // Manifest-only failed rows (Downloads-page entry) have no bridge chapter to enqueue — retry them.
    for (const r of toDownload) {
      if (!r.group && r.c) void retryChapter(r.c.bridgeId, r.c.seriesId, r.c.chapterId);
    }
    // A pure "pick and download" trip from a series ends by returning to that series; a trip where
    // the user also managed downloads stays open (they're clearly here to manage).
    if (forcedSelect && !didManage) {
      router.back();
      return;
    }
    afterBulkAction();
  };

  // Pause/resume KEEP the selection (unlike download/delete): they only flip state, and the natural
  // follow-up ("pause these, now delete them") acts on the same chapters.
  const pauseSelected = () => {
    markManaged();
    for (const r of toPause) void pauseChapter(r.c!.bridgeId, r.c!.seriesId, r.c!.chapterId);
  };
  const resumeSelected = () => {
    markManaged();
    for (const r of toResume) void resumeChapterDownload(r.c!.bridgeId, r.c!.seriesId, r.c!.chapterId);
  };

  // Delete and Cancel are the same removal under the hood (the manifest cascade drops queued
  // entries and downloaded bytes alike) — the split is PRESENTATION, mirroring the swipe actions:
  // an X for "never started", a trash can for "on disk".
  const removeChapters = async (targets: RosterRow[]) => {
    markManaged();
    for (const r of targets) {
      const c = r.c!;
      await dlDeleteChapter(c.bridgeId, c.seriesId, c.chapterId).catch(() => {});
      forgetChapter(c.bridgeId, c.seriesId, c.chapterId);
    }
    invalidate();
    afterBulkAction();
  };
  const deleteSelected = () => removeChapters(toDelete);
  const cancelSelected = () => removeChapters(toCancel);
  const confirmDeleteSelected = () =>
    openConfirm({
      message: `${toDelete.length} chapter${toDelete.length === 1 ? '' : 's'} will be deleted from this device.`,
      confirmLabel: toDelete.length === 1 ? 'Delete Chapter' : `Delete ${toDelete.length} Chapters`,
      onConfirm: () => void deleteSelected(),
    });
  const confirmDeleteChapter = (name: string, c: DownloadedChapter) =>
    openConfirm({
      message: `"${name}" will be deleted from this device.`,
      confirmLabel: 'Delete Chapter',
      onConfirm: () => void deleteChapterRow(c),
    });

  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;

  // The staging menu rows (top-left three-dot trigger, replacing the back button in select mode).
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      symbol: allSelected ? ('xmark.circle' as const) : ('checkmark.circle' as const),
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('series.dl.menu', 'all'),
    },
    ...(showAll
      ? [
          {
            label: 'Select unread',
            Icon: EyeIcon,
            symbol: 'eye' as const,
            loading: false,
            disabled: unreadKeys.length === 0,
            onPress: () => ms.selectOnly(unreadKeys),
            testID: testId('series.dl.menu', 'unread'),
          },
        ]
      : []),
  ];

  const deleteChapterRow = async (c: DownloadedChapter) => {
    await dlDeleteChapter(c.bridgeId, c.seriesId, c.chapterId).catch(() => {});
    forgetChapter(c.bridgeId, c.seriesId, c.chapterId);
    invalidate();
  };

  // A chapter as a form row: its state as the tile, its size and progress under it, its swipe
  // actions; it opens nothing (`onPress` unset). Made once per row object (`rowCache` keeps those
  // across ticks), so a recycled list re-renders only the chapter that changed.
  const [fieldCache] = useState(() => new WeakMap<RosterRow, SettingsField>());
  const fieldOf = (r: RosterRow): SettingsField => {
    const cached = fieldCache.get(r);
    if (cached) return cached;
    const c = r.c;
    const state = c ? displayChapterState(c) : undefined;
    const field: SettingsField = {
      kind: 'link',
      key: r.key,
      testID: testId('series.dl.row', r.key),
      label: r.name,
      description: r.desc,
      tone: state === 'failed' ? 'danger' : undefined,
      icon: state ? DOWNLOAD_STATE_ICON[state] : NOT_DOWNLOADED_ICON,
      progress: c && state === 'downloading' && c.pageCount > 0 ? c.completedPages / c.pageCount : undefined,
      actions:
        c && state
          ? chapterActions(state, {
              onPause: () => void pauseChapter(c.bridgeId, c.seriesId, c.chapterId),
              onResume: () => void resumeChapterDownload(c.bridgeId, c.seriesId, c.chapterId),
              onRetry: () => void retryChapter(c.bridgeId, c.seriesId, c.chapterId),
              onCancel: () => void deleteChapterRow(c),
              onDelete: () => confirmDeleteChapter(r.name, c),
            })
          : undefined,
    };
    fieldCache.set(r, field);
    return field;
  };

  const sections: SettingsFormSection[] = [
    rows.length > 0
      ? {
          fields: rows.map(fieldOf),
          unbounded: true,
          selection: { selecting, progress: mode.progress, selected: ms.selected, toggle: ms.toggle, rangeFill: ms.rangeFill, selectSet: ms.selectSet },
        }
      : {
          fields: [
            {
              kind: 'note',
              testID: 'series.dl.empty',
              title: showAll && !chapters ? 'Loading chapters…' : 'Nothing downloaded for this series',
            },
          ],
        },
  ];

  return (
    <ThemedView style={styles.container}>
      {/* Select mode swaps the title for the live count. The mode toggle is hidden on the forced
          series-download entry — there the back button is the only way out. */}
      <TopBar title={selecting ? `${ms.count} selected` : title} actions={forcedSelect ? undefined : [selectToggle]} />
      <SettingsList sections={sections} />

      {/* The select-mode chrome: staging "…" leading, every valid verb trailing (download tinted,
          cancel/delete danger). */}
      {selecting && (
        <SelectPillBar
          left={contentPadding.paddingLeft}
          right={contentPadding.paddingRight}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="series.dl.select-options"
          verbs={[
            ...(toPause.length > 0
              ? [{ key: 'pause', symbol: 'pause' as const, label: `Pause ${toPause.length} chapters`, Icon: PauseIcon, onPress: pauseSelected, testID: 'series.dl.pause' }]
              : []),
            ...(toResume.length > 0
              ? [{ key: 'resume', symbol: 'play' as const, label: `Resume ${toResume.length} chapters`, Icon: PlayIcon, onPress: resumeSelected, testID: 'series.dl.resume' }]
              : []),
            ...(toCancel.length > 0
              ? [{ key: 'cancel', symbol: 'xmark' as const, label: `Cancel ${toCancel.length} queued chapters`, Icon: ClearIcon, color: theme.danger, onPress: () => void cancelSelected(), testID: 'series.dl.cancel' }]
              : []),
            ...(toDelete.length > 0
              ? [{ key: 'delete', symbol: 'trash' as const, label: `Delete ${toDelete.length} chapters`, Icon: TrashIcon, color: theme.danger, onPress: confirmDeleteSelected, testID: 'series.dl.delete' }]
              : []),
            ...(toDownload.length > 0
              ? [{ key: 'download', symbol: 'arrow.down.circle' as const, label: `Download ${toDownload.length} chapters`, Icon: DownloadsIcon, color: theme.accent, onPress: downloadSelected, testID: 'series.dl.download' }]
              : []),
          ]}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
