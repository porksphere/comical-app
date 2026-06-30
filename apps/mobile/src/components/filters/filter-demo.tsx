import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useIsLargeScreen } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

import { FilterButton } from './filter-button';
import { CheckIcon, FiltersIcon, SortIcon } from './filter-icons';
import {
  CONTROL_HEIGHT,
  CONTROL_RADIUS,
  initialValue,
  type FilterDef,
  type FilterValue,
} from './filter-types';

// Placeholder filter UI. "Sort" is a single-select demo behind its own icon; the
// rest are the reusable, typed filter controls declared in FILTER_DEFS.

const SORTS = ['Relevance', 'Newest', 'Top rated', 'Most popular'];

const TAGS = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Harem', 'Historical',
  'Horror', 'Isekai', 'Josei', 'Magic', 'Martial Arts', 'Mecha', 'Music', 'Mystery',
  'Psychological', 'Romance', 'School Life', 'Sci-Fi', 'Seinen', 'Shoujo', 'Shounen',
  'Slice of Life', 'Sports', 'Supernatural', 'Thriller', 'Tragedy',
];

const FILTER_DEFS: FilterDef[] = [
  { id: 'title', label: 'Title', type: 'string', placeholder: 'Title contains…' },
  { id: 'year', label: 'Year', type: 'number', min: 1970, max: 2026, step: 1, default: 2015 },
  { id: 'format', label: 'Format', type: 'multi', options: ['Manga', 'Manhwa', 'Manhua', 'Webtoon', 'One-shot'] },
  { id: 'status', label: 'Status', type: 'includeExclude', options: ['Ongoing', 'Completed', 'Hiatus', 'Cancelled'] },
  // Multi-select that starts fully selected.
  { id: 'rating', label: 'Content rating', type: 'multi', options: ['Safe', 'Suggestive', 'Erotica'], selectAllByDefault: true },
  { id: 'tags', label: 'Tags', type: 'tags', options: TAGS },
];

// Layout rules for the single-line filter bar.
const GAP = Spacing.two;
const FILTER_MIN_WIDTH = 200; // a full-size filter row stays at least this wide
const SORT_RESERVE_LABELLED = 128; // sort pill with icon + current sort label
const SORT_RESERVE_ICON = CONTROL_HEIGHT; // sort collapsed to an icon-only square
const OVERFLOW_RESERVE = 64; // funnel icon + "+X" count

/** How many full-size filters fit on one line given the measured bar width. */
function fitCount(containerW: number, total: number, sortReserve: number): number {
  if (containerW <= 0) return total;
  const base = containerW - sortReserve - GAP;
  // If every filter fits with no overflow control, show them all.
  const colsAll = Math.floor((base + GAP) / (FILTER_MIN_WIDTH + GAP));
  if (colsAll >= total) return total;
  // Otherwise leave room for the "+X" overflow control and refit.
  const avail = base - OVERFLOW_RESERVE - GAP;
  const cols = Math.floor((avail + GAP) / (FILTER_MIN_WIDTH + GAP));
  return Math.min(total, Math.max(1, cols));
}

/**
 * Row shown on the Browse screen: a Sort icon plus the filter rows. The filters
 * use the same full display as the overflow sheet, sized so each stays readable;
 * only as many as fit on one line are shown and the rest collapse into a "+X"
 * funnel chip. A wide-enough screen shows every filter with no overflow at all.
 */
export function FilterBar({ searchActive }: { searchActive: boolean }) {
  const wide = useIsLargeScreen();
  const [sort, setSort] = useState(SORTS[0]);
  const [values, setValues] = useState<Record<string, FilterValue>>(() =>
    Object.fromEntries(FILTER_DEFS.map((d) => [d.id, initialValue(d)])),
  );
  const setValue = (id: string, v: FilterValue) => setValues((prev) => ({ ...prev, [id]: v }));

  const [containerW, setContainerW] = useState(0);
  // Sort only shows once results are on screen; until then it reserves no room.
  // On narrow viewports it collapses to an icon-only square, reserving less.
  const sortReserve = searchActive ? (wide ? SORT_RESERVE_LABELLED : SORT_RESERVE_ICON) : 0;
  const visible = fitCount(containerW, FILTER_DEFS.length, sortReserve);
  const shown = FILTER_DEFS.slice(0, visible);
  const hidden = FILTER_DEFS.slice(visible);

  return (
    <View
      style={styles.bar}
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      {shown.map((def) => (
        <View key={def.id} style={styles.filterSlot}>
          <FilterButton def={def} value={values[def.id]} onChange={(v) => setValue(def.id, v)} />
        </View>
      ))}
      {hidden.length > 0 && (
        <OverflowChip
          count={hidden.length}
          render={() => <FiltersSheet defs={hidden} initial={values} onChange={setValue} />}
        />
      )}
      {searchActive && (
        <SortButton
          label={sort}
          showLabel={wide}
          render={() => <OptionMenu title="Sort by" options={SORTS} selected={sort} onSelect={setSort} />}
        />
      )}
    </View>
  );
}

/** Sort control — shares the filter rows' height/radius/background. Shows the
 *  current sort value as a labeled pill when there's room; on narrow viewports it
 *  collapses to an icon-only square so it stops crowding the bar. Opens its menu
 *  anchored to itself (desktop popover / mobile sheet). */
function SortButton({
  label,
  showLabel,
  render,
}: {
  label: string;
  showLabel: boolean;
  render: () => ReactNode;
}) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  return (
    <Pressable ref={ref} onPress={() => openAt(render)} accessibilityRole="button" accessibilityLabel="Sort">
      <ThemedView type="backgroundElement" style={[styles.sortButton, !showLabel && styles.sortButtonIcon]}>
        <SortIcon color={theme.text} />
        {showLabel && <ThemedText type="smallBold">{label}</ThemedText>}
      </ThemedView>
    </Pressable>
  );
}

/** Collapsed funnel chip standing in for the filters that didn't fit on the line. */
function OverflowChip({ count, render }: { count: number; render: () => ReactNode }) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  return (
    <Pressable
      ref={ref}
      onPress={() => openAt(render)}
      accessibilityRole="button"
      accessibilityLabel={`${count} more filters`}>
      <ThemedView type="backgroundElement" style={styles.overflowChip}>
        <FiltersIcon color={theme.text} />
        <ThemedText type="smallBold">{`+${count}`}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** Sheet of the filters that overflowed the bar; rendered with the same FilterButton. */
function FiltersSheet({
  defs,
  initial,
  onChange,
}: {
  defs: FilterDef[];
  initial: Record<string, FilterValue>;
  onChange: (id: string, v: FilterValue) => void;
}) {
  const { closeTop } = useOverlay();
  const [values, setValues] = useState(initial);
  return (
    <SheetContent title="Filters" headerAction={<ConfirmButton onPress={closeTop} />}>
      {defs.map((def) => (
        <FilterButton
          key={def.id}
          def={def}
          value={values[def.id]}
          onChange={(v) => {
            setValues((prev) => ({ ...prev, [def.id]: v }));
            onChange(def.id, v);
          }}
        />
      ))}
    </SheetContent>
  );
}

/** A single-select popup menu (overlay) that reports the chosen value back. */
function OptionMenu({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { closeTop } = useOverlay();
  return (
    <SheetContent title={title}>
      {options.map((opt) => (
        <SelectRow
          key={opt}
          label={opt}
          selected={selected === opt}
          onPress={() => {
            onSelect(opt);
            closeTop();
          }}
        />
      ))}
    </SheetContent>
  );
}

// --- shared building blocks ---

function SheetContent({
  title,
  headerAction,
  children,
}: {
  title: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.content}>
      <View style={styles.sheetHeader}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {headerAction}
      </View>
      {children}
    </View>
  );
}

function SelectRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText>{label}</ThemedText>
        <View style={[styles.dot, selected && styles.dotSelected]} />
      </ThemedView>
    </Pressable>
  );
}

/** Circular accent checkmark that confirms the filter selection ("show results").
 *  Sits top-right in the sheet header, mirroring an iOS "Done" affordance. */
function ConfirmButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Show results">
      <View style={[styles.confirm, { backgroundColor: theme.accent }]}>
        <CheckIcon color={theme.accentOn} size={20} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
    overflow: 'hidden',
  },
  filterSlot: {
    flex: 1,
    minWidth: 0,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: CONTROL_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: CONTROL_RADIUS,
  },
  sortButtonIcon: {
    width: CONTROL_HEIGHT,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  overflowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: CONTROL_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: CONTROL_RADIUS,
  },
  content: {
    gap: Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  dotSelected: {
    borderColor: '#3478F6',
    backgroundColor: '#3478F6',
  },
  confirm: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
