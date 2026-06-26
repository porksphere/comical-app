import { useState, type ReactNode } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

import { FilterButton } from './filter-button';
import { initialValue, type FilterDef, type FilterValue } from './filter-types';

// Placeholder filter UI. "Sort" is a single-select demo with its own button; the
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

// Layout constants for the measured, single-line filter bar.
const GAP = Spacing.two;
const OVERFLOW_RESERVE = 48; // room kept for the "+X" overflow chip

/**
 * Row shown on the Browse screen: a "Sort" button plus the filter chips. Only as
 * many filter chips as fit on one line are shown inline; the rest collapse into a
 * "+X" chip that opens them in a sheet (rendered with the same FilterButton). The
 * fit is measured, so a wide-enough screen shows every filter with no overflow.
 */
export function FilterBar() {
  const { open } = useOverlay();
  const [sort, setSort] = useState(SORTS[0]);
  const [values, setValues] = useState<Record<string, FilterValue>>(() =>
    Object.fromEntries(FILTER_DEFS.map((d) => [d.id, initialValue(d)])),
  );
  const setValue = (id: string, v: FilterValue) => setValues((prev) => ({ ...prev, [id]: v }));

  // Measured container + chip widths drive how many chips fit on one line.
  const [containerW, setContainerW] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sortW, setSortW] = useState(0);

  const measured = sortW > 0 && FILTER_DEFS.every((d) => widths[d.id] != null);

  let visible = FILTER_DEFS.length;
  if (measured && containerW > 0) {
    // The Sort button is always shown first, so reserve its width up front.
    const avail = containerW - sortW - GAP;
    let used = 0;
    visible = 0;
    for (let i = 0; i < FILTER_DEFS.length; i++) {
      const candidate = used + (i > 0 ? GAP : 0) + widths[FILTER_DEFS[i].id];
      const isLast = i === FILTER_DEFS.length - 1;
      // Keep room for the "+X" chip unless this is the last filter (no overflow).
      const reserve = isLast ? 0 : GAP + OVERFLOW_RESERVE;
      if (candidate + reserve <= avail) {
        used = candidate;
        visible = i + 1;
      } else {
        break;
      }
    }
  }

  const shown = FILTER_DEFS.slice(0, visible);
  const hidden = FILTER_DEFS.slice(visible);

  return (
    <View style={styles.bar} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      {/* Hidden measuring pass: keeps the Sort + filter chip widths up to date. */}
      <View style={styles.measure} pointerEvents="none">
        <Chip label="Sort" value={sort} onMeasure={setSortW} />
        {FILTER_DEFS.map((def) => (
          <FilterButton
            key={def.id}
            compact
            def={def}
            value={values[def.id]}
            onChange={(v) => setValue(def.id, v)}
            onMeasure={(w) => setWidths((prev) => ({ ...prev, [def.id]: w }))}
          />
        ))}
      </View>

      <View style={styles.chipRow}>
        <Chip
          label="Sort"
          value={sort}
          onPress={() => open(() => <OptionMenu title="Sort by" options={SORTS} selected={sort} onSelect={setSort} />)}
        />
        {shown.map((def) => (
          <FilterButton
            key={def.id}
            compact
            def={def}
            value={values[def.id]}
            onChange={(v) => setValue(def.id, v)}
          />
        ))}
        {hidden.length > 0 && (
          <OverflowChip
            count={hidden.length}
            onPress={() => open(() => <FiltersSheet defs={hidden} initial={values} onChange={setValue} />)}
          />
        )}
      </View>
    </View>
  );
}

/** Collapsed "+X" chip standing in for the filters that didn't fit on the line. */
function OverflowChip({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundSelected" style={styles.overflowChip}>
        <ThemedText type="smallBold">{`+${count}`}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** Sheet of the filters that overflowed the bar; each renders as a FilterButton row. */
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
    <SheetContent title="Filters">
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
      <PrimaryButton title="Show results" onPress={closeTop} />
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

function SheetContent({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.content}>
      <ThemedText type="subtitle" style={styles.sheetTitle}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

/** Compact label + value pill. Used for the standalone "Sort" button. */
function Chip({
  label,
  value,
  onPress,
  onMeasure,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  onMeasure?: (w: number) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      onLayout={onMeasure ? (e: LayoutChangeEvent) => onMeasure(e.nativeEvent.layout.width) : undefined}>
      <ThemedView type="backgroundElement" style={styles.chip}>
        <ThemedText type="small">{label}</ThemedText>
        <ThemedView type="backgroundSelected" style={styles.valuePill}>
          <ThemedText type="small" themeColor="textSecondary">
            {value}
          </ThemedText>
        </ThemedView>
      </ThemedView>
    </Pressable>
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

function PrimaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.primaryWrap}>
      <ThemedView type="backgroundSelected" style={styles.primary}>
        <ThemedText type="smallBold">{title}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const CHIP_HEIGHT = 36;

const styles = StyleSheet.create({
  bar: {
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    opacity: 0,
    flexDirection: 'row',
    gap: GAP,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
  },
  overflowChip: {
    justifyContent: 'center',
    height: CHIP_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    height: CHIP_HEIGHT,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    borderRadius: Spacing.five,
  },
  valuePill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    borderRadius: Spacing.four,
  },
  content: {
    gap: Spacing.two,
  },
  sheetTitle: {
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
  primaryWrap: {
    marginTop: Spacing.two,
  },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
