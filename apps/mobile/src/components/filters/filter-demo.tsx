import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Placeholder filter UI demonstrating the stacked overlay component. Nothing is
// wired to real data — it's just to feel the interaction (handle swipe-dismiss,
// "More filters" tray, and one nested overlay that pushes the tray back).

const TYPES = ['All', 'Series', 'Movie', 'OVA', 'Special'];
const STATUSES = ['Any', 'Airing', 'Finished', 'Upcoming'];
const SORTS = ['Relevance', 'Newest', 'Top rated', 'Most popular'];
const GENRES = ['Action', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life'];

/** Row shown on the Browse screen: chips + a "More filters" button. */
export function FilterBar() {
  const { open } = useOverlay();
  return (
    <View style={styles.bar}>
      <View style={styles.chips}>
        <Chip label="Type" value="All" onPress={() => open(() => <OptionMenu title="Type" options={TYPES} />)} />
        <Chip label="Status" value="Any" onPress={() => open(() => <OptionMenu title="Status" options={STATUSES} />)} />
        <Chip label="Sort" value="Relevance" onPress={() => open(() => <OptionMenu title="Sort by" options={SORTS} />)} />
      </View>
      <Pressable onPress={() => open(() => <MoreFiltersTray />)}>
        <ThemedView type="backgroundSelected" style={styles.moreButton}>
          <ThemedText type="smallBold">More filters</ThemedText>
        </ThemedView>
      </Pressable>
    </View>
  );
}

/** A simple single-select popup menu (overlay). */
function OptionMenu({ title, options }: { title: string; options: string[] }) {
  const { closeTop } = useOverlay();
  const [selected, setSelected] = useState(options[0]);
  return (
    <SheetContent title={title}>
      {options.map((opt) => (
        <SelectRow
          key={opt}
          label={opt}
          selected={selected === opt}
          onPress={() => {
            setSelected(opt);
            closeTop();
          }}
        />
      ))}
    </SheetContent>
  );
}

/** First-level tray with a nested overlay ("Genres"). */
function MoreFiltersTray() {
  const { open, closeTop } = useOverlay();
  return (
    <SheetContent title="More filters">
      <NavRow label="Type" value="All" onPress={() => open(() => <OptionMenu title="Type" options={TYPES} />)} />
      <NavRow label="Status" value="Any" onPress={() => open(() => <OptionMenu title="Status" options={STATUSES} />)} />
      {/* Nested overlay (depth 2): pushes this tray back with the zoom effect. */}
      <NavRow label="Genres" value="Any" onPress={() => open(() => <GenresTray />)} />
      <PrimaryButton title="Show results" onPress={closeTop} />
    </SheetContent>
  );
}

/** Second-level (nested) overlay. */
function GenresTray() {
  const { closeTop } = useOverlay();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (g: string) =>
    setPicked((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  return (
    <SheetContent title="Genres">
      {GENRES.map((g) => (
        <SelectRow key={g} label={g} selected={picked.includes(g)} onPress={() => toggle(g)} />
      ))}
      <PrimaryButton title="Done" onPress={closeTop} />
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
        <ThemedText type="small" themeColor="textSecondary">
          {value}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function NavRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedText>{label}</ThemedText>
        <View style={styles.rowRight}>
          <ThemedText themeColor="textSecondary">{value}</ThemedText>
          <ThemedText themeColor="textSecondary">{'›'}</ThemedText>
        </View>
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

const styles = StyleSheet.create({
  bar: {
    gap: Spacing.three,
    alignSelf: 'stretch',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
  },
  moreButton: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.five,
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
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
