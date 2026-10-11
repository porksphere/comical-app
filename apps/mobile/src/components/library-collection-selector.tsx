import { Pressable, StyleSheet } from 'react-native';

import { MENU_MAX_ROWS, OptionList, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { CollectionThumb } from '@/components/collections/collection-thumb';
import { OptionActionRow, OptionMenu, OptionRow } from '@/components/overlay/option-menu';
import { Selector, useOptionThumbBox, useSubtitleSelectorStyle } from '@/components/selector';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import {
  ALL_VIEW_NAME,
  isAllView,
  ITEM_KIND_LABELS,
  itemKindOf,
  itemKindOptions,
  libraryViews,
  viewForItemKind,
  type ItemKind,
} from '@/data/selected-collection';
import type { Collection } from '@/data/types';
import { useHover } from '@/hooks/use-hover';
import { useSavedItemKinds } from '@/hooks/use-saved-item-kinds';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

/**
 * The Library tab's top-bar view selector — the bridge-selector shape, reading "All" or the
 * collection's name and opening a menu to switch between them. A collection shows its mixed
 * contents; All is narrowed to one kind by the `LibraryKindSelector` beside it. A trailing "Manage
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
  const type = useSubtitleSelectorStyle();

  const current = isAllView(value) ? null : value;
  const currentLabel = (current && collections.find((c) => c.id === current)?.name) || ALL_VIEW_NAME;
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
          () => <CollectionMenu value={current} collections={collections} onChange={onChange} />,
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

/** All's second axis — Series, Chapters or Pages — as Browse's Page selector sits beside the bridge.
 *  Absent until a chapter or page is saved: with only series to show it would be a lever with one
 *  position. */
export function LibraryKindSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const kinds = useSavedItemKinds();
  const options = itemKindOptions(kinds, value);
  if (!isAllView(value) || options.length < 2) return null;
  return (
    <Selector
      testID="library.kind-selector"
      title="Show"
      value={itemKindOf(value)}
      options={options}
      onChange={(k) => onChange(viewForItemKind(k as ItemKind))}
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

  // Back to All keeps the kind it was narrowed to; only a collection replaces the selection.
  const pick = (v: string | null) => {
    if (v !== value) onChange(v);
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
