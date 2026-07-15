import { useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform, Pressable, StyleSheet, TextInput, type TextStyle } from 'react-native';

import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { CONTROL_HEIGHT } from '@/components/filters/filter-types';
import { useTheme } from '@/hooks/use-theme';

// Suppress react-native-web's default focus outline on the <input> so the
// container border carries the focus highlight instead. No-op on native.
const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

/**
 * The shared search field used by Browse and Library: a pill with a leading
 * search icon, a trailing clear button, and a focus border that lights up in the
 * theme accent. `onSubmit` fires on the keyboard's search/return key; `onClear`
 * when the field is emptied via the ✕. Extracted from the Browse screen so both
 * top-level grids read identically (incl. the mobile-web keyboard-dismiss guard).
 */
export function SearchField({
  value,
  onSubmit,
  onClear,
  placeholder = 'Search…',
  autoFocus = false,
  testID,
}: {
  value: string;
  onSubmit: (q: string) => void;
  onClear: () => void;
  placeholder?: string;
  /** Focus the field (and raise the keyboard) on mount — used by the Search screen. */
  autoFocus?: boolean;
  /** Automation selector for the input; the clear button derives `${testID}.clear` (see src/lib/test-id.ts). */
  testID: string;
}) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  // Keep the field in sync when the committed query is cleared elsewhere.
  useEffect(() => setText(value), [value]);

  // Autofocus AFTER the screen's push/transition settles, not via the native `autoFocus` prop —
  // focusing (and raising the keyboard) during the in-transition makes the animation stutter. On
  // web there's no native transition, so it focuses on the next frame all the same.
  useEffect(() => {
    if (!autoFocus) return;
    const handle = InteractionManager.runAfterInteractions(() => inputRef.current?.focus());
    return () => handle.cancel();
  }, [autoFocus]);

  // On mobile web the soft keyboard can be dismissed without the input firing a
  // blur (e.g. Android's "hide keyboard" button keeps DOM focus). Previously this
  // just set `focused` to false directly, which desynced app state from the real
  // DOM focus (the <input> never actually lost it) — so reselecting the same
  // field never fired a fresh `focus` event, and the highlight never came back.
  // Calling `.blur()` instead forces a real DOM blur, so the state update comes
  // from the normal `onBlur` handler and a later tap fires a genuine `onFocus`.
  useEffect(() => {
    if (Platform.OS !== 'web' || !focused) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let prevHeight = vv.height;
    const onResize = () => {
      if (vv.height > prevHeight + 120) inputRef.current?.blur();
      prevHeight = vv.height;
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [focused]);

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.search, { borderColor: focused ? theme.accent : 'transparent' }]}>
      <SearchIcon color={theme.textSecondary} size={16} />
      <TextInput
        testID={`${testID}.input`}
        ref={inputRef}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => onSubmit(text)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.searchInput, NO_OUTLINE, { color: theme.text }]}
      />
      {text.length > 0 && (
        <Pressable
          testID={`${testID}.clear`}
          onPress={() => {
            setText('');
            onClear();
          }}
          hitSlop={8}
          accessibilityLabel="Clear search">
          <ClearIcon color={theme.textSecondary} size={14} />
        </Pressable>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Matches the filter bar's controls (`CONTROL_HEIGHT`) so the search field
    // and the filter/sort pills below it read as the same height.
    height: CONTROL_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    // Reserve the border box always (transparent at rest, accent on focus) so the
    // focus highlight appears without shifting layout.
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
});
