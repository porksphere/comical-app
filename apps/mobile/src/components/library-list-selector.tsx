import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

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
import type { LibraryListFilter } from '@/data/queries';
import type { LibraryList } from '@/data/types';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';

/**
 * The Library tab's top-bar view selector — the bridge-selector shape, reading "Library" (all
 * entries) by default and opening a menu to switch to "Unlisted" or any custom list. A trailing
 * "Manage lists…" action pushes the manage screen (create/rename/reorder/delete). It reads the lists
 * collection itself so the Library screen only owns the selected filter.
 */
export function LibraryListSelector({
  value,
  lists,
  onChange,
}: {
  value: LibraryListFilter;
  lists: LibraryList[];
  onChange: (value: LibraryListFilter) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const theme = useTheme();
  const { hovered, handlers } = useHover();

  const currentLabel = value === 'unlisted' ? 'Unlisted' : value ? (lists.find((l) => l.id === value)?.name ?? 'Library') : 'Library';

  return (
    <Pressable
      testID="library.list-selector"
      ref={ref}
      {...handlers}
      style={[styles.trigger, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() => openAt(() => <ListMenu value={value} lists={lists} onChange={onChange} />)}>
      <ThemedText numberOfLines={1} style={styles.triggerLabel}>
        {currentLabel}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.caret}>
        ▾
      </ThemedText>
    </Pressable>
  );
}

function ListMenu({
  value,
  lists,
  onChange,
}: {
  value: LibraryListFilter;
  lists: LibraryList[];
  onChange: (value: LibraryListFilter) => void;
}) {
  const { closeTop } = useOverlay();
  const router = useRouter();
  const presentation = useOverlayPresentation();

  const pick = (v: LibraryListFilter) => {
    onChange(v);
    closeTop();
  };

  return (
    <View style={styles.menu}>
      {presentation !== 'popover' && (
        <MeasuredHeader>
          <OverlayHeading>Library</OverlayHeading>
        </MeasuredHeader>
      )}
      <OptionList>
        <ViewRow testID="library.list.all" label="Library" hint="All series" selected={value === null} onPress={() => pick(null)} />
        <ViewRow
          testID="library.list.unlisted"
          label="Unlisted"
          hint="Not in any list"
          selected={value === 'unlisted'}
          onPress={() => pick('unlisted')}
        />
        {lists.map((l) => (
          <ViewRow
            key={l.id}
            testID={`library.list.${l.id}`}
            label={l.name}
            selected={value === l.id}
            onPress={() => pick(l.id)}
          />
        ))}
        <ActionRow
          testID="library.list.manage"
          label="Manage lists…"
          onPress={() => {
            closeTop();
            router.push('/manage-lists');
          }}
        />
      </OptionList>
    </View>
  );
}

function ViewRow({
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
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
        <View style={styles.rowText}>
          <ThemedText numberOfLines={1}>{label}</ThemedText>
          {hint ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {hint}
            </ThemedText>
          ) : null}
        </View>
        <View style={[styles.dot, selected && styles.dotOn]} />
      </ThemedView>
    </Pressable>
  );
}

function ActionRow({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable testID={testID} onPress={onPress} {...handlers}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={{ color: theme.accent }}>{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
  },
  triggerLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  caret: {
    fontSize: 18,
  },
  menu: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: RowHeight,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
  rowText: {
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
