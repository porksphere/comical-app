import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { MeasuredHeader, OptionList, OverlayHeading, useAnchoredOverlay } from '@/components/overlay/overlay';
import { ChipRow } from '@/components/chip';
import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { useComicalExcluded } from '@/data/comical-home';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { ApiBridgeInfo } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight, hapticSelection } from '@/lib/haptics';

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
    <SettingsSection title="About this bridge">
      {capabilities.length > 0 && (
        <View style={styles.metaBlock}>
          <ThemedText type="small" themeColor="textSecondary">
            Capabilities
          </ThemedText>
          <ChipRow labels={capabilities} />
        </View>
      )}
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
      // Matches `GenreExclusionsControl` and the parent screen's own settings save: the
      // bridge-settings screen's `data.excludedTags`/`excludedTagLabels` came from this
      // same query, so without this it goes stale until the screen is torn down and
      // remounted (e.g. leaving and re-entering Bridge Settings).
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
            <Pressable key={t.id} onPress={() => removeTag(t.id)} hitSlop={4}>
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
            <Pressable key={s.value} onPress={() => addTag(s.value, s.label)} style={styles.suggestionRow}>
              <ThemedText type="small">{s.label}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {dirty && (
        <Pressable onPress={save} disabled={saving}>
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

/** Fixed-list excluded-genre editor (capability "exclude-genres"), mirroring comical-web's
 *  `buildExcludedGenresControl`. Loads its own `available`/`excluded` set — a separate round trip
 *  from `GET /bridges/{id}`, since genre exclusions live in the bridge's own backend account. */
export function GenreExclusionsControl({ bridgeId }: { bridgeId: string }) {
  const ds = useDataSource();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.genreExclusions(bridgeId),
    queryFn: ({ signal }) => ds.getGenreExclusions(bridgeId, signal),
  });
  const toggleMutation = useMutation({
    mutationFn: (selected: string[]) => ds.putGenreExclusions(bridgeId, selected),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.genreExclusions(bridgeId) });
    },
  });
  const saving = toggleMutation.isPending;
  const toggle = (selected: string[]) => toggleMutation.mutate(selected);

  if (isLoading) {
    return (
      <SettingsSection title="Excluded genres">
        <ActivityIndicator />
      </SettingsSection>
    );
  }
  if (error || !data) {
    return (
      <SettingsSection title="Excluded genres">
        <ThemedText type="small" themeColor="textSecondary">
          {(error as Error)?.message || 'Failed to load genres'}
        </ThemedText>
        <Pressable onPress={() => refetch()}>
          <ThemedText type="smallBold">Retry</ThemedText>
        </Pressable>
      </SettingsSection>
    );
  }

  const summary = data.excluded.length === 0 ? 'None excluded' : `${data.excluded.length} excluded`;

  return (
    <SettingsSection title="Excluded genres">
      <ThemedText type="small" themeColor="textSecondary">
        Series in these genres are hidden from this bridge&apos;s lists and search.
      </ThemedText>
      <Pressable
        ref={ref}
        disabled={saving}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
        android_ripple={{ color: theme.backgroundElement }}
        style={styles.pressableCursor}
        onPress={() => {
          hapticImpactLight();
          openAt(() => (
            <GenrePicker
              available={data.available}
              excluded={data.excluded}
              onToggle={toggle}
            />
          ));
        }}>
        {/* Always `backgroundSelected` — this row sits inside the `backgroundElement`
         *  `SettingsSection` card above, so resting on the same tier would make it
         *  invisible until touched (see the identical comment in setting-field.tsx). */}
        <ThemedView type="backgroundSelected" style={[styles.enumRow, hovered && { borderColor: theme.accent }]}>
          <ThemedText numberOfLines={1} style={styles.enumSummary}>
            {saving ? 'Saving…' : summary}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={16} />
        </ThemedView>
      </Pressable>
    </SettingsSection>
  );
}

function GenrePicker({
  available,
  excluded,
  onToggle,
}: {
  available: { id: string; label: string }[];
  excluded: string[];
  onToggle: (selected: string[]) => void;
}) {
  const [selected, setSelected] = useState(excluded);
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    onToggle(next);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeader>
        <OverlayHeading>Excluded genres</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
        {available.map((opt) => {
          const on = selected.includes(opt.id);
          return <GenreOption key={opt.id} label={opt.label} on={on} onPress={() => toggle(opt.id)} />;
        })}
      </OptionList>
    </View>
  );
}

function GenreOption({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <ThemedView type={hovered ? 'backgroundSelected' : 'backgroundElement'} style={styles.row}>
        <ThemedText>{label}</ThemedText>
        <View style={[styles.check, on && { borderColor: theme.accent, backgroundColor: theme.accent }]} />
      </ThemedView>
    </Pressable>
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
  metaBlock: {
    gap: Spacing.one,
  },
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
