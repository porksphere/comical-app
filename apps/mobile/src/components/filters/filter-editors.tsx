import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { useSheetScroll } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import {
  cycleTri,
  type FilterDef,
  type FilterValue,
  type TriState,
  type TriValue,
} from './filter-types';

const INCLUDE = '#3478F6';
const EXCLUDE = '#E5484D';

type EditorProps = { def: FilterDef; value: FilterValue; onChange: (v: FilterValue) => void };

/** Dispatches to the right editor for a filter type. Rendered inside an overlay sheet. */
export function FilterEditor({ def, value, onChange }: EditorProps) {
  switch (def.type) {
    case 'string':
      return <StringEditor def={def} value={value as string} onChange={onChange} />;
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

function Title({ children }: { children: string }) {
  return (
    <ThemedText type="subtitle" style={styles.title}>
      {children}
    </ThemedText>
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
      <Title>{def.label}</Title>
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
      <Title>{def.label}</Title>
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
  const toggle = (opt: string) => {
    const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
    setSelected(next);
    onChange(next);
  };
  return (
    <View style={styles.body}>
      <Title>{def.label}</Title>
      <OptionList>
        {def.options.map((opt) => (
          <Pressable key={opt} onPress={() => toggle(opt)}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText>{opt}</ThemedText>
              <View style={[styles.check, selected.includes(opt) && styles.checkOn]} />
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
  options: string[];
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
      <Title>{def.label}</Title>
      <ThemedText type="small" themeColor="textSecondary">
        Tap to include, tap again to exclude.
      </ThemedText>
      <OptionList>
        {options.map((opt) => (
          <TriRow key={opt} label={opt} state={tri[opt]} onPress={() => press(opt)} />
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
  const filtered = useMemo(
    () => def.options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase())),
    [def.options, query],
  );
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
      <Title>{def.label}</Title>
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
      <OptionList fixed>
        {filtered.map((opt) => (
          <TriRow key={opt} label={opt} state={tri[opt]} onPress={() => press(opt)} />
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
  const color = state === 'include' ? INCLUDE : state === 'exclude' ? EXCLUDE : undefined;
  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <Text style={[styles.triLabel, color ? { color } : { color: undefined }]}>{label}</Text>
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

const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);

/** Caps long option lists with an internal scroll so the sheet stays usable.
 * `fixed` keeps a constant height (so the sheet doesn't resize while searching).
 *
 * Reports its scroll offset to the enclosing overlay sheet (and registers its
 * ref) so a downward drag at the top of the list chains into dismissing the
 * sheet. A gesture-handler ScrollView lets that drag run simultaneously with
 * this list's own scroll. */
function OptionList({ children, fixed }: { children: React.ReactNode; fixed?: boolean }) {
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
      style={fixed ? styles.listFixed : styles.list}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </AnimatedScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  title: {
    marginBottom: Spacing.one,
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
  list: {
    maxHeight: 360,
  },
  listFixed: {
    height: 360,
  },
  listContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.one,
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
