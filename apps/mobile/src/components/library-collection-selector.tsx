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
import type { Collection } from '@/data/types';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

/**
 * The Library tab's top-bar view selector — the bridge-selector shape, reading "Library" (the tab,
 * i.e. everything collected) by default and opening a menu to switch to any collection. The menu's
 * own row for that view says "All", since "Library" there would collide with the default
 * collection sitting one row below it. One flat list, deliberately:
 * picking a collection shows THAT COLLECTION'S CONTENTS (its series, chapters and saved pages,
 * mixed), so there is nothing to split into per-type views — an earlier two-section version
 * ("collections" vs "saved pages") read as two competing lists of the same names and was cut.
 * A trailing "Manage collections…" action pushes the manage screen.
 */
export function LibraryCollectionSelector({
  value,
  collections,
  onChange,
}: {
  /** `null` = the library grid; a collection id = that collection's contents. */
  value: string | null;
  collections: Collection[];
  onChange: (value: string | null) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const theme = useTheme();
  const { hovered, handlers } = useHover();

  const currentLabel = value ? (collections.find((c) => c.id === value)?.name ?? 'Library') : 'Library';

  return (
    <Pressable
      testID="library.collection-selector"
      ref={ref}
      {...handlers}
      style={[styles.trigger, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() =>
        openAt(() => <CollectionMenu value={value} collections={collections} onChange={onChange} />)
      }>
      <ThemedText numberOfLines={1} style={styles.triggerLabel}>
        {currentLabel}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.caret}>
        ▾
      </ThemedText>
    </Pressable>
  );
}

function CollectionMenu({
  value,
  collections,
  onChange,
}: {
  value: string | null;
  collections: Collection[];
  onChange: (value: string | null) => void;
}) {
  const { closeTop } = useOverlay();
  const router = useRouter();
  const presentation = useOverlayPresentation();

  const pick = (v: string | null) => {
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
        {/* NOT "Library": the default collection is an ordinary row below, and while a freshly
            migrated shelf is the only thing in it, both rows list exactly the same series. Two rows,
            one word, one list. */}
        <ViewRow
          testID="library.collection.all"
          label="All"
          hint="Everything you've saved"
          selected={value === null}
          onPress={() => pick(null)}
        />
        {collections.map((c) => (
          <ViewRow
            key={c.id}
            testID={`library.collection.${c.id}`}
            label={c.name}
            selected={value === c.id}
            onPress={() => pick(c.id)}
          />
        ))}
        <ActionRow
          testID="library.collection.manage"
          label="Manage collections…"
          onPress={() => {
            closeTop();
            router.push('/manage-collections');
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
