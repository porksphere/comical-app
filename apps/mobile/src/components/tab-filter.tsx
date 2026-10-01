import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { SearchIcon } from '@/components/icons/ui-icons';
import { SearchField } from '@/components/search-field';
import { SearchPill } from '@/components/search-pill';
import { Spacing } from '@/constants/theme';
import { useHasSidebar } from '@/hooks/use-content-width';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useTheme } from '@/hooks/use-theme';

export type TabFilter = ReturnType<typeof useTabFilter>;

/**
 * The in-place filter Library, History and Activity share: the bar's trailing control opens a field
 * in place of the title, and the screen narrows what it already shows as you type. Ctrl+F opens it
 * (or refocuses it) on whichever tab is in front.
 *
 * Not the Search screen's job: that one finds series you DON'T have, across bridges, on submit.
 */
export function useTabFilter() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const show = () => setOpen(true);
  useKeyboardShortcut(
    'f',
    () => {
      setOpen(true);
      setFocusRequest((n) => n + 1);
    },
    { focused: true },
  );
  return { open, query, setQuery, focusRequest, show, close };
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

/** The bar's trailing control that opens the filter: the shared pill beside the rail, an icon below it. */
export function TabFilterTrigger({ filter, testID, placeholder }: { filter: TabFilter; testID: string; placeholder: string }) {
  const theme = useTheme();
  const railNav = useHasSidebar();
  if (filter.open) return null;
  return railNav ? (
    <SearchPill testID={`${testID}-pill`} onPress={filter.show} placeholder={placeholder} />
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
});
