import { Stack } from 'expo-router';

import type { TabFilter } from '@/components/tab-filter';

/**
 * The iOS native navigation bar for a tab screen whose only control is the filter: the title, and
 * the filter as the system search item. Rendered INSTEAD of TabTitleBar when NATIVE_HEADER — it
 * draws nothing itself, it only sets the screen's header options.
 *
 * `large` is the tab-root treatment: the title starts big under the bar and collapses into it on
 * scroll, so the heading is the title rather than the bar's items.
 *
 * The search bar is the integrated-button placement: a magnifier among the trailing items that
 * expands into the field on tap (iOS 26; an inline field under the title before that). Cancel
 * clears the query, which is what closing the custom field does too.
 */
export function NativeTabHeader({
  title,
  large,
  filter,
  placeholder,
}: {
  title: string;
  large?: boolean;
  filter?: TabFilter;
  placeholder?: string;
}) {
  return (
    <>
      <Stack.Title large={large}>{title}</Stack.Title>
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
