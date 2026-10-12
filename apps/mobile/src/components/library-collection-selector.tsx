import { Pressable, StyleSheet } from 'react-native';

import { MENU_MAX_ROWS, OptionList, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { CollectionThumb } from '@/components/collections/collection-thumb';
import { OptionActionRow, OptionMenu, OptionRow } from '@/components/overlay/option-menu';
import { Selector, useOptionThumbBox, useSubtitleSelectorStyle } from '@/components/selector';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import {
  ALL_VIEW_NAME,
  ITEM_KIND_LABELS,
  itemKindOptions,
  libraryViews,
  type ItemKind,
  type KindsPresent,
} from '@/data/selected-collection';
import type { Collection } from '@/data/types';
import { useHover } from '@/hooks/use-hover';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

/**
 * The Library tab's top-bar view selector — the bridge-selector shape, reading "All" or the
 * collection's name and opening a menu to switch between them. Either is narrowed to one kind by the
 * `LibraryKindSelector` beside it. A trailing "Manage collections…" action pushes the manage screen.
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
  const type = useSubtitleSelectorStyle();

  const currentLabel = (value && collections.find((c) => c.id === value)?.name) || ALL_VIEW_NAME;
  // Rows, not collections: every view plus "Manage collections…".
  const rowCount = libraryViews(collections).length + 1;

  return (
    <Pressable
      testID="library.collection-selector"
      ref={ref}
      {...handlers}
      style={[styles.trigger, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() =>
        openAt(
          () => <CollectionMenu value={value} collections={collections} onChange={onChange} />,
          { popover: rowCount <= MENU_MAX_ROWS },
        )
      }>
      <ThemedText numberOfLines={1} style={[styles.triggerLabel, type.label]}>
        {currentLabel}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={type.caret}>
        ▾
      </ThemedText>
    </Pressable>
  );
}

/** The view's second axis — Series, Chapters or Pages — as Browse's Page selector sits beside the
 *  bridge. Absent while the view holds only one kind: there it would be a lever with one position. */
export function LibraryKindSelector({
  present,
  value,
  selected,
  onChange,
}: {
  present: KindsPresent;
  /** The kind on screen — see `effectiveItemKind`. */
  value: ItemKind;
  selected: ItemKind;
  onChange: (kind: ItemKind) => void;
}) {
  const options = itemKindOptions(present, selected);
  if (options.length < 2) return null;
  return (
    <Selector
      testID="library.kind-selector"
      title="Show"
      value={value}
      options={options}
      onChange={(k) => onChange(k as ItemKind)}
      size="subtitle"
      labels={ITEM_KIND_LABELS}
    />
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
  const thumb = useOptionThumbBox();

  const pick = (v: string | null) => {
    onChange(v);
    closeTop();
  };

  const views = libraryViews(collections);

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
  },
});
