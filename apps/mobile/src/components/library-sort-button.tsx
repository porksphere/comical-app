import { Pressable, StyleSheet, View } from 'react-native';

import { SortIcon } from '@/components/icons/ui-icons';
import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useAnchoredOverlay,
  useOverlay,
  useOverlayPresentation,
} from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RowHeight, Spacing } from '@/constants/theme';
import type { LibrarySort } from '@/data/api';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

// Sort options shown in the menu, mapped to the `/library?sort=` param.
const SORT_LABELS: Record<LibrarySort, string> = {
  added: 'Recently added',
  lastRead: 'Last read',
  title: 'Title',
  unread: 'Unread',
};
const SORT_ORDER: LibrarySort[] = ['added', 'lastRead', 'title', 'unread'];

/**
 * The Library top bar's sort trigger — an icon button (mirrors the search icon beside it) that opens
 * a single-select overlay menu of the library sort orders. Replaces the old full-text `Selector`
 * that sat in the grid header. The selected value is owned by the screen (persisted per list — see
 * `use-library-sort`).
 */
export function LibrarySortButton({ value, onChange }: { value: LibrarySort; onChange: (s: LibrarySort) => void }) {
  const { ref, openAt } = useAnchoredOverlay();
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      testID="library.sort"
      ref={ref}
      {...handlers}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Sort library"
      style={[styles.button, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() => openAt(() => <SortMenu value={value} onChange={onChange} />)}>
      <SortIcon color={theme.text} size={22} />
    </Pressable>
  );
}

function SortMenu({ value, onChange }: { value: LibrarySort; onChange: (s: LibrarySort) => void }) {
  const { closeTop } = useOverlay();
  const presentation = useOverlayPresentation();
  return (
    <View style={styles.menu}>
      {presentation !== 'popover' && (
        <MeasuredHeader>
          <OverlayHeading>Sort by</OverlayHeading>
        </MeasuredHeader>
      )}
      <OptionList>
        {SORT_ORDER.map((s) => (
          <SortRow
            key={s}
            testID={`library.sort.${s}`}
            label={SORT_LABELS[s]}
            selected={s === value}
            onPress={() => {
              onChange(s);
              closeTop();
            }}
          />
        ))}
      </OptionList>
    </View>
  );
}

function SortRow({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable testID={testID} onPress={onPress} {...handlers}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={styles.rowLabel} numberOfLines={1}>
          {label}
        </ThemedText>
        <View style={[styles.dot, selected && styles.dotOn]} />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: Spacing.one,
    borderRadius: Spacing.two,
  },
  menu: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: RowHeight,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowLabel: {
    flex: 1,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  dotOn: {
    borderColor: '#3478F6',
    backgroundColor: '#3478F6',
  },
});
