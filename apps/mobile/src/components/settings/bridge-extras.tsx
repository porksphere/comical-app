import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChipRow } from '@/components/chip';
import { SettingsSelectRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { useComicalExcluded } from '@/data/comical-home';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { ApiBridgeInfo, ContentRating } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
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
 *  matching comical-web's `buildBridgeMetadata` in `comical-web/client/app.ts`. */
export function BridgeMetaInfo({ info }: { info: ApiBridgeInfo }) {
  // On-device, `info` is the bridge's raw self-reported metadata (never re-validated by the contract
  // schema the remote server enforces), so these arrays can be absent — guard like every other
  // consumer does (host-rn's `capabilities.ts`, host-server's `router.ts`), or the settings screen
  // crashes with "undefined is not a function" on the first `.join`/`.length`.
  const capabilities = info.capabilities ?? [];
  const languages = info.languages ?? [];
  return (
    <>
      {/* Untitled: this is the top of the bridge's own settings screen, whose TopBar already carries
          the bridge's name — a heading restating it just pushed the facts down a row. */}
      <SettingsSection>
        <SettingsRow label="Version" right={<ThemedText type="small">{info.version}</ThemedText>} />
        <SettingsRow label="Contract" right={<ThemedText type="small">{info.contractVersion}</ThemedText>} />
        <SettingsRow label="Languages" right={<ThemedText type="small">{languages.join(', ')}</ThemedText>} />
        <SettingsRow label="Content" right={<ThemedText type="small">{info.nsfw ? 'NSFW' : 'SFW'}</ThemedText>} />
        {info.rateLimit && (info.rateLimit.maxConcurrent !== undefined || info.rateLimit.minIntervalMs !== undefined) && (
          <SettingsRow
            label="Rate limit"
            right={
              <ThemedText type="small">
                {[
                  info.rateLimit.maxConcurrent !== undefined ? `${info.rateLimit.maxConcurrent} concurrent` : null,
                  info.rateLimit.minIntervalMs !== undefined ? `${info.rateLimit.minIntervalMs}ms interval` : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </ThemedText>
            }
          />
        )}
      </SettingsSection>
      {/* Its own section rather than a hand-rolled label above a chip row INSIDE the facts list. That
          label was `small`/sentence-case where every other heading on the screen is the section
          title's `smallBold`/uppercase, and its chips — a section child, so no row gutter escape and
          no row height — wrapped straight onto the divider beneath them. As a section it inherits
          both, and being last it has no divider to crowd. */}
      {capabilities.length > 0 && (
        <SettingsSection title="Capabilities">
          <ChipRow labels={capabilities.map(capabilityLabel)} accent />
        </SettingsSection>
      )}
    </>
  );
}

/** Free-form excluded-tag editor with live autocomplete (capability "exclude-tags"), mirroring
 *  comical-web's `buildExcludedTagsControl`. */
export function TagExclusionsControl({
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
      // goes stale until the screen is torn down and remounted (e.g. leaving and re-entering
      // Bridge Settings).
      await queryClient.invalidateQueries({ queryKey: queryKeys.bridgeSettings(bridgeId) });
    },
  });
  const saving = saveMutation.isPending;
  const save = () => saveMutation.mutate();

  return (
    <SettingsSection title="Excluded tags">
      <ThemedText type="small" themeColor="textSecondary">
        Series carrying these tags are hidden from this bridge&apos;s lists and search.
      </ThemedText>
      {tags.length > 0 && (
        <View style={styles.tagRow}>
          {tags.map((t) => (
            <Pressable key={t.id} testID={testId('settings.bridge.excluded-tag', t.id)} onPress={() => removeTag(t.id)} hitSlop={4}>
              <View style={[styles.tagChip, { borderColor: theme.chipBorder }]}>
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
    </SettingsSection>
  );
}

const CONTENT_RATING_OPTIONS: SettingsOption<string>[] = [
  { value: '', label: 'No limit' },
  { value: 'everyone', label: 'Everyone' },
  { value: 'mature', label: 'Mature' },
  { value: 'adult', label: 'Adult' },
];

/** Max content-rating ceiling picker (capability "content-rating") — series rated above the chosen
 *  tier are hidden the same way `TagExclusionsControl`'s exclusions are, but the redaction itself is
 *  entirely host-side (the rating already travels on the item). */
export function MaxContentRatingControl({
  bridgeId,
  initialRating,
}: {
  bridgeId: string;
  initialRating: ContentRating | null;
}) {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: (rating: ContentRating | null) => ds.putMaxContentRating(bridgeId, rating),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bridgeSettings(bridgeId) });
    },
  });

  return (
    <SettingsSection title="Content rating">
      <SettingsSelectRow
        label="Maximum content rating"
        description="Series rated above this are hidden from this bridge's lists and search."
        value={initialRating ?? ''}
        options={CONTENT_RATING_OPTIONS}
        onChange={(v) => saveMutation.mutate(v === '' ? null : (v as ContentRating))}
        heading="Maximum content rating"
      />
    </SettingsSection>
  );
}

/** "Disable tracker sync" / "Don't track reading history" toggles from
 *  `GET|PUT /library/bridges/{id}/prefs` — renders nothing when the server has no library store
 *  mounted (`getBridgePrefs` resolves `null`). */
export function BridgePrefsToggles({ bridgeId }: { bridgeId: string }) {
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

  if (!data) return null;

  return (
    <SettingsSection title="Library">
      <SettingsRow
        label="Disable tracker sync for this bridge"
        right={<ThemedSwitch value={data.trackersDisabled} onValueChange={(v) => set({ trackersDisabled: v })} />}
      />
      <SettingsRow
        label="Don't track reading history for this bridge"
        right={<ThemedSwitch value={data.historyDisabled} onValueChange={(v) => set({ historyDisabled: v })} />}
      />
    </SettingsSection>
  );
}

/** App-local toggle: whether this bridge contributes a rail to the synthetic "Comical" aggregate home
 *  (cross-bridge search is unaffected). Persisted via `useComicalExcluded`. */
export function ComicalHomeToggle({ bridgeId }: { bridgeId: string }) {
  const [excluded, setExcluded] = useComicalExcluded(bridgeId);
  return (
    <SettingsSection title="Comical home">
      <SettingsRow
        label="Show on Comical home"
        description="Include this bridge's rail in the cross-bridge home."
        right={<ThemedSwitch value={!excluded} onValueChange={(show) => setExcluded(!show)} />}
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
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
  enumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    // Reserves the hover border's space up front so it doesn't shift layout by a
    // pixel when it appears — only the color changes.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  enumSummary: {
    flex: 1,
  },
  // No `flex: 1` (see `sheetBody` in overlay.tsx for why) — this just hugs
  // its `MeasuredHeader`/`OptionList` content, both of which already size
  // themselves to a real number.
  body: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  pressableCursor: {
    cursor: 'pointer',
  },
});
