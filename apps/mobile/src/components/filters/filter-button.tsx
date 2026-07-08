import { memo, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';

import { useAnchoredOverlay, useKeyboardAvoidingInput } from '@/components/overlay/overlay';
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

const LABEL_FONT_SIZE = 16;
const LABEL_LINE_HEIGHT = 24;

/** A filter row's label. Renders at its natural size, full stop — no
 *  shrinking, no truncation. The label's own box (`styles.label`) can still
 *  flexShrink so it doesn't force the row wider than available space, but the
 *  `Text` inside isn't stretched/clipped to that box, so if the box ends up
 *  narrower than the text, the text just overflows past it rather than
 *  wrapping or ellipsizing. Whatever follows the label in the row (chips,
 *  value pill, on/off text) sits later in paint order and carries its own
 *  opaque-enough background, so it always renders in front of any overflow
 *  instead of getting visually clipped by it. */
function ShrinkToFitLabel({ children, color }: { children: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.label}>
      <Text style={[styles.labelText, { color: color ?? theme.text }]}>{children}</Text>
    </View>
  );
}

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
        <ShrinkToFitLabel>{def.label}</ShrinkToFitLabel>
        <View style={styles.summary}>
          <OverflowChips items={chips} empty={emptyText(def)} />
        </View>
        <ThemedText themeColor="textSecondary" style={styles.trailing}>
          {'›'}
        </ThemedText>
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
        <ShrinkToFitLabel color={on ? theme.accentOn : undefined}>{def.label}</ShrinkToFitLabel>
        <View style={styles.summary} />
        <ThemedText style={[styles.trailing, { color: on ? theme.accentOn : theme.textSecondary }]}>
          {on ? 'On' : 'Off'}
        </ThemedText>
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
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.row, { borderColor: focused ? theme.accent : 'transparent' }]}>
      <ShrinkToFitLabel>{def.label}</ShrinkToFitLabel>
      <TextInput
        ref={inputRef}
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChange(def.id, t);
        }}
        onFocus={() => {
          setFocused(true);
          keyboardAvoiding.onFocus(inputRef.current);
        }}
        onBlur={() => {
          setFocused(false);
          keyboardAvoiding.onBlur();
        }}
        placeholder={def.placeholder ?? 'Type…'}
        placeholderTextColor={`${theme.textSecondary}99`}
        style={[styles.inlineInput, NO_OUTLINE, { color: theme.text }]}
      />
    </ThemedView>
  );
}

/** A `number` filter: label + a chip-style value pill (matching the summary
 *  chips every other filter type shows at rest) that's directly editable in
 *  place — no popup, no layout shift. The *row* is the control, same as
 *  ToggleFilterRow/StringFilterRow: the whole row hover-tints, carries the
 *  accent focus border, and tapping anywhere on it (not just the small pill)
 *  focuses the input. The pill sizes to its own digits rather than a fixed
 *  width, so it never reserves more room than the value actually needs. */
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
  const { hovered, handlers } = useHover();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  // Snapshot at press-*start* (mousedown), before this same click's own focus
  // shift has happened — by press time (click), a blur triggered by this very
  // click has already fired, so checking "is it focused" there can never tell
  // us whether the click was opening the field or leaving it. Checking at
  // press-in avoids re-focusing an input the user just committed and left.
  const wasFocusedRef = useRef(false);
  const n = value ?? def.default ?? def.min;
  const [text, setText] = useState(String(n));
  const [focused, setFocused] = useState(false);
  // Keep the field in sync with external value changes (e.g. "clear filters")
  // while untouched; don't clobber the text mid-edit.
  useEffect(() => {
    if (!focused) setText(String(n));
  }, [n, focused]);

  const commit = () => {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(def.max, Math.max(def.min, parsed));
      onChange(def.id, clamped);
      // Reflect the clamped value immediately rather than waiting on `value`
      // to round-trip back through the caller's own state update — the two
      // can land in separate render passes, and in the gap `n` is still the
      // *pre-commit* number, so the `focused`-driven resync effect above would
      // reset `text` right back to the old value the instant it re-runs.
      setText(String(clamped));
    } else {
      setText(String(n));
    }
  };

  return (
    <Pressable
      {...handlers}
      onPressIn={() => {
        wasFocusedRef.current = inputRef.current?.isFocused() ?? false;
      }}
      onPress={() => {
        if (!wasFocusedRef.current) inputRef.current?.focus();
      }}>
      <ThemedView
        type="backgroundElement"
        style={[
          styles.row,
          { borderColor: focused ? theme.accent : 'transparent' },
          !focused && hovered && { backgroundColor: theme.backgroundSelected },
        ]}>
        <ShrinkToFitLabel>{def.label}</ShrinkToFitLabel>
        <View style={styles.summary} />
        <View style={styles.valuePill}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => {
              setFocused(true);
              keyboardAvoiding.onFocus(inputRef.current);
            }}
            onBlur={() => {
              setFocused(false);
              keyboardAvoiding.onBlur();
              commit();
            }}
            onSubmitEditing={commit}
            keyboardType="numeric"
            selectTextOnFocus
            // Sized to its own digits (plus a hair of padding), not a fixed
            // width — that's what makes the pill hug just the value's text.
            style={[
              styles.valueInput,
              NO_OUTLINE,
              { color: theme.text, width: Math.max(1, text.length) * 9 + 2 },
            ]}
          />
          {def.unit ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.unit}>
              {def.unit}
            </ThemedText>
          ) : null}
        </View>
      </ThemedView>
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
  // The allocated box for ShrinkToFitLabel: can flexShrink so a long label
  // gives way before it forces the row wider than available space, but the
  // Text inside it (styles.labelText) isn't stretched/clipped to match — see
  // ShrinkToFitLabel for why.
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
  labelText: {
    fontSize: LABEL_FONT_SIZE,
    lineHeight: LABEL_LINE_HEIGHT,
    fontWeight: '500',
  },
  // zIndex so chips/value always paint over an overflowing label rather than
  // getting visually covered by it (see ShrinkToFitLabel).
  summary: {
    flex: 1,
    minWidth: 0,
    zIndex: 1,
  },
  inlineInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 24,
    padding: 0,
    zIndex: 1,
  },
  // Same chip visual as OverflowChips' neutral tone, so a number filter's
  // value reads like every other filter's summary chip at rest — the
  // TextInput inside is what makes it directly editable in place. No border
  // of its own: the row (see NumberFilterRow) carries the focus highlight now,
  // not this inner pill.
  valuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.16)',
    zIndex: 1,
  },
  // No fixed/min width here — NumberFilterRow sets an explicit `width` inline
  // sized to the current text length, which is what makes the pill hug just
  // the digits instead of reserving extra space.
  valueInput: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    padding: 0,
  },
  unit: {
    flexShrink: 0,
  },
  // zIndex so this always paints over an overflowing label rather than
  // getting visually covered by it (see ShrinkToFitLabel).
  trailing: {
    zIndex: 1,
  },
});
