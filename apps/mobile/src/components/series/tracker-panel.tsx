import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { CatalogResultRow, CatalogSearchField, catalogSearchStyles, SheetScroll, SourceTabs } from '@/components/catalog-search';
import { TrackersIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { ACTION_ICON_SIZE, ActionButton } from '@/components/series/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import type { TrackerLinkSyncResult, TrackerSummary } from '@/data/api';
import { relativeTime } from '@/data/mock';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { TrackerLink, TrackerSearchResult } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { testId } from '@/lib/test-id';

// The "Trackers ▾" action button: opens a bottom sheet (the app's overlay
// system) to view, sync, unlink and link progress-tracker services for this
// series. Mirrors the reference's anchored `#tracker-menu` / `#tracker-panel`
// popover — rebuilt as a sheet since that's this app's touch-first equivalent
// (see Selector, which does the same for the bridge/page pickers).
//
// Trackers themselves are bridge-agnostic (configured once in Settings, shared across every
// series — see trackers.tsx), but a *link* is per library entry, so every call here is scoped to
// this series' bridgeId+seriesId.

export function TrackerButton({ bridgeId, seriesId, title }: { bridgeId: string; seriesId: string; title: string }) {
  const { open } = useOverlay();
  const theme = useTheme();
  return (
    <ActionButton
      testID="series.action.trackers"
      label="Trackers"
      leading={<TrackersIcon color={theme.text} size={ACTION_ICON_SIZE} />}
      caret
      onPress={() => open(() => <TrackerMenu bridgeId={bridgeId} seriesId={seriesId} title={title} />)}
    />
  );
}

function TrackerMenu({ bridgeId, seriesId, title }: { bridgeId: string; seriesId: string; title: string }) {
  const theme = useTheme();
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState(false);

  // `data === undefined` = still loading; `null` = this server has no tracker support — the same
  // states trackers.tsx handles, defending the race where the Trackers button rendered (series.tsx
  // gates it on this same query) but trackers vanished before the sheet opened.
  const trackersQuery = useQuery({ queryKey: queryKeys.trackers(), queryFn: ({ signal }) => ds.getTrackers(signal) });

  const linksKey = queryKeys.trackerLinks(mock, bridgeId, seriesId);
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: ({ signal }) => ds.getTrackerLinks(bridgeId, seriesId, signal),
  });
  const invalidateLinks = () => queryClient.invalidateQueries({ queryKey: linksKey });

  // The sync is two-way, so its outcome isn't self-evident from the row alone — a push leaves the
  // local read-state untouched and only moves the tracker. Report which way it went, and surface a
  // failure instead of letting it look like it worked (an expired token used to do exactly that).
  const syncMutation = useMutation({
    mutationFn: (trackerId: string) => ds.syncTrackerLink(bridgeId, seriesId, trackerId),
    onSuccess: invalidateLinks,
  });
  const unlinkMutation = useMutation({
    mutationFn: (trackerId: string) => ds.unlinkTracker(bridgeId, seriesId, trackerId),
    onSuccess: invalidateLinks,
  });
  const linkMutation = useMutation({
    mutationFn: ({ trackerId, result }: { trackerId: string; result: TrackerSearchResult }) =>
      ds.linkTracker(bridgeId, seriesId, trackerId, result.externalId),
    onSuccess: () => {
      invalidateLinks();
      setLinking(false);
    },
  });

  if (trackersQuery.data === undefined) {
    return (
      <View style={styles.menu}>
        <ThemedText type="subtitle" style={styles.title}>
          Trackers
        </ThemedText>
        <ActivityIndicator />
      </View>
    );
  }

  if (trackersQuery.data === null) {
    return (
      <View style={styles.menu}>
        <ThemedText type="subtitle" style={styles.title}>
          Trackers
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Trackers are not available on this server.
        </ThemedText>
      </View>
    );
  }

  const trackers = trackersQuery.data;
  const links = linksQuery.data;
  const linkedIds = links?.map((l) => l.trackerId) ?? [];
  // Only configured trackers are offered for linking — search/link against one still missing
  // required settings would just fail.
  const availableToLink = trackers.filter((t) => t.configured && !linkedIds.includes(t.info.id));

  return (
    <View style={styles.menu}>
      <ThemedText type="subtitle" style={styles.title}>
        Trackers
      </ThemedText>

      <SheetScroll>
        {links === undefined ? (
          <ActivityIndicator />
        ) : linksQuery.isError ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {friendlyError(linksQuery.error, 'Failed to load tracker links.')}
          </ThemedText>
        ) : links.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No trackers linked yet.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {links.map((link) => (
              <TrackerRow
                key={link.trackerId}
                link={link}
                name={trackers.find((t) => t.info.id === link.trackerId)?.info.name}
                busy={
                  (syncMutation.isPending && syncMutation.variables === link.trackerId) ||
                  (unlinkMutation.isPending && unlinkMutation.variables === link.trackerId)
                }
                onSync={() => syncMutation.mutate(link.trackerId)}
                onUnlink={() => unlinkMutation.mutate(link.trackerId)}
              />
            ))}
          </View>
        )}

        {syncMutation.isError ? (
          <ThemedText type="small" style={{ color: theme.danger }} testID="series.tracker.sync-status">
            {friendlyError(syncMutation.error, 'Failed to sync tracker.')}
          </ThemedText>
        ) : syncMutation.isSuccess ? (
          <ThemedText type="small" themeColor="textSecondary" testID="series.tracker.sync-status">
            {syncSummary(syncMutation.data)}
          </ThemedText>
        ) : null}

        {linking && (
          <LinkTrackerForm
            trackers={availableToLink}
            title={title}
            submitting={linkMutation.isPending}
            onLink={(trackerId, result) => linkMutation.mutate({ trackerId, result })}
          />
        )}

        {linkMutation.isError && (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {friendlyError(linkMutation.error, 'Failed to link tracker.')}
          </ThemedText>
        )}

        {!linking && availableToLink.length > 0 && (
          <Pressable testID="series.tracker.link-toggle" onPress={() => setLinking(true)}>
            <ThemedView type="backgroundElement" style={styles.linkToggle}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                + Link tracker
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
      </SheetScroll>
    </View>
  );
}

/** One line saying what the sync did, so "Sync" can't silently read as success when nothing
 *  reached the tracker. The sync only ever goes one way — a tracker that is further ahead is
 *  reported, never applied to the chapters here.
 *
 *  The push line deliberately talks about *your* progress rather than claiming an exact number on
 *  the tracker: services store an integer chapter count (AniList's `progress` is an `Int`), so a
 *  decimal chapter like 12.5 lands there as 12 and "tracker now at 12.5" would be a lie. */
function syncSummary(res: TrackerLinkSyncResult): string {
  const at = `chapter ${res.chaptersRead}`;
  if (res.pushed) return `Pushed your progress — you're at ${at}.`;
  if (res.trackerRead > res.chaptersRead) {
    return `Tracker is at chapter ${res.trackerRead} — your progress here is unchanged.`;
  }
  if (res.updated) return `Already in sync at ${at}.`;
  return 'Nothing to sync yet — no read progress on either side.';
}

function TrackerRow({
  link,
  name,
  busy,
  onSync,
  onUnlink,
}: {
  link: TrackerLink;
  name?: string;
  busy: boolean;
  onSync: () => void;
  onUnlink: () => void;
}) {
  const bits = [
    link.externalId,
    link.chaptersRead != null ? `${link.chaptersRead} read` : null,
    link.lastSyncAt ? `synced ${relativeTime(link.lastSyncAt)}` : null,
  ].filter(Boolean) as string[];

  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      <View style={styles.rowText}>
        <ThemedText type="small" numberOfLines={1} style={styles.rowName}>
          {name ?? link.trackerId}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {bits.join(' · ')}
        </ThemedText>
      </View>
      <View style={styles.rowActs}>
        <RowButton testID={testId('series.tracker', link.trackerId, 'sync')} label="Sync" onPress={onSync} disabled={busy} />
        <RowButton testID={testId('series.tracker', link.trackerId, 'unlink')} label="Unlink" onPress={onUnlink} disabled={busy} />
      </View>
    </ThemedView>
  );
}

function RowButton({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} hitSlop={6} style={disabled && styles.rowBtnDisabled}>
      <ThemedView type="backgroundSelected" style={styles.rowBtn}>
        <ThemedText type="small" style={styles.rowBtnText}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function LinkTrackerForm({
  trackers,
  title,
  submitting,
  onLink,
}: {
  /** Configured, not-yet-linked trackers — already filtered by the caller. */
  trackers: TrackerSummary[];
  /** The series' own title: the search the user would type nine times out of ten, so it is
   *  typed and run for them when the form opens, and re-run whenever they switch tracker. */
  title: string;
  /** True while a link request from a previous result tap is in flight. */
  submitting: boolean;
  onLink: (trackerId: string, result: TrackerSearchResult) => void;
}) {
  const theme = useTheme();
  const ds = useDataSource();
  const [trackerId, setTrackerId] = useState(trackers[0]?.info.id ?? '');
  const [query, setQuery] = useState(title.trim());
  const [submittedQuery, setSubmittedQuery] = useState(title.trim());

  const searchQuery = useQuery({
    queryKey: queryKeys.trackerCatalogSearch(trackerId, submittedQuery),
    // No cursor: the form shows the first page of matches only, so there's no walk to resume.
    queryFn: ({ signal }) => ds.searchTrackerCatalog(trackerId, submittedQuery, undefined, signal),
    enabled: submittedQuery.length > 0,
  });
  const results = submittedQuery ? searchQuery.data : undefined;

  return (
    <View style={catalogSearchStyles.form}>
      <SourceTabs
        sources={trackers.map((t) => t.info)}
        activeId={trackerId}
        onSelect={(id) => {
          setTrackerId(id);
          setSubmittedQuery(query.trim());
        }}
        testIDFor={(id) => testId('series.tracker.service', id)}
      />

      <CatalogSearchField
        testID="series.tracker.search"
        clearTestID="series.tracker.search-clear"
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          setSubmittedQuery('');
        }}
        onSubmit={() => setSubmittedQuery(query.trim())}
        onClear={() => {
          setQuery('');
          setSubmittedQuery('');
        }}
        editable={!submitting}
      />

      {submittedQuery && searchQuery.isLoading ? (
        <ActivityIndicator />
      ) : searchQuery.isError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {friendlyError(searchQuery.error, 'Search failed.')}
        </ThemedText>
      ) : (
        results && (
          <View style={catalogSearchStyles.results}>
            {results.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={catalogSearchStyles.resultsEmpty}>
                No results.
              </ThemedText>
            ) : (
              results.map((r) => (
                <CatalogResultRow
                  key={r.externalId}
                  testID={testId('series.tracker.result', r.externalId)}
                  thumbnailUrl={r.thumbnailUrl}
                  title={r.title}
                  subtitle={r.externalId}
                  disabled={submitting}
                  onPress={() => onLink(trackerId, r)}
                />
              ))
            )}
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    gap: Spacing.three,
  },
  title: {
    marginBottom: -Spacing.one,
  },
  list: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    ...ContinuousCorner,
    borderRadius: 8,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    fontWeight: '600',
  },
  rowActs: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  rowBtn: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 6,
  },
  rowBtnDisabled: {
    opacity: 0.5,
  },
  rowBtnText: {
    fontSize: 13,
    lineHeight: 18,
  },
  linkToggle: {
    paddingVertical: Spacing.two,
    borderRadius: 7,
    alignItems: 'center',
  },
});
