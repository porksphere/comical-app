import { useState, type ReactNode } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { FilterButton } from './filter-button';
import { initialValue, type FilterDef, type FilterValue } from './filter-types';

// Placeholder filter UI. The chips (Type/Status/Sort) are single-select demos;
// "More filters" opens a tray of the reusable, typed filter controls.

const TYPES = ['All', 'Series', 'Movie', 'OVA', 'Special'];
const STATUSES = ['Any', 'Airing', 'Finished', 'Upcoming'];
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

type PrimaryFilter = {
  key: string;
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  menuTitle: string;
};

/**
 * Row shown on the Browse screen: the primary filter chips plus a "More filters"
 * button. Only as many chips as fit on one line are shown inline; the rest
 * collapse into a "+X" overflow chip that opens them in a menu. The fit is
 * measured, so a wide-enough screen shows every chip with no overflow at all.
 */
export function FilterBar() {
  const { open } = useOverlay();
  const [type, setType] = useState(TYPES[0]);
  const [status, setStatus] = useState(STATUSES[0]);
  const [sort, setSort] = useState(SORTS[0]);

  const filters: PrimaryFilter[] = [
    { key: 'type', label: 'Type', value: type, options: TYPES, onSelect: setType, menuTitle: 'Type' },
    { key: 'status', label: 'Status', value: status, options: STATUSES, onSelect: setStatus, menuTitle: 'Status' },
    { key: 'sort', label: 'Sort', value: sort, options: SORTS, onSelect: setSort, menuTitle: 'Sort by' },
  ];

  const openMenu = (f: PrimaryFilter) =>
    open(() => (
      <OptionMenu title={f.menuTitle} options={f.options} selected={f.value} onSelect={f.onSelect} />
    ));

  // Measured container + chip widths drive how many chips fit on one line.
  const [containerW, setContainerW] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [funnelW, setFunnelW] = useState(0);

  const measured = funnelW > 0 && filters.every((f) => widths[f.key] != null);

  let visible = filters.length;
  if (measured && containerW > 0) {
    // The funnel button is always shown, so reserve its width up front.
    const avail = containerW - funnelW - GAP;
    let used = 0;
    visible = 0;
    for (let i = 0; i < filters.length; i++) {
      const candidate = used + (i > 0 ? GAP : 0) + widths[filters[i].key];
      const isLast = i === filters.length - 1;
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

  const shown = filters.slice(0, visible);
  const hidden = filters.slice(visible);

  return (
    <View style={styles.bar} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      {/* Hidden measuring pass: keeps chip + funnel widths up to date. */}
      <View style={styles.measure} pointerEvents="none">
        {filters.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            value={f.value}
            onMeasure={(w) => setWidths((prev) => ({ ...prev, [f.key]: w }))}
          />
        ))}
        <FunnelButton count={FILTER_DEFS.length} onMeasure={setFunnelW} />
      </View>

      <View style={styles.chipRow}>
        {shown.map((f) => (
          <Chip key={f.key} label={f.label} value={f.value} onPress={() => openMenu(f)} />
        ))}
        {hidden.length > 0 && (
          <OverflowChip
            count={hidden.length}
            onPress={() => open(() => <OverflowMenu filters={hidden} />)}
          />
        )}
        {/* "More filters" as an icon + count of the additional filters it reveals. */}
        <FunnelButton count={FILTER_DEFS.length} onPress={() => open(() => <MoreFiltersTray />)} />
      </View>
    </View>
  );
}

/** The "More filters" funnel button; also used in the measuring pass. */
function FunnelButton({
  count,
  onPress,
  onMeasure,
}: {
  count: number;
  onPress?: () => void;
  onMeasure?: (w: number) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      onLayout={onMeasure ? (e: LayoutChangeEvent) => onMeasure(e.nativeEvent.layout.width) : undefined}>
      <ThemedView type="backgroundSelected" style={styles.iconChip}>
        <FunnelIcon />
        <ThemedText type="smallBold">{count}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** Collapsed "+X" chip standing in for the filters that didn't fit on the line. */
function OverflowChip({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.overflowChip}>
        <ThemedText type="smallBold">{`+${count}`}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

/** Sheet listing the overflowed filters; each row opens its own option menu. */
function OverflowMenu({ filters }: { filters: PrimaryFilter[] }) {
  const { open } = useOverlay();
  return (
    <SheetContent title="More filters">
      {filters.map((f) => (
        <Pressable
          key={f.key}
          onPress={() =>
            open(() => (
              <OptionMenu title={f.menuTitle} options={f.options} selected={f.value} onSelect={f.onSelect} />
            ))
          }>
          <ThemedView type="backgroundElement" style={styles.row}>
            <ThemedText>{f.label}</ThemedText>
            <ThemedView type="backgroundSelected" style={styles.valuePill}>
              <ThemedText type="small" themeColor="textSecondary">
                {f.value}
              </ThemedText>
            </ThemedView>
          </ThemedView>
        </Pressable>
      ))}
    </SheetContent>
  );
}

function FunnelIcon() {
  const theme = useTheme();
  return (
    <View style={styles.funnel}>
      <View style={[styles.funnelBar, { width: 14, backgroundColor: theme.text }]} />
      <View style={[styles.funnelBar, { width: 9, backgroundColor: theme.text }]} />
      <View style={[styles.funnelBar, { width: 4, backgroundColor: theme.text }]} />
    </View>
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

/** Tray of the reusable, typed filter controls. Each row opens its editor (depth 2). */
function MoreFiltersTray() {
  const { closeTop } = useOverlay();
  const [values, setValues] = useState<Record<string, FilterValue>>(() =>
    Object.fromEntries(FILTER_DEFS.map((d) => [d.id, initialValue(d)])),
  );
  return (
    <SheetContent title="Filters">
      {FILTER_DEFS.map((def) => (
        <FilterButton
          key={def.id}
          def={def}
          value={values[def.id]}
          onChange={(v) => setValues((prev) => ({ ...prev, [def.id]: v }))}
        />
      ))}
      <PrimaryButton title="Show results" onPress={closeTop} />
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
  iconChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: CHIP_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
  },
  funnel: {
    alignItems: 'center',
    gap: 3,
  },
  funnelBar: {
    height: 2,
    borderRadius: 1,
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
