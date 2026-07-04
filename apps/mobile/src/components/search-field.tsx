import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, type TextStyle } from 'react-native';

import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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
}: {
  value: string;
  onSubmit: (q: string) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const theme = useTheme();
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  // Keep the field in sync when the committed query is cleared elsewhere.
  useEffect(() => setText(value), [value]);

  // On mobile web the soft keyboard can be dismissed without the input firing a
  // blur (e.g. Android's "hide keyboard" button keeps DOM focus), which would
  // leave the focus highlight stuck on. While focused, watch the visual viewport
  // and drop the highlight when it grows back — i.e. the keyboard closes.
  useEffect(() => {
    if (Platform.OS !== 'web' || !focused) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let prevHeight = vv.height;
    const onResize = () => {
      if (vv.height > prevHeight + 120) setFocused(false);
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
    paddingVertical: Spacing.three,
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
