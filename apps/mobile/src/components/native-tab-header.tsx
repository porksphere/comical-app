import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { TabFilter } from '@/components/tab-filter';
import { useTheme } from '@/hooks/use-theme';

// The scroll over which the title goes: holds through a nudge, gone by about a bar's height.
const FADE_START = 8;
const FADE_END = 56;

/**
 * The iOS native navigation bar for a tab screen whose only control is the filter: the title, and
 * the filter as the system search item. Rendered INSTEAD of TabTitleBar when NATIVE_HEADER — it
 * draws nothing itself, it only sets the screen's header options.
 *
 * The title is the bar's inline one, not a large title that collapses: it sits in the bar and fades
 * out as the list scrolls down (`scrollY`, the list's content offset), back in at the top — the
 * bar stays one height, and the heading is the content once you're into it. A custom title view
 * (`asChild`) because the system title has no opacity to drive; the text is set to the system's
 * inline title metrics so at rest it is indistinguishable from one.
 *
 * The search bar is the integrated-button placement: a magnifier among the trailing items that
 * expands into the field on tap (iOS 26; an inline field under the title before that). Cancel
 * clears the query, which is what closing the custom field does too.
 */
export function NativeTabHeader({
  title,
  scrollY,
  filter,
  placeholder,
}: {
  title: string;
  /** The screen's live scroll offset; without one the title simply stays. */
  scrollY?: SharedValue<number>;
  filter?: TabFilter;
  placeholder?: string;
}) {
  const theme = useTheme();
  const still = useSharedValue(0);
  const y = scrollY ?? still;
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [FADE_START, FADE_END], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <>
      <Stack.Title asChild>
        <Animated.Text numberOfLines={1} style={[styles.title, { color: theme.text }, fade]}>
          {title}
        </Animated.Text>
      </Stack.Title>
      {filter ? (
        <Stack.SearchBar
          placeholder={placeholder}
          placement="integratedButton"
          onChangeText={(e) => filter.setQuery(e.nativeEvent.text)}
          onCancelButtonPress={filter.close}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // UIKit's inline navigation title: 17pt semibold in the system font.
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
});
