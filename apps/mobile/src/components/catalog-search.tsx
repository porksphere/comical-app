/**
 * The pieces of a "find this title in someone else's catalog" form, shared by the two directions it
 * runs in: a series looking itself up on a tracker (the series page's "+ Link tracker"), and a
 * tracker entry looking itself up on a bridge (the tracker import's row search). A row of sources,
 * a search field typed for you, and a short list of results to tap.
 */
import { Image } from 'expo-image';
import { useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { CheckIcon, ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { useKeyboardAvoidingInput, useSheetScroll } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTheme } from '@/hooks/use-theme';

const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);

/** Caps a sheet's body so a long result list stays reachable instead of overflowing past the
 *  screen. Reports its offset to the enclosing overlay sheet (`useSheetScroll`) so a downward drag
 *  at the top still chains into dismiss — same pattern as the filter sheet's `OptionList`. */
export function SheetScroll({ children }: { children: ReactNode }) {
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
      style={catalogSearchStyles.scroll}
      contentContainerStyle={catalogSearchStyles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </AnimatedScrollView>
  );
}

/**
 * The source picker: a segmented control, same shape as the chapters overview/all/read/unread tabs
 * (a filled bar, the active segment filled with the accent). `scroll` is for a list that may not fit
 * — the segments keep their natural width and the bar scrolls sideways instead of squeezing them.
 */
export function SourceTabs({
  sources,
  activeId,
  onSelect,
  testIDFor,
  scroll = false,
}: {
  sources: readonly { id: string; name: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  testIDFor: (id: string) => string;
  scroll?: boolean;
}) {
  const theme = useTheme();
  const tabs = sources.map((s) => (
    <Pressable
      key={s.id}
      testID={testIDFor(s.id)}
      onPress={() => onSelect(s.id)}
      style={[catalogSearchStyles.tab, !scroll && catalogSearchStyles.tabFill, s.id === activeId && { backgroundColor: theme.accent }]}>
      <ThemedText type="small" numberOfLines={1} style={s.id === activeId ? { color: theme.accentOn } : { color: theme.textSecondary }}>
        {s.name}
      </ThemedText>
    </Pressable>
  ));
  if (!scroll) {
    return (
      <ThemedView type="backgroundElement" style={[catalogSearchStyles.tabs, catalogSearchStyles.tabsRow]}>
        {tabs}
      </ThemedView>
    );
  }
  return (
    <ThemedView type="backgroundElement" style={catalogSearchStyles.tabs}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={catalogSearchStyles.tabsRow}>
        {tabs}
      </ScrollView>
    </ThemedView>
  );
}

// Suppress react-native-web's default focus outline (the field's own border carries the focus
// highlight instead) — same trick as the browse search field.
const NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' } }) as TextStyle | undefined;

/** The query box: a search glyph, the text, a clear button, and an accent border while focused.
 *  It keeps itself above the on-screen keyboard inside a sheet. */
export function CatalogSearchField({
  value,
  onChangeText,
  onSubmit,
  onClear,
  editable = true,
  testID,
  clearTestID,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  editable?: boolean;
  testID: string;
  clearTestID: string;
}) {
  const theme = useTheme();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  return (
    <ThemedView type="backgroundElement" style={[catalogSearchStyles.search, { borderColor: focused ? theme.accent : 'transparent' }]}>
      <SearchIcon color={theme.textSecondary} size={14} />
      <TextInput
        testID={testID}
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => {
          setFocused(true);
          keyboardAvoiding.onFocus(inputRef.current);
        }}
        onBlur={() => {
          setFocused(false);
          keyboardAvoiding.onBlur();
        }}
        placeholder="Search title…"
        placeholderTextColor={theme.textSecondary}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
        style={[catalogSearchStyles.searchInput, NO_OUTLINE, { color: theme.text }]}
      />
      {value.length > 0 && (
        <Pressable testID={clearTestID} onPress={onClear} hitSlop={8} accessibilityLabel="Clear search">
          <ClearIcon color={theme.textSecondary} size={12} />
        </Pressable>
      )}
    </ThemedView>
  );
}

/** One result: cover, title, a secondary line, and a check when it's the current choice. */
export function CatalogResultRow({
  thumbnailUrl,
  title,
  subtitle,
  selected = false,
  disabled,
  onPress,
  testID,
}: {
  thumbnailUrl?: string | undefined;
  title: string;
  subtitle?: string | undefined;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const thumb = useResolvedAsset(thumbnailUrl);
  return (
    <Pressable testID={testID} disabled={disabled} onPress={onPress} accessibilityState={{ selected }}>
      <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={catalogSearchStyles.resultRow}>
        <Image source={thumb ? { uri: thumb } : undefined} style={catalogSearchStyles.resultThumb} />
        <View style={catalogSearchStyles.resultText}>
          <ThemedText type="small" numberOfLines={1} style={catalogSearchStyles.resultTitle}>
            {title}
          </ThemedText>
          {!!subtitle && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          )}
        </View>
        {selected && <CheckIcon color={theme.accent} size={16} />}
      </ThemedView>
    </Pressable>
  );
}

export const catalogSearchStyles = StyleSheet.create({
  scroll: {
    maxHeight: 420,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.one,
  },
  form: {
    gap: Spacing.two,
  },
  tabs: {
    ...ContinuousCorner,
    borderRadius: 10,
    padding: 3,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  tab: {
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    ...ContinuousCorner,
    borderRadius: 8,
  },
  tabFill: {
    flex: 1,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    ...ContinuousCorner,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  results: {
    gap: Spacing.one,
  },
  resultsEmpty: {
    paddingVertical: Spacing.two,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    ...ContinuousCorner,
    borderRadius: 8,
  },
  resultThumb: {
    width: 28,
    height: 42,
    borderRadius: 4,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  resultText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  resultTitle: {
    fontWeight: '600',
  },
});
