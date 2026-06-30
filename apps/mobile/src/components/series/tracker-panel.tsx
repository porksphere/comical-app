import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { useOverlay, useSheetScroll } from '@/components/overlay/overlay';
import { ActionButton } from '@/components/series/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  mockTrackerSearch,
  relativeTime,
  TRACKER_ACTION_DELAY_MS,
  TRACKER_SERVICES,
  type TrackerLink,
  type TrackerSearchResult,
} from '@/data/mock';

// The "Trackers ▾" action button: opens a bottom sheet (the app's overlay
// system) to view, sync, unlink and link progress-tracker services for this
// series. Mirrors the reference's anchored `#tracker-menu` / `#tracker-panel`
// popover — rebuilt as a sheet since that's this app's touch-first equivalent
// (see Selector, which does the same for the bridge/page pickers).

export function TrackerButton({ seriesId, initialLinks }: { seriesId: string; initialLinks: TrackerLink[] }) {
  const { open } = useOverlay();
  return (
    <ActionButton
      label="Trackers"
      caret
      onPress={() => open(() => <TrackerMenu seriesId={seriesId} initialLinks={initialLinks} />)}
    />
  );
}

function TrackerMenu({ initialLinks }: { seriesId: string; initialLinks: TrackerLink[] }) {
  const theme = useTheme();
  const [links, setLinks] = useState(initialLinks);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const sync = (trackerId: string) => {
    setBusyId(trackerId);
    setTimeout(() => {
      setLinks((prev) =>
        prev.map((l) =>
          l.trackerId === trackerId
            ? { ...l, lastSyncAt: Date.now(), chaptersRead: (l.chaptersRead ?? 0) + 1 }
            : l,
        ),
      );
      setBusyId(null);
    }, TRACKER_ACTION_DELAY_MS);
  };

  const unlink = (trackerId: string) => {
    setBusyId(trackerId);
    setTimeout(() => {
      setLinks((prev) => prev.filter((l) => l.trackerId !== trackerId));
      setBusyId(null);
    }, TRACKER_ACTION_DELAY_MS);
  };

  const link = (trackerId: string, result: TrackerSearchResult) => {
    setLinks((prev) => [
      ...prev,
      { trackerId, externalId: result.externalId, externalTitle: result.title, chaptersRead: 0 },
    ]);
    setLinking(false);
  };

  return (
    <View style={styles.menu}>
      <ThemedText type="subtitle" style={styles.title}>
        Trackers
      </ThemedText>

      <TrackerScroll>
        {links.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No trackers linked yet.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {links.map((link) => (
              <TrackerRow
                key={link.trackerId}
                link={link}
                busy={busyId === link.trackerId}
                onSync={() => sync(link.trackerId)}
                onUnlink={() => unlink(link.trackerId)}
              />
            ))}
          </View>
        )}

        <Pressable onPress={() => setLinking((v) => !v)}>
          <ThemedView type="backgroundElement" style={[styles.linkToggle, { borderColor: theme.hairline }]}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {linking ? 'Cancel' : '+ Link tracker'}
            </ThemedText>
          </ThemedView>
        </Pressable>

        {linking && <LinkTrackerForm excludeIds={links.map((l) => l.trackerId)} onLink={link} />}
      </TrackerScroll>
    </View>
  );
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
  busy,
  onSync,
  onUnlink,
}: {
  link: TrackerLink;
  busy: boolean;
  onSync: () => void;
  onUnlink: () => void;
}) {
  const theme = useTheme();
  const service = TRACKER_SERVICES.find((s) => s.id === link.trackerId);
  const bits = [
    link.externalId,
    link.chaptersRead != null ? `${link.chaptersRead} read` : null,
    link.lastSyncAt ? `synced ${relativeTime(link.lastSyncAt)}` : null,
  ].filter(Boolean) as string[];

  return (
    <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.hairline }]}>
      <View style={styles.rowText}>
        <ThemedText type="small" numberOfLines={1} style={styles.rowName}>
          {service?.name ?? link.trackerId}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {bits.join(' · ')}
        </ThemedText>
      </View>
      <View style={styles.rowActs}>
        <RowButton label="Sync" onPress={onSync} disabled={busy} />
        <RowButton label="Unlink" onPress={onUnlink} disabled={busy} />
      </View>
    </ThemedView>
  );
}

function RowButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6}>
      <View style={[styles.rowBtn, { borderColor: theme.hairline, opacity: disabled ? 0.5 : 1 }]}>
        <ThemedText type="small" style={styles.rowBtnText}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

// Suppress react-native-web's default focus outline (the field's own border
// carries the focus highlight instead) — same trick as the browse search field.
const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

function LinkTrackerForm({
  excludeIds,
  onLink,
}: {
  excludeIds: string[];
  onLink: (trackerId: string, result: TrackerSearchResult) => void;
}) {
  const theme = useTheme();
  const available = TRACKER_SERVICES.filter((s) => !excludeIds.includes(s.id));
  const [trackerId, setTrackerId] = useState(available[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackerSearchResult[] | null>(null);
  const [focused, setFocused] = useState(false);

  if (!available.length) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        All available trackers are already linked.
      </ThemedText>
    );
  }

  const search = () => setResults(mockTrackerSearch(trackerId, query));

  return (
    <View style={styles.linkForm}>
      <View style={styles.serviceRow}>
        {available.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => {
              setTrackerId(s.id);
              setResults(null);
            }}>
            <View
              style={[
                styles.serviceChip,
                { borderColor: s.id === trackerId ? theme.accent : theme.hairline },
                s.id === trackerId && { backgroundColor: theme.accent },
              ]}>
              <ThemedText type="small" style={s.id === trackerId ? { color: theme.accentOn } : undefined}>
                {s.name}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </View>

      <ThemedView
        type="backgroundElement"
        style={[styles.search, { borderColor: focused ? theme.accent : 'transparent' }]}>
        <SearchIcon color={theme.textSecondary} size={14} />
        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setResults(null);
          }}
          onSubmitEditing={search}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search title…"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.searchInput, NO_OUTLINE, { color: theme.text }]}
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => {
              setQuery('');
              setResults(null);
            }}
            hitSlop={8}
            accessibilityLabel="Clear search">
            <ClearIcon color={theme.textSecondary} size={12} />
          </Pressable>
        )}
      </ThemedView>

      {results && (
        <View style={styles.results}>
          {results.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.resultsEmpty}>
              No results.
            </ThemedText>
          ) : (
            results.map((r) => (
              <Pressable key={r.externalId} onPress={() => onLink(trackerId, r)}>
                <View style={styles.resultRow}>
                  <Image source={{ uri: r.thumbnail }} style={styles.resultThumb} />
                  <ThemedText type="small" numberOfLines={1} style={styles.resultTitle}>
                    {r.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    ({r.externalId})
                  </ThemedText>
                </View>
              </Pressable>
            ))
          )}
        </View>
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
    borderWidth: StyleSheet.hairlineWidth,
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBtnText: {
    fontSize: 12,
    lineHeight: 16,
  },
  linkToggle: {
    paddingVertical: Spacing.two,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  linkForm: {
    gap: Spacing.two,
  },
  serviceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  serviceChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
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
    gap: 2,
  },
  resultsEmpty: {
    paddingVertical: Spacing.two,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  resultThumb: {
    width: 28,
    height: 42,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  resultTitle: {
    flex: 1,
    minWidth: 0,
  },
});
