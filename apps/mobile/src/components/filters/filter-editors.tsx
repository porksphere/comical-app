import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useKeyboardAvoidingInput,
  useOverlayPresentation,
} from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

import {
  CONTROL_HEIGHT,
  cycleTri,
  labelFor,
  type FilterDef,
  type FilterValue,
  type Option,
  type TriState,
  type TriValue,
} from './filter-types';

const INCLUDE = '#3478F6';
const EXCLUDE = '#E5484D';
// Selected-tag chip colours matched to the reference's `.ms-sel-chip`: a blue
// include / red exclude built from the same base hues (#2563eb / #dc2626) with
// the lighter text the source uses on the tinted fill.
const INCLUDE_CHIP = { text: '#60a5fa', border: 'rgba(37,99,235,0.5)', bg: 'rgba(37,99,235,0.13)' };
const EXCLUDE_CHIP = { text: '#f87171', border: 'rgba(220,38,38,0.5)', bg: 'rgba(220,38,38,0.13)' };

type EditorProps = { def: FilterDef; value: FilterValue; onChange: (v: FilterValue) => void };

/** Dispatches to the right editor for a filter type. Rendered inside an overlay sheet.
 *  `toggle`/`string`/`number` filters are edited directly on `FilterButton`'s own row
 *  (see filter-button.tsx) and never reach this overlay. */
export function FilterEditor({ def, value, onChange }: EditorProps) {
  switch (def.type) {
    case 'multi':
      return <MultiEditor def={def} value={value as string[]} onChange={onChange} />;
    case 'includeExclude':
      return <TriEditor def={def} options={def.options} value={value as TriState} onChange={onChange} />;
    case 'tags':
      return <TagSearchEditor def={def} value={value as TriState} onChange={onChange} />;
    case 'string':
    case 'toggle':
    case 'number':
      return null;
  }
}

function MultiEditor({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'multi' }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(value ?? []);
  const presentation = useOverlayPresentation();
  const toggle = (opt: string) => {
    // `single: true` (a mapped contract `select` filter) replaces instead of accumulating.
    const next = def.single
      ? selected.includes(opt)
        ? []
        : [opt]
      : selected.includes(opt)
        ? selected.filter((o) => o !== opt)
        : [...selected, opt];
    setSelected(next);
    onChange(next);
  };
  return (
    <View style={styles.body}>
      {/* On the popover, OverlayHeading renders nothing (the trigger row already
          names the filter) — skip the wrapper entirely there too, since `styles.body`'s
          flex `gap` would otherwise still reserve space before an empty sibling. */}
      {presentation !== 'popover' && (
        <MeasuredHeader>
          <OverlayHeading>{def.label}</OverlayHeading>
        </MeasuredHeader>
      )}
      <OptionList>
        {def.options.map((opt) => (
          <MultiRow
            key={opt.value}
            testID={testId('filter', def.id, 'option', opt.value)}
            label={opt.label}
            checked={selected.includes(opt.value)}
            onPress={() => toggle(opt.value)}
          />
        ))}
      </OptionList>
    </View>
  );
}

function MultiRow({ label, checked, onPress, testID }: { label: string; checked: boolean; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable testID={testID} onPress={onPress} {...handlers}>
      <ThemedView type="backgroundElement" style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText>{label}</ThemedText>
        <View style={[styles.check, checked && styles.checkOn]} />
      </ThemedView>
    </Pressable>
  );
}

function TriEditor({
  def,
  options,
  value,
  onChange,
}: {
  def: FilterDef;
  options: Option[];
  value: TriState;
  onChange: (v: TriState) => void;
}) {
  const [tri, setTri] = useState<TriState>(value ?? {});
  const press = (opt: string) => {
    const next: TriState = { ...tri };
    const cycled = cycleTri(next[opt]);
    if (cycled) next[opt] = cycled;
    else delete next[opt];
    setTri(next);
    onChange(next);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeader>
        <OverlayHeading>{def.label}</OverlayHeading>
        <ThemedText type="small" themeColor="textSecondary">
          Tap to include, tap again to exclude.
        </ThemedText>
      </MeasuredHeader>
      <OptionList>
        {options.map((opt) => (
          <TriRow
            key={opt.value}
            testID={testId('filter', def.id, 'option', opt.value)}
            label={opt.label}
            state={tri[opt.value]}
            onPress={() => press(opt.value)}
          />
        ))}
      </OptionList>
    </View>
  );
}

function TagSearchEditor({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'tags' }>;
  value: TriState;
  onChange: (v: TriState) => void;
}) {
  const theme = useTheme();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [tri, setTri] = useState<TriState>(value ?? {});
  const [query, setQuery] = useState('');

  // Static list (comical-app's own demo filters) filters client-side; a bridge-backed
  // tag-multiselect has no upfront list and searches live via `def.search`, debounced and cached
  // per (source, query) through react-query so repeating a search is instant and in-flight
  // duplicates dedupe. keepPreviousData keeps the last results on screen while the next search runs.
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const search = def.search;
  const tagSearch = useQuery({
    queryKey: queryKeys.tagSearch(def.searchKey ?? def.id, debouncedQuery),
    queryFn: () => search!(debouncedQuery),
    enabled: !def.options && !!search,
    placeholderData: keepPreviousData,
  });
  const remoteOptions = useMemo<Option[]>(() => tagSearch.data ?? [], [tagSearch.data]);
  // Labels for already-selected values can scroll out of `remoteOptions` once the query changes (or
  // a live search moves on), so remember every value/label pair a live search has ever returned —
  // not just the current page — for the chips. Unused for a static `def.options` list, which is
  // already exhaustive on its own.
  const [knownOptions, setKnownOptions] = useState<Option[]>([]);
  useEffect(() => {
    if (!tagSearch.data) return;
    setKnownOptions((prev) => {
      const map = new Map(prev.map((o) => [o.value, o.label]));
      for (const o of tagSearch.data) map.set(o.value, o.label);
      return Array.from(map, ([value, label]) => ({ value, label }));
    });
  }, [tagSearch.data]);

  const filtered = useMemo(() => {
    if (def.options) return def.options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));
    return remoteOptions;
  }, [def.options, remoteOptions, query]);

  // Selected tags (include first, then exclude) — shown as chips in place of the
  // title once anything is selected.
  const selected = useMemo(() => {
    const inc = Object.keys(tri).filter((k) => tri[k] === 'include');
    const exc = Object.keys(tri).filter((k) => tri[k] === 'exclude');
    return [
      ...inc.map((v) => ({ value: v, tone: 'include' as TriValue })),
      ...exc.map((v) => ({ value: v, tone: 'exclude' as TriValue })),
    ];
  }, [tri]);
  const press = (opt: string) => {
    const next: TriState = { ...tri };
    const cycled = cycleTri(next[opt]);
    if (cycled) next[opt] = cycled;
    else delete next[opt];
    setTri(next);
    onChange(next);
  };
  const remove = (opt: string) => {
    const next: TriState = { ...tri };
    delete next[opt];
    setTri(next);
    onChange(next);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeader>
        {selected.length > 0 ? (
          <View style={styles.tagChips}>
            {selected.map(({ value, tone }) => (
              <TagChip
                key={value}
                testID={testId('filter', def.id, 'remove', value)}
                label={labelFor(def.options ?? knownOptions, value, def.labelHints)}
                tone={tone}
                onRemove={() => remove(value)}
              />
            ))}
          </View>
        ) : (
          <OverlayHeading>{def.label}</OverlayHeading>
        )}
        <TextInput
          testID={testId('filter', def.id, 'search')}
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onFocus={() => keyboardAvoiding.onFocus(inputRef.current)}
          onBlur={keyboardAvoiding.onBlur}
          placeholder="Search tags…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Tap to include, tap again to exclude.
        </ThemedText>
      </MeasuredHeader>
      <OptionList fixed>
        {filtered.map((opt) => (
          <TriRow
            key={opt.value}
            testID={testId('filter', def.id, 'option', opt.value)}
            label={opt.label}
            state={tri[opt.value]}
            onPress={() => press(opt.value)}
          />
        ))}
        {filtered.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            No tags match “{query}”.
          </ThemedText>
        )}
      </OptionList>
    </View>
  );
}

function TriRow({
  label,
  state,
  onPress,
  testID,
}: {
  label: string;
  state: TriValue | undefined;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  const color = state === 'include' ? INCLUDE : state === 'exclude' ? EXCLUDE : undefined;
  return (
    <Pressable testID={testID} onPress={onPress} {...handlers}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        {/* Unselected reads as normal (theme) text like the other selectors; the
            include/exclude colour is the differentiator once chosen. */}
        <Text style={[styles.triLabel, { color: color ?? theme.text }]}>{label}</Text>
        <View
          style={[
            styles.indicator,
            color ? { backgroundColor: color, borderColor: color } : undefined,
          ]}>
          {state === 'exclude' && <View style={styles.dash} />}
        </View>
      </ThemedView>
    </Pressable>
  );
}

/** A selected-tag pill (include = blue, exclude = red) with a × to deselect. */
function TagChip({
  label,
  tone,
  onRemove,
  testID,
}: {
  label: string;
  tone: TriValue;
  onRemove: () => void;
  testID?: string;
}) {
  const c = tone === 'include' ? INCLUDE_CHIP : EXCLUDE_CHIP;
  return (
    <View style={[styles.tagChip, { borderColor: c.border, backgroundColor: c.bg }]}>
      <Text style={[styles.tagChipText, { color: c.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Pressable testID={testID} onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
        <Text style={[styles.tagChipRemove, { color: c.text }]}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // No `flex: 1` (see `sheetBody` in overlay.tsx for why) — this just hugs
  // its `MeasuredHeader`/`OptionList` content, both of which already size
  // themselves to a real number.
  body: {
    gap: Spacing.three,
  },
  // Selected-tag chips shown in place of the title; same bottom spacing so the
  // header height stays steady as tags are added/removed.
  tagChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.one,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 4,
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tagChipRemove: {
    fontSize: 17,
    lineHeight: 18,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  // Same height as the filter bar's own rows (`CONTROL_HEIGHT`) so a genre/tag
  // checkbox row reads at the same size as the trigger it opened from.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: CONTROL_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  triLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  checkOn: {
    borderColor: INCLUDE,
    backgroundColor: INCLUDE,
  },
  indicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dash: {
    width: 8,
    height: 2,
    backgroundColor: '#ffffff',
    borderRadius: 1,
  },
});
