import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { useKeyboardAvoidingInput, useOverlay, useSheetScroll } from '@/components/overlay/overlay';
import { ActionButton } from '@/components/series/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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

export function TrackerButton({ bridgeId, seriesId }: { bridgeId: string; seriesId: string }) {
  const { open } = useOverlay();
  return (
    <ActionButton
      testID="series.action.trackers"
      label="Trackers"
      caret
      onPress={() => open(() => <TrackerMenu bridgeId={bridgeId} seriesId={seriesId} />)}
    />
  );
}

function TrackerMenu({ bridgeId, seriesId }: { bridgeId: string; seriesId: string }) {
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

      <TrackerScroll>
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
      </TrackerScroll>
    </View>
  );
}

/** One line saying which direction the two-way sync actually moved, so "Sync" can't silently
 *  read as success when nothing reached the tracker.
 *
 *  The push line deliberately talks about *your* progress rather than claiming an exact number on
 *  the tracker: services store an integer chapter count (AniList's `progress` is an `Int`), so a
 *  decimal chapter like 12.5 lands there as 12 and "tracker now at 12.5" would be a lie. */
function syncSummary(res: TrackerLinkSyncResult): string {
  const at = `chapter ${res.chaptersRead}`;
  if (res.pushed) return `Pushed your progress — you're at ${at}.`;
  if (res.readSynced > 0) {
    return `Synced from tracker — ${res.readSynced} chapter${res.readSynced === 1 ? '' : 's'} marked read (now at ${at}).`;
  }
  if (res.updated) return `Already in sync at ${at}.`;
  return 'Nothing to sync yet — no read progress on either side.';
}

const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);

/** Caps the menu body so a long linked-tracker list (plus an open link form
 *  and its results) stays reachable inside the sheet instead of overflowing
 *  past the screen. Reports scroll offset to the enclosing overlay sheet (see
 *  `useSheetScroll`) so a downward drag at the top still chains into dismiss —
 *  same pattern as the filter sheet's `OptionList`. */
function TrackerScroll({ children }: { children: ReactNode }) {
  const sheet = useSheetScroll();
  const localOffset = useSharedValue(0);
  const offset = sheet?.scrollOffset ?? localOffset;
  const onScroll = useAnimatedScrollHandler((e) => {
    offset.value = e.contentOffset.y;
  });
  return (
    <AnimatedScrollView
      ref={sheet?.scrollRef as never}
      onScroll={onScroll}
      scrollEventThrottle={16}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </AnimatedScrollView>
  );
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

// Suppress react-native-web's default focus outline (the field's own border
// carries the focus highlight instead) — same trick as the browse search field.
const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

function LinkTrackerForm({
  trackers,
  submitting,
  onLink,
}: {
  /** Configured, not-yet-linked trackers — already filtered by the caller. */
  trackers: TrackerSummary[];
  /** True while a link request from a previous result tap is in flight. */
  submitting: boolean;
  onLink: (trackerId: string, result: TrackerSearchResult) => void;
}) {
  const theme = useTheme();
  const ds = useDataSource();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [trackerId, setTrackerId] = useState(trackers[0]?.info.id ?? '');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const searchQuery = useQuery({
    queryKey: queryKeys.trackerCatalogSearch(trackerId, submittedQuery, 1),
    queryFn: ({ signal }) => ds.searchTrackerCatalog(trackerId, submittedQuery, 1, signal),
    enabled: submittedQuery.length > 0,
  });
  const results = submittedQuery ? searchQuery.data : undefined;

  const search = () => setSubmittedQuery(query.trim());

  return (
    <View style={styles.linkForm}>
      <ThemedView type="backgroundElement" style={styles.serviceTabs}>
        {trackers.map((t) => (
          <Pressable
            key={t.info.id}
            testID={testId('series.tracker.service', t.info.id)}
            onPress={() => {
              setTrackerId(t.info.id);
              setSubmittedQuery('');
            }}
            style={[styles.serviceTab, t.info.id === trackerId && { backgroundColor: theme.accent }]}>
            <ThemedText
              type="small"
              numberOfLines={1}
              style={t.info.id === trackerId ? { color: theme.accentOn } : { color: theme.textSecondary }}>
              {t.info.name}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      <ThemedView
        type="backgroundElement"
        style={[styles.search, { borderColor: focused ? theme.accent : 'transparent' }]}>
        <SearchIcon color={theme.textSecondary} size={14} />
        <TextInput
          testID="series.tracker.search"
          ref={inputRef}
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setSubmittedQuery('');
          }}
          onSubmitEditing={search}
          onFocus={() => {
            setFocused(true);
            keyboardAvoiding.onFocus(inputRef.current);
          }}
          onBlur={() => {
            setFocused(false);
            keyboardAvoiding.onBlur();
          }}
          placeholder="Search title…"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
          style={[styles.searchInput, NO_OUTLINE, { color: theme.text }]}
        />
        {query.length > 0 && (
          <Pressable
            testID="series.tracker.search-clear"
            onPress={() => {
              setQuery('');
              setSubmittedQuery('');
            }}
            hitSlop={8}
            accessibilityLabel="Clear search">
            <ClearIcon color={theme.textSecondary} size={12} />
          </Pressable>
        )}
      </ThemedView>

      {submittedQuery && searchQuery.isLoading ? (
        <ActivityIndicator />
      ) : searchQuery.isError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {friendlyError(searchQuery.error, 'Search failed.')}
        </ThemedText>
      ) : (
        results && (
          <View style={styles.results}>
            {results.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.resultsEmpty}>
                No results.
              </ThemedText>
            ) : (
              results.map((r) => (
                <Pressable
                  key={r.externalId}
                  testID={testId('series.tracker.result', r.externalId)}
                  disabled={submitting}
                  onPress={() => onLink(trackerId, r)}>
                  <ThemedView type="backgroundElement" style={styles.resultRow}>
                    <Image source={r.thumbnailUrl ? { uri: r.thumbnailUrl } : undefined} style={styles.resultThumb} />
                    <View style={styles.resultText}>
                      <ThemedText type="small" numberOfLines={1} style={styles.rowName}>
                        {r.title}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {r.externalId}
                      </ThemedText>
                    </View>
                  </ThemedView>
                </Pressable>
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
  scroll: {
    maxHeight: 420,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.one,
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
  linkForm: {
    gap: Spacing.two,
  },
  // Tracker-service picker: a segmented control, same shape as the chapters
  // overview/all/read/unread tabs (a filled bar, equal-width pressable
  // segments, the active one filled with the accent colour).
  serviceTabs: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  serviceTab: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  results: {
    gap: Spacing.one,
  },
  resultsEmpty: {
    paddingVertical: Spacing.two,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
  },
  resultThumb: {
    width: 28,
    height: 42,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  resultText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
});
