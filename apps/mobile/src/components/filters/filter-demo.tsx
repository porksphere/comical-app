import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

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

/** Row shown on the Browse screen: chips + a "More filters" button. */
export function FilterBar() {
  const { open } = useOverlay();
  const [type, setType] = useState(TYPES[0]);
  const [status, setStatus] = useState(STATUSES[0]);
  const [sort, setSort] = useState(SORTS[0]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}>
      <Chip
        label="Type"
        value={type}
        onPress={() => open(() => <OptionMenu title="Type" options={TYPES} selected={type} onSelect={setType} />)}
      />
      <Chip
        label="Status"
        value={status}
        onPress={() => open(() => <OptionMenu title="Status" options={STATUSES} selected={status} onSelect={setStatus} />)}
      />
      <Chip
        label="Sort"
        value={sort}
        onPress={() => open(() => <OptionMenu title="Sort by" options={SORTS} selected={sort} onSelect={setSort} />)}
      />
      {/* "More filters" as an icon + count of the additional filters it reveals. */}
      <Pressable onPress={() => open(() => <MoreFiltersTray />)}>
        <ThemedView type="backgroundSelected" style={styles.iconChip}>
          <FunnelIcon />
          <ThemedText type="smallBold">{FILTER_DEFS.length}</ThemedText>
        </ThemedView>
      </Pressable>
    </ScrollView>
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

function Chip({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
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
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingRight: Spacing.four,
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
