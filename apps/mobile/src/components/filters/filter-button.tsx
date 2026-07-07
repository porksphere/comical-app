import { memo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextStyle } from 'react-native';

import { useAnchoredOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

import { FilterEditor } from './filter-editors';
import {
  CONTROL_HEIGHT,
  CONTROL_RADIUS,
  emptyText,
  summarize,
  type FilterDef,
  type FilterValue,
} from './filter-types';
import { OverflowChips } from './overflow-chips';

// Suppress react-native-web's default focus outline on the <input> so the
// row's own border carries the focus highlight instead (matches SearchField).
// No-op on native.
const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

/**
 * A filter row: shows the filter's label and a summary of the current value as
 * chips (included = blue, excluded = red), collapsing overflow into "+X". Tapping
 * opens the matching editor in an overlay. The same row is used both inline on the
 * filter bar and stacked in the overflow sheet, so they read identically.
 *
 * `toggle`/`string`/`number` filters are single-value fields with nothing to pick
 * from a list, so they skip the overlay entirely and edit directly on this row
 * (see the dispatch below) — only `multi`/`includeExclude`/`tags` still open one.
 *
 * `onChange` takes the filter's own id (rather than the caller binding it into a
 * fresh closure per filter) so `React.memo` below actually holds: with a stable
 * `onChange` reference from the caller, only the one row whose own `value`
 * changed re-renders, not every filter in the bar.
 */
export const FilterButton = memo(function FilterButton({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (id: string, v: FilterValue) => void;
}) {
  switch (def.type) {
    case 'toggle':
      return <ToggleFilterRow def={def} value={value as boolean} onChange={onChange} />;
    case 'string':
      return <StringFilterRow def={def} value={value as string} onChange={onChange} />;
    case 'number':
      return <NumberFilterRow def={def} value={value as number} onChange={onChange} />;
    default:
      return <OverlayFilterRow def={def} value={value} onChange={onChange} />;
  }
});

/** `multi`/`includeExclude`/`tags` filters: opens the matching `FilterEditor` in
 *  an anchored overlay (sheet on phones, popover on desktop). */
function OverlayFilterRow({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (id: string, v: FilterValue) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, handlers } = useHover();
  const theme = useTheme();
  const chips = summarize(def, value);
  return (
    <Pressable
      ref={ref}
      {...handlers}
      onPress={() =>
        openAt(() => <FilterEditor def={def} value={value} onChange={(v) => onChange(def.id, v)} />)
      }>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {def.label}
        </ThemedText>
        <View style={styles.summary}>
          <OverflowChips items={chips} empty={emptyText(def)} />
        </View>
        <ThemedText themeColor="textSecondary">{'›'}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** A `toggle` filter: the whole row is the control — tapping anywhere flips it,
 *  and the row's own background switches to the accent colour to read as "on"
 *  (no separate switch/chevron, no overlay). */
function ToggleFilterRow({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'toggle' }>;
  value: boolean;
  onChange: (id: string, v: boolean) => void;
}) {
  const { hovered, handlers } = useHover();
  const theme = useTheme();
  const on = !!value;
  return (
    <Pressable {...handlers} onPress={() => onChange(def.id, !on)}>
      <ThemedView
        type="backgroundElement"
        style={[
          styles.row,
          on ? { backgroundColor: theme.accent } : hovered ? { backgroundColor: theme.backgroundSelected } : undefined,
        ]}>
        <ThemedText
          style={[styles.label, on && { color: theme.accentOn }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}>
          {def.label}
        </ThemedText>
        <View style={styles.summary} />
        <ThemedText style={{ color: on ? theme.accentOn : theme.textSecondary }}>{on ? 'On' : 'Off'}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** A `string` filter: an inline text field takes the place of the summary chips,
 *  editable directly with no overlay. */
function StringFilterRow({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'string' }>;
  value: string;
  onChange: (id: string, v: string) => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.row, { borderColor: focused ? theme.accent : 'transparent' }]}>
      <ThemedText style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {def.label}
      </ThemedText>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChange(def.id, t);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={def.placeholder ?? 'Type…'}
        placeholderTextColor={theme.textSecondary}
        style={[styles.inlineInput, NO_OUTLINE, { color: theme.text }]}
      />
    </ThemedView>
  );
}

/** A `number` filter: a −/+ stepper takes the place of the summary chips,
 *  editable directly with no overlay. */
function NumberFilterRow({
  def,
  value,
  onChange,
}: {
  def: Extract<FilterDef, { type: 'number' }>;
  value: number;
  onChange: (id: string, v: number) => void;
}) {
  const theme = useTheme();
  const step = def.step ?? 1;
  const n = value ?? def.default ?? def.min;
  const set = (next: number) => onChange(def.id, Math.min(def.max, Math.max(def.min, next)));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(n));
  const commit = () => {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) set(parsed);
    setEditing(false);
  };
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.row, { borderColor: editing ? theme.accent : 'transparent' }]}>
      <ThemedText style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {def.label}
      </ThemedText>
      <View style={styles.summary} />
      <View style={styles.stepper}>
        <StepperButton label="−" disabled={n <= def.min} onPress={() => set(n - step)} />
        {editing ? (
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            onSubmitEditing={commit}
            onBlur={commit}
            keyboardType="numeric"
            selectTextOnFocus
            style={[styles.stepperInput, NO_OUTLINE, { color: theme.text }]}
          />
        ) : (
          <Pressable
            onPress={() => {
              setText(String(n));
              setEditing(true);
            }}
            hitSlop={8}>
            <ThemedText style={styles.stepperValue}>
              {n}
              {def.unit ?? ''}
            </ThemedText>
          </Pressable>
        )}
        <StepperButton label="+" disabled={n >= def.max} onPress={() => set(n + step)} />
      </View>
    </ThemedView>
  );
}

function StepperButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { hovered, handlers } = useHover();
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} {...handlers}>
      <ThemedText
        style={[
          styles.stepperBtn,
          disabled ? styles.stepperBtnDisabled : hovered ? { color: theme.text } : { color: theme.textSecondary },
        ]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: CONTROL_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: CONTROL_RADIUS,
    // Reserve the border box always (transparent at rest, accent when editing —
    // see StringFilterRow/NumberFilterRow) so the focus highlight appears
    // without shifting layout, matching SearchField.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  // Shrinks (and, on native, scales its own font down via `adjustsFontSizeToFit`)
  // instead of the old fixed width, which let a long label like "Minimum
  // chapters" crowd the stepper's +/- buttons out of the row entirely once the
  // bar squashed narrow enough.
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
  summary: {
    flex: 1,
    minWidth: 0,
  },
  inlineInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    paddingVertical: 0,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Never shrink — the −/value/+ controls must stay fully visible; the label
    // gives way instead (see `label` above).
    flexShrink: 0,
  },
  stepperValue: {
    minWidth: 32,
    textAlign: 'center',
  },
  stepperInput: {
    minWidth: 32,
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 0,
  },
  stepperBtn: {
    fontSize: 20,
    fontWeight: '600',
    paddingHorizontal: Spacing.one,
  },
  stepperBtnDisabled: {
    opacity: 0.3,
  },
});
