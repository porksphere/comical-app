import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { MeasuredHeader, OptionList, OverlayHeading, useListMaxHeight } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import {
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

/** Dispatches to the right editor for a filter type. Rendered inside an overlay sheet. */
export function FilterEditor({ def, value, onChange }: EditorProps) {
  switch (def.type) {
    case 'string':
      return <StringEditor def={def} value={value as string} onChange={onChange} />;
    case 'toggle':
      return <ToggleEditor def={def} value={value as boolean} onChange={onChange} />;
    case 'number':
      return <NumberEditor def={def} value={value as number} onChange={onChange} />;
    case 'multi':
      return <MultiEditor def={def} value={value as string[]} onChange={onChange} />;
    case 'includeExclude':
      return <TriEditor def={def} options={def.options} value={value as TriState} onChange={onChange} />;
    case 'tags':
      return <TagSearchEditor def={def} value={value as TriState} onChange={onChange} />;
  }
}

function ToggleEditor({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'toggle' }>;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[styles.body, styles.toggleRow]}>
      <OverlayHeading>{def.label}</OverlayHeading>
      <Switch value={!!value} onValueChange={onChange} />
    </View>
  );
}

function StringEditor({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'string' }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(value ?? '');
  return (
    <View style={styles.body}>
      <OverlayHeading>{def.label}</OverlayHeading>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChange(t);
        }}
        placeholder={def.placeholder ?? 'Type…'}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
    </View>
  );
}

function NumberEditor({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'number' }>;
  value: number;
  onChange: (v: number) => void;
}) {
  const step = def.step ?? 1;
  const [n, setN] = useState(value ?? def.default ?? def.min);
  const set = (next: number) => {
    const clamped = Math.min(def.max, Math.max(def.min, next));
    setN(clamped);
    onChange(clamped);
  };
  return (
    <View style={styles.body}>
      <OverlayHeading>{def.label}</OverlayHeading>
      <View style={styles.stepper}>
        <StepperButton label="−" disabled={n <= def.min} onPress={() => set(n - step)} />
        <ThemedText type="title" style={styles.stepperValue}>
          {n}
          {def.unit ?? ''}
        </ThemedText>
        <StepperButton label="+" disabled={n >= def.max} onPress={() => set(n + step)} />
      </View>
    </View>
  );
}

function StepperButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={disabled ? styles.stepBtnDisabled : undefined}>
      <ThemedView type="backgroundSelected" style={styles.stepBtn}>
        <ThemedText type="title">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
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
  const [headerHeight, setHeaderHeight] = useState(0);
  const maxHeight = useListMaxHeight(headerHeight);
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
      <MeasuredHeader onHeight={setHeaderHeight}>
        <OverlayHeading>{def.label}</OverlayHeading>
      </MeasuredHeader>
      <OptionList maxHeight={maxHeight}>
        {def.options.map((opt) => (
          <Pressable key={opt.value} onPress={() => toggle(opt.value)}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText>{opt.label}</ThemedText>
              <View style={[styles.check, selected.includes(opt.value) && styles.checkOn]} />
            </ThemedView>
          </Pressable>
        ))}
      </OptionList>
    </View>
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
  const [headerHeight, setHeaderHeight] = useState(0);
  const maxHeight = useListMaxHeight(headerHeight);
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
      <MeasuredHeader onHeight={setHeaderHeight}>
        <OverlayHeading>{def.label}</OverlayHeading>
        <ThemedText type="small" themeColor="textSecondary">
          Tap to include, tap again to exclude.
        </ThemedText>
      </MeasuredHeader>
      <OptionList maxHeight={maxHeight}>
        {options.map((opt) => (
          <TriRow key={opt.value} label={opt.label} state={tri[opt.value]} onPress={() => press(opt.value)} />
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
  const [tri, setTri] = useState<TriState>(value ?? {});
  const [query, setQuery] = useState('');
  const [headerHeight, setHeaderHeight] = useState(0);
  const maxHeight = useListMaxHeight(headerHeight);

  // Static list (comical-app's own demo filters) filters client-side; a bridge-backed
  // tag-multiselect has no upfront list and searches live via `def.search`, debounced.
  const [remoteOptions, setRemoteOptions] = useState<Option[]>([]);
  // Labels for already-selected values can scroll out of `remoteOptions` once
  // the query changes (or a live search moves on), so remember every
  // value/label pair a live search has ever returned — not just the page —
  // for the chips. Unused for a static `def.options` list, which is already
  // exhaustive on its own.
  const [knownOptions, setKnownOptions] = useState<Option[]>([]);
  useEffect(() => {
    if (def.options || !def.search) return;
    const search = def.search;
    const t = setTimeout(() => {
      search(query.trim())
        .then((opts) => {
          setRemoteOptions(opts);
          setKnownOptions((prev) => {
            const map = new Map(prev.map((o) => [o.value, o.label]));
            for (const o of opts) map.set(o.value, o.label);
            return Array.from(map, ([value, label]) => ({ value, label }));
          });
        })
        .catch(() => setRemoteOptions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [def.options, def.search, query]);

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
      <MeasuredHeader onHeight={setHeaderHeight}>
        {selected.length > 0 ? (
          <View style={styles.tagChips}>
            {selected.map(({ value, tone }) => (
              <TagChip
                key={value}
                label={labelFor(def.options ?? knownOptions, value)}
                tone={tone}
                onRemove={() => remove(value)}
              />
            ))}
          </View>
        ) : (
          <OverlayHeading>{def.label}</OverlayHeading>
        )}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search tags…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Tap to include, tap again to exclude.
        </ThemedText>
      </MeasuredHeader>
      <OptionList fixed maxHeight={maxHeight}>
        {filtered.map((opt) => (
          <TriRow key={opt.value} label={opt.label} state={tri[opt.value]} onPress={() => press(opt.value)} />
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
}: {
  label: string;
  state: TriValue | undefined;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = state === 'include' ? INCLUDE : state === 'exclude' ? EXCLUDE : undefined;
  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
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
}: {
  label: string;
  tone: TriValue;
  onRemove: () => void;
}) {
  const c = tone === 'include' ? INCLUDE_CHIP : EXCLUDE_CHIP;
  return (
    <View style={[styles.tagChip, { borderColor: c.border, backgroundColor: c.bg }]}>
      <Text style={[styles.tagChipText, { color: c.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
        <Text style={[styles.tagChipRemove, { color: c.text }]}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperValue: {
    minWidth: 96,
    textAlign: 'center',
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
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
