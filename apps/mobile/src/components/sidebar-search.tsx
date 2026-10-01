import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';

import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { Fonts, Spacing } from '@/constants/theme';
import SearchScreen from '@/app/search';
import { ContentWidthProvider } from '@/hooks/use-content-width';
import { useTheme } from '@/hooks/use-theme';
import { closeResultsPane } from '@/lib/results-pane';
import { closeSeriesPane } from '@/lib/series-pane';
import {
  closeSidebarSearch,
  setSidebarSearchTyped,
  sidebarSearchFocused,
  submitSidebarSearch,
  useSidebarSearch,
} from '@/lib/sidebar-search';

const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

/** With its margin, a destination row's height — the rail's rhythm rather than the bars'. */
const FIELD_HEIGHT = 40;

/** The rail's search field, in place of its Search row while the rail is expanded. */
export function SidebarSearchField({ hint }: { hint: string }) {
  const theme = useTheme();
  const { typed, focusPending } = useSidebarSearch();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focusPending) return;
    inputRef.current?.focus();
    sidebarSearchFocused();
  }, [focusPending]);

  // Both reveal the results: the pane covers the content region, and so do an open series and a
  // rail's "See all", which would otherwise sit over the results the field just asked for.
  const change = (text: string) => {
    setSidebarSearchTyped(text);
    if (!text.trim()) return;
    closeSeriesPane();
    closeResultsPane();
  };
  const submit = () => {
    submitSidebarSearch(typed);
    closeSeriesPane();
    closeResultsPane();
  };

  return (
    <View
      style={[
        styles.field,
        { backgroundColor: theme.backgroundElement, borderColor: focused ? theme.accent : 'transparent' },
      ]}>
      <SearchIcon color={theme.textSecondary} size={18} />
      <TextInput
        testID="sidebar.search.input"
        ref={inputRef}
        value={typed}
        onChangeText={change}
        onSubmitEditing={submit}
        onKeyPress={(e) => {
          if (e.nativeEvent.key !== 'Escape') return;
          closeSidebarSearch();
          inputRef.current?.blur();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Search all bridges"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, NO_OUTLINE, { color: theme.text }]}
      />
      {typed ? (
        <Pressable
          testID="sidebar.search.clear"
          onPress={closeSidebarSearch}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search">
          <ClearIcon color={theme.textSecondary} size={14} />
        </Pressable>
      ) : focused ? null : (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text>
      )}
    </View>
  );
}

/**
 * The rail field's results, over the content region exactly where a series pane goes — and beneath
 * one, so a series opened from these results covers them and its back returns to them.
 */
export function SearchPane({ left, width, top }: { left: number; width: number; top: number }) {
  const theme = useTheme();
  const { typed, query } = useSidebarSearch();
  return (
    <View
      testID="search.pane"
      style={[styles.pane, { left, width, paddingTop: top, backgroundColor: theme.background }]}>
      {/* Outside the tabs' provider, so it says what the slot's does: the rail is beside it. */}
      <ContentWidthProvider width={width} sidebar>
        <SearchScreen docked={{ query, typed, onClose: closeSidebarSearch }} />
      </ContentWidthProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: FIELD_HEIGHT,
    marginVertical: 2,
    paddingHorizontal: Spacing.three,
    borderRadius: FIELD_HEIGHT / 2,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.sans,
    fontSize: 15,
    padding: 0,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    opacity: 0.7,
  },
  // See SeriesPane: absolute and opaque over the slot, so closing it puts the grid back untouched.
  pane: { position: 'absolute', top: 0, bottom: 0 },
});
