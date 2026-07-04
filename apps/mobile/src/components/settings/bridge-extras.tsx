import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useAnchoredOverlay,
  useListMaxHeight,
} from '@/components/overlay/overlay';
import { ChipRow } from '@/components/chip';
import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { ApiBridgeInfo } from '@/data/api';
import { useDataSource } from '@/data/source';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';

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
  const [tags, setTags] = useState<{ id: string; label: string }[]>(() =>
    initialTags.map((id) => ({ id, label: initialLabels[id] ?? id })),
  );
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ value: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const results = await ds.getTags(bridgeId, query.trim(), controller.signal);
        setSuggestions(results.filter((r) => !tags.some((t) => t.id === r.value)));
      } catch {
        // stale/aborted request — ignore
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, bridgeId]);
  const visibleSuggestions = query.trim() ? suggestions : [];

  const addTag = (id: string, label: string) => {
    const trimmed = id.trim();
    if (!trimmed || tags.some((t) => t.id === trimmed)) return;
    setTags((prev) => [...prev, { id: trimmed, label: label || trimmed }]);
    setQuery('');
    setSuggestions([]);
    setDirty(true);
  };

  const removeTag = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await ds.putExcludedTags(bridgeId, tags);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

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
    queryKey: ['genreExclusions', bridgeId],
    queryFn: ({ signal }) => ds.getGenreExclusions(bridgeId, signal),
  });
  const [saving, setSaving] = useState(false);

  const toggle = async (selected: string[]) => {
    setSaving(true);
    try {
      await ds.putGenreExclusions(bridgeId, selected);
      await queryClient.invalidateQueries({ queryKey: ['genreExclusions', bridgeId] });
    } finally {
      setSaving(false);
    }
  };

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
        style={styles.pressableCursor}
        onPress={() =>
          openAt(() => (
            <GenrePicker
              available={data.available}
              excluded={data.excluded}
              onToggle={toggle}
            />
          ))
        }>
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
  const [headerHeight, setHeaderHeight] = useState(0);
  const maxHeight = useListMaxHeight(headerHeight);
  const [selected, setSelected] = useState(excluded);
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    onToggle(next);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeader onHeight={setHeaderHeight}>
        <OverlayHeading>Excluded genres</OverlayHeading>
      </MeasuredHeader>
      <OptionList maxHeight={maxHeight}>
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
    <Pressable onPress={onPress} onHoverIn={onHoverIn} onHoverOut={onHoverOut} style={styles.pressableCursor}>
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
    queryKey: ['bridgePrefs', bridgeId],
    queryFn: ({ signal }) => ds.getBridgePrefs(bridgeId, signal),
  });

  const set = async (update: { trackersDisabled?: boolean; historyDisabled?: boolean }) => {
    await ds.putBridgePrefs(bridgeId, update);
    await queryClient.invalidateQueries({ queryKey: ['bridgePrefs', bridgeId] });
  };

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
