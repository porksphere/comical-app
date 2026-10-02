import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { SearchIcon } from '@/components/icons/ui-icons';
import { SearchField } from '@/components/search-field';
import { Spacing } from '@/constants/theme';
import { useHasSidebar } from '@/hooks/use-content-width';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useTheme } from '@/hooks/use-theme';

export type TabFilter = ReturnType<typeof useTabFilter>;

/**
 * The in-place filter Library, History and Activity share: the screen narrows what it already shows
 * as you type. Ctrl+F focuses it on whichever tab is in front.
 *
 * Beside the rail it is a field that is always in the bar's trailing slot, emptied rather than
 * closed. Below the rail there is no room for one next to the title, so an icon opens it in the
 * title's place, with a back chevron that closes it.
 *
 * Not the Search screen's job: that one finds series you DON'T have, across bridges, on submit.
 */
export function useTabFilter() {
  const docked = useHasSidebar();
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const close = () => {
    setOpened(false);
    setQuery('');
  };
  const show = () => setOpened(true);
  useKeyboardShortcut(
    'f',
    () => {
      if (!docked) setOpened(true);
      setFocusRequest((n) => n + 1);
    },
    { focused: true },
  );
  // A query typed beside the rail outlives a resize below it, where it keeps the field open rather
  // than filtering the screen out of sight.
  const open = !docked && (opened || !!query);
  return { docked, open, query, setQuery, focusRequest, show, close };
}

/** The bar's leading content while the filter is open: a back chevron that closes it, and the field. */
export function TabFilterField({ filter, testID, placeholder }: { filter: TabFilter; testID: string; placeholder: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        testID={`${testID}-close`}
        onPress={filter.close}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close filter"
        style={styles.close}>
        <ChevronLeftIcon color={theme.text} />
      </Pressable>
      <View style={styles.field}>
        <SearchField
          testID={testID}
          value={filter.query}
          onChangeText={filter.setQuery}
          onSubmit={filter.setQuery}
          onClear={() => filter.setQuery('')}
          placeholder={placeholder}
          focusRequest={filter.focusRequest}
          autoFocus
          immediateFocus
        />
      </View>
    </View>
  );
}

/** The bar's trailing filter control: the field itself beside the rail, an icon that opens it below. */
export function TabFilterTrigger({ filter, testID, placeholder }: { filter: TabFilter; testID: string; placeholder: string }) {
  const theme = useTheme();
  if (filter.open) return null;
  return filter.docked ? (
    <View style={styles.docked}>
      <SearchField
        testID={testID}
        value={filter.query}
        onChangeText={filter.setQuery}
        onSubmit={filter.setQuery}
        onClear={() => filter.setQuery('')}
        placeholder={placeholder}
        focusRequest={filter.focusRequest}
      />
    </View>
  ) : (
    <Pressable
      testID={`${testID}-icon`}
      onPress={filter.show}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={placeholder.replace('…', '')}
      style={styles.icon}>
      <SearchIcon color={theme.text} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  close: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  field: {
    flex: 1,
  },
  icon: {
    padding: Spacing.one,
  },
  // The width of Browse's search pill, which sits in the same slot.
  docked: {
    width: 260,
  },
});
