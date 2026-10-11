import { Pressable, StyleSheet } from 'react-native';

import { MENU_MAX_ROWS, OptionList, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { CollectionThumb } from '@/components/collections/collection-thumb';
import { OptionActionRow, OptionMenu, OptionRow } from '@/components/overlay/option-menu';
import { useOptionThumbBox } from '@/components/selector';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { ALL_VIEW_NAMES, allItemsType, libraryViews } from '@/data/selected-collection';
import type { Collection } from '@/data/types';
import { useHover } from '@/hooks/use-hover';
import { useSavedItemKinds } from '@/hooks/use-saved-item-kinds';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

/**
 * The Library tab's top-bar view selector — the bridge-selector shape, reading "Library" for the
 * series grid and opening a menu to switch views. The saved kinds lead it (All Series, then All
 * Chapters / All Pages once any exist — each lists that kind whatever its collections, so unfiled
 * items have a home), then the collections, each showing its mixed contents. A trailing "Manage
 * collections…" action pushes the manage screen.
 */
export function LibraryCollectionSelector({
  value,
  collections,
  onChange,
}: {
  /** See `selected-collection.ts`. */
  value: string | null;
  collections: Collection[];
  onChange: (value: string | null) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  const kinds = useSavedItemKinds();

  const kind = allItemsType(value);
  const currentLabel =
    value === null
      ? 'Library'
      : kind
        ? ALL_VIEW_NAMES[kind]
        : (collections.find((c) => c.id === value)?.name ?? 'Library');
  // Rows, not collections: every view plus "Manage collections…".
  const rowCount = libraryViews(collections, kinds, value).length + 1;

  return (
    <Pressable
      testID="library.collection-selector"
      ref={ref}
      {...handlers}
      style={[styles.trigger, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() =>
        openAt(
          () => <CollectionMenu value={value} collections={collections} kinds={kinds} onChange={onChange} />,
          { popover: rowCount <= MENU_MAX_ROWS },
        )
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
  kinds,
  onChange,
}: {
  value: string | null;
  collections: Collection[];
  kinds: { chapter: boolean; page: boolean };
  onChange: (value: string | null) => void;
}) {
  const { closeTop } = useOverlay();
  const router = useRouter();
  const thumb = useOptionThumbBox();

  const pick = (v: string | null) => {
    onChange(v);
    closeTop();
  };

  const views = libraryViews(collections, kinds, value);

  return (
    <OptionMenu title="Library">
      <OptionList>
        {views.map((v) => (
          <OptionRow
            key={v.id ?? 'all'}
            testID={`library.collection.${v.testKey}`}
            label={v.name}
            selected={value === v.id}
            leading={<CollectionThumb view={v.id} name={v.name} size={thumb.size} style={thumb.style} />}
            onPress={() => pick(v.id)}
          />
        ))}
        <OptionActionRow
          testID="library.collection.manage"
          label="Manage collections…"
          onPress={() => {
            closeTop();
            router.push('/manage-collections');
          }}
        />
      </OptionList>
    </OptionMenu>
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
    ...ContinuousCorner,
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
});
