import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance, type ViewStyle } from 'react-native';

import { GlassCapsule, SHELL_SEARCH_WIDTH } from '@/components/glass-surface';
import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { NO_OUTLINE, rowInput } from '@/components/input-style';
import { Fonts, Spacing } from '@/constants/theme';
import SearchScreen from '@/app/search';
import { ContentWidthProvider } from '@/hooks/use-content-width';
import { useOpenLink } from '@/hooks/use-open-link';
import { useTheme } from '@/hooks/use-theme';
import { closeBridgeSearchPane, useBridgeSearchPaneOpen } from '@/lib/bridge-search-pane';
import { closeResultsPane, useResultsPaneOpen } from '@/lib/results-pane';
import { usePaneTab } from '@/lib/pane-tab';
import { closeSeriesPane, useSeriesPaneParams } from '@/lib/series-pane';
import {
  closeSidebarSearch,
  setSidebarSearchTyped,
  sidebarSearchFocused,
  submitSidebarSearch,
  useSidebarSearch,
} from '@/lib/sidebar-search';
import { windowControlsLayer } from '@/lib/window-controls';

/**
 * The search field of the desktop layout: one, at the trailing end of every tab's bar, in place of
 * a field in the sidebar and another in the bar. The shell draws it over the content region rather
 * than each bar drawing its own, so it is the same field under the results it opens, focus and
 * text kept, where a field inside a bar would be covered by its own results pane.
 *
 * On Library and Recent what is typed narrows that tab in place, and Enter is what
 * searches the bridges (lib/sidebar-search): a filter field of the tab's own beside this one was
 * the two search bars over again.
 *
 * A series, a "See all" or a bridge's own search open over the content region with a bar of their
 * own, so the field stands down while one is up, and comes back for as long as it is being typed
 * into: the shortcut reaches it from anywhere, and its first letter closes what was over it.
 */
export function ShellSearchField({ hint, shown, style }: { hint: string; shown: boolean; style: ViewStyle }) {
  const theme = useTheme();
  const { typed, focusPending } = useSidebarSearch();
  const inputRef = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const openLink = useOpenLink();
  const seriesOpen = useSeriesPaneParams() !== null;
  const resultsOpen = useResultsPaneOpen();
  const bridgeSearchOpen = useBridgeSearchPaneOpen();
  const covered = seriesOpen || resultsOpen || bridgeSearchOpen;
  const visible = shown && (!covered || focused || focusPending);

  useEffect(() => {
    if (!focusPending) return;
    inputRef.current?.focus();
    sidebarSearchFocused();
  }, [focusPending]);

  // Both reveal the results: the pane covers the content region, and so do an open series, a rail's
  // "See all" and Browse's own Search, which would otherwise sit over the results the field asked for.
  const change = (text: string) => {
    setSidebarSearchTyped(text);
    if (!text.trim()) return;
    closeSeriesPane();
    closeResultsPane();
    closeBridgeSearchPane();
  };
  const submit = () => {
    // A link opens its series in the pane, which the closes below would take straight back down.
    if (openLink(typed)) return;
    submitSidebarSearch(typed);
    closeSeriesPane();
    closeResultsPane();
    closeBridgeSearchPane();
  };

  return (
    <GlassCapsule
      {...windowControlsLayer}
      style={[styles.field, style, focused && { borderColor: theme.accent }, !visible && styles.hidden]}>
      <SearchIcon color={theme.textSecondary} size={15} />
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
          onPress={() => closeSidebarSearch()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search">
          <ClearIcon color={theme.textSecondary} size={13} />
        </Pressable>
      ) : focused ? null : (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text>
      )}
    </GlassCapsule>
  );
}

/**
 * The field's results, over the content region exactly where a series pane goes — and beneath
 * one, so a series opened from these results covers them and its back returns to them.
 */
export function SearchPane({ left, width, top }: { left: number; width: number; top: number }) {
  const theme = useTheme();
  const { typed, query } = useSidebarSearch();
  const tab = usePaneTab();
  return (
    <View
      testID="search.pane"
      style={[styles.pane, { left, width, paddingTop: top, backgroundColor: theme.background }]}>
      {/* Outside the tabs' provider, so it says what the slot's does: the rail is beside it. */}
      <ContentWidthProvider width={width} sidebar>
        <SearchScreen docked={{ query, typed, onClose: () => closeSidebarSearch(tab) }} />
      </ContentWidthProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    position: 'absolute',
    width: SHELL_SEARCH_WIDTH,
    gap: Spacing.two,
    paddingHorizontal: 12,
  },
  // Mounted while out of sight, so the shortcut has an input to focus.
  hidden: {
    display: 'none',
  },
  input: {
    ...rowInput(13),
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.sans,
    padding: 0,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
  // See SeriesPane: absolute and opaque over the slot, so closing it puts the grid back untouched.
  pane: { position: 'absolute', top: 0, bottom: 0 },
});
