import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { fields, select, type SettingsFormSection, type SettingsOption } from '@/components/settings/settings-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { SettingsCardInset, Spacing } from '@/constants/theme';
import { useComicalExcluded } from '@/data/comical-home';
import { autoDownloadLibrary, describeBackfill, librarySize } from '@/data/downloads/auto';
import { useBridgeAutoDownload, useDownloadPrefs, type AutoDownloadKind } from '@/data/downloads/prefs';
import type { ApiBridgeInfo, ContentRating } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

/**
 * A capability id as a person would read it: `"related-series"` → `"Related series"`.
 *
 * Deliberately a transform rather than a lookup table — the contract's capability list grows, and a
 * bridge built against a newer contract can advertise one this build has never heard of. A table
 * would render those as a raw kebab id (or, worse, drop them); the transform degrades gracefully.
 */
const capabilityLabel = (id: string): string => {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Capabilities + self-reported facts from `GET /bridges/{id}`'s `info` — everything the bridge
 *  declares about itself (version, contract version, languages, content rating, rate limit),
 *  matching comical-web's `buildBridgeMetadata` in `comical-web/client/app.ts`. Untitled: this is
 *  the top of the bridge's own screen, whose bar already carries its name. */
export function bridgeMetaSections(info: ApiBridgeInfo): SettingsFormSection[] {
  // On-device, `info` is the bridge's raw self-reported metadata (never re-validated by the contract
  // schema the remote server enforces), so these arrays can be absent — guard like every other
  // consumer does (host-rn's `capabilities.ts`, host-server's `router.ts`).
  const capabilities = info.capabilities ?? [];
  const languages = info.languages ?? [];
  const rateLimit =
    info.rateLimit && (info.rateLimit.maxConcurrent !== undefined || info.rateLimit.minIntervalMs !== undefined)
      ? [
          info.rateLimit.maxConcurrent !== undefined ? `${info.rateLimit.maxConcurrent} concurrent` : null,
          info.rateLimit.minIntervalMs !== undefined ? `${info.rateLimit.minIntervalMs}ms interval` : null,
        ]
          .filter(Boolean)
          .join(', ')
      : undefined;
  return [
    {
      fields: fields(
        { kind: 'value', label: 'Version', value: info.version },
        { kind: 'value', label: 'Contract', value: info.contractVersion },
        { kind: 'value', label: 'Languages', value: languages.join(', ') },
        { kind: 'value', label: 'Content', value: info.nsfw ? 'NSFW' : 'SFW' },
        rateLimit !== undefined && { kind: 'value', label: 'Rate limit', value: rateLimit },
      ),
    },
    {
      title: 'Capabilities',
      fields: capabilities.length > 0 ? [{ kind: 'chips', testID: 'settings.bridge.capabilities', items: capabilities.map(capabilityLabel) }] : [],
    },
  ];
}

/** Free-form excluded-tag editor with live autocomplete (capability "exclude-tags"), mirroring
 *  comical-web's `buildExcludedTagsControl`. The block of its section: the screen frames it. */
export function TagExclusionsEditor({
  bridgeId,
  initialTags,
  initialLabels,
}: {
  bridgeId: string;
  initialTags: string[];
  initialLabels: Record<string, string>;
}) {
  const ds = useDataSource();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [tags, setTags] = useState<{ id: string; label: string }[]>(() =>
    initialTags.map((id) => ({ id, label: initialLabels[id] ?? id })),
  );
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);

  // Debounced + cached live tag search (dedupes/caches per query — see queries.ts `tagSearch`).
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const tagSearch = useQuery({
    queryKey: queryKeys.tagSearch(bridgeId, debouncedQuery),
    queryFn: ({ signal }) => ds.getTags(bridgeId, debouncedQuery, signal),
    enabled: debouncedQuery.length > 0,
    placeholderData: keepPreviousData,
  });
  // Suggestions minus tags already added (recomputed as `tags` changes).
  const visibleSuggestions = useMemo(
    () => (query.trim() ? (tagSearch.data ?? []).filter((r) => !tags.some((t) => t.id === r.value)) : []),
    [query, tagSearch.data, tags],
  );

  const addTag = (id: string, label: string) => {
    const trimmed = id.trim();
    if (!trimmed || tags.some((t) => t.id === trimmed)) return;
    setTags((prev) => [...prev, { id: trimmed, label: label || trimmed }]);
    setQuery('');
    setDirty(true);
  };

  const removeTag = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => ds.putExcludedTags(bridgeId, tags),
    onSuccess: async () => {
      setDirty(false);
      // Matches the parent screen's own settings save: the bridge-settings screen's
      // `data.excludedTags`/`excludedTagLabels` came from this same query, so without this it
      // goes stale until the screen is torn down and remounted.
      await queryClient.invalidateQueries({ queryKey: queryKeys.bridgeSettings(bridgeId) });
    },
  });
  const saving = saveMutation.isPending;
  const save = () => saveMutation.mutate();

  return (
    <View style={styles.editor}>
      {tags.length > 0 && (
        <View style={styles.tagRow}>
          {tags.map((t) => (
            <Pressable key={t.id} testID={testId('settings.bridge.excluded-tag', t.id)} onPress={() => removeTag(t.id)} hitSlop={4}>
              <View style={[styles.tagChip, { backgroundColor: theme.chipFill }]}>
                <ThemedText style={{ color: theme.chipText }} numberOfLines={1}>
                  {t.label}
                </ThemedText>
                <ThemedText style={{ color: theme.chipText }}> {'×'}</ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <TextInput
        testID="settings.bridge.excluded-tags.input"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => addTag(query, query)}
        placeholder="Type a tag…"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      {visibleSuggestions.length > 0 && (
        <View style={[styles.suggestions, { borderColor: theme.hairline }]}>
          {visibleSuggestions.slice(0, 6).map((s) => (
            <Pressable key={s.value} testID={testId('settings.bridge.tag-suggestion', s.value)} onPress={() => addTag(s.value, s.label)} style={styles.suggestionRow}>
              <ThemedText type="small">{s.label}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {dirty && (
        <Pressable testID="settings.bridge.excluded-tags.save" onPress={save} disabled={saving}>
          <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }, saving && styles.saveBtnDisabled]}>
            <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
              {saving ? 'Saving…' : 'Save excluded tags'}
            </ThemedText>
          </ThemedView>
        </Pressable>
      )}
    </View>
  );
}

const CONTENT_RATING_OPTIONS: SettingsOption<string>[] = [
  { value: '', label: 'No limit' },
  { value: 'everyone', label: 'Everyone' },
  { value: 'mature', label: 'Mature' },
  { value: 'adult', label: 'Adult' },
];

/** Max content-rating ceiling picker (capability "content-rating") — series rated above the chosen
 *  tier are hidden the same way the tag exclusions are, but the redaction itself is entirely
 *  host-side (the rating already travels on the item). */
export function useMaxContentRatingSection(bridgeId: string, initialRating: ContentRating | null): SettingsFormSection {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: (rating: ContentRating | null) => ds.putMaxContentRating(bridgeId, rating),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bridgeSettings(bridgeId) });
    },
  });
  return {
    title: 'Content rating',
    fields: [
      select({
        label: 'Maximum content rating',
        description: "Series rated above this are hidden from this bridge's lists and search.",
        value: initialRating ?? '',
        options: CONTENT_RATING_OPTIONS,
        onChange: (v) => saveMutation.mutate(v === '' ? null : (v as ContentRating)),
      }),
    ],
  };
}

/** "Disable tracker sync" / "Don't track reading history" toggles from
 *  `GET|PUT /library/bridges/{id}/prefs` — empty when the server has no library store mounted
 *  (`getBridgePrefs` resolves `null`). */
export function useBridgePrefsSection(bridgeId: string): SettingsFormSection {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.bridgePrefs(bridgeId),
    queryFn: ({ signal }) => ds.getBridgePrefs(bridgeId, signal),
  });

  const setMutation = useMutation({
    mutationFn: (update: { trackersDisabled?: boolean; historyDisabled?: boolean }) => ds.putBridgePrefs(bridgeId, update),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bridgePrefs(bridgeId) });
    },
  });
  const set = (update: { trackersDisabled?: boolean; historyDisabled?: boolean }) => setMutation.mutate(update);

  return {
    title: 'Library',
    fields: data
      ? [
          { kind: 'toggle', label: 'Disable tracker sync for this bridge', value: data.trackersDisabled, onChange: (v) => set({ trackersDisabled: v }) },
          { kind: 'toggle', label: "Don't track reading history for this bridge", value: data.historyDisabled, onChange: (v) => set({ historyDisabled: v }) },
        ]
      : [],
  };
}

const AUTO_DOWNLOAD_ROWS: { kind: AutoDownloadKind; label: string; description: string; chapters?: boolean }[] = [
  { kind: 'autoSeries', label: 'Saved series', description: 'Download every chapter of a series you add to your library.' },
  { kind: 'autoNew', label: 'New chapters', description: "Download new chapters of saved series as they're found.", chapters: true },
  { kind: 'autoChapters', label: 'Saved chapters', description: 'Download a chapter when you save it.', chapters: true },
  { kind: 'autoPages', label: 'Saved pages', description: 'Download a page when you save it.' },
];

/** This bridge's opt-outs from auto-download, one per kind. A kind that is off in Settings → General
 *  is greyed out rather than hidden (its stored opt-in still shows, ready for when it comes back on),
 *  and so are the chapter kinds on a direct bridge, whose series have no chapters. */
export function useBridgeAutoDownloadSection(bridgeId: string, direct: boolean): SettingsFormSection {
  const prefs = useDownloadPrefs();
  const [optedIn, set] = useBridgeAutoDownload(bridgeId);
  const offGlobally = AUTO_DOWNLOAD_ROWS.some((r) => !prefs[r.kind] && !(direct && r.chapters));
  return {
    title: 'Auto-download',
    footer: offGlobally ? 'Greyed-out kinds are off for every bridge in Settings → General.' : undefined,
    fields: AUTO_DOWNLOAD_ROWS.map((r) => {
      const noChapters = direct && !!r.chapters;
      return {
        kind: 'toggle',
        label: r.label,
        description: noChapters ? "This bridge's series have no chapters." : r.description,
        value: !noChapters && optedIn(r.kind),
        onChange: (on) => set(r.kind, on),
        disabled: noChapters || !prefs[r.kind],
      };
    }),
  };
}

/** A one-off backfill of this bridge's saved series, for a library that predates auto-download or a
 *  bridge that opted out of it. Not gated on the Settings → General toggle: it is an action, not a
 *  preference, and the toggle's own offer only ever runs the moment it is switched on. */
export function useBridgeDownloadLibrarySection(bridgeId: string): SettingsFormSection {
  const ds = useDataSource();
  const mock = useMockActive();
  const offer = () => {
    if (mock) return;
    void librarySize(bridgeId)
      .then((size) => {
        if (size.series === 0) {
          showToast(size.skipped > 0 ? 'Everything saved from this bridge is already downloaded' : 'No saved series from this bridge');
          return;
        }
        openConfirm({
          title: 'Download saved series?',
          message: describeBackfill(size, 'from this bridge'),
          confirmLabel: `Download ${size.series} series`,
          tone: 'primary',
          onConfirm: () => {
            void autoDownloadLibrary(ds, mock, bridgeId).then((n) =>
              showToast(n > 0 ? `Downloading ${n} series` : 'Nothing to download'),
            );
          },
        });
      })
      .catch(() => {});
  };
  return {
    title: 'Downloads',
    fields: [
      {
        kind: 'action',
        testID: 'settings.bridge.download-library',
        label: 'Download saved series',
        description: "Queue every chapter of this bridge's series in your library.",
        onPress: offer,
      },
    ],
  };
}

/** App-local toggle: whether this bridge takes part in the synthetic "Comical" aggregate — its home
 *  rails and its cross-bridge search. Persisted via `useComicalExcluded`. */
export function useComicalHomeSection(bridgeId: string): SettingsFormSection {
  const [excluded, setExcluded] = useComicalExcluded(bridgeId);
  return {
    title: 'Comical',
    fields: [
      {
        kind: 'toggle',
        label: 'Include in Comical',
        description: 'Show this bridge on the cross-bridge home and in its search.',
        value: !excluded,
        onChange: (show) => setExcluded(!show),
      },
    ],
  };
}

const styles = StyleSheet.create({
  editor: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: SettingsCardInset,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  suggestions: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  saveBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
});
