import { Pressable, StyleSheet, View } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type SelectorProps = {
  /** Menu heading, e.g. "Bridge" or "Page". */
  title: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Visual size of the trigger text. */
  size?: 'title' | 'subtitle' | 'small';
};

/** Tappable label that opens a single-select bottom-sheet menu (via the overlay system). */
export function Selector({ title, value, options, onChange, size = 'title' }: SelectorProps) {
  const { open } = useOverlay();
  return (
    <Pressable
      style={styles.trigger}
      onPress={() =>
        open(() => (
          <SelectMenu title={title} options={options} selected={value} onSelect={onChange} />
        ))
      }>
      <ThemedText type={size} numberOfLines={1} style={size === 'subtitle' ? styles.subtitleCompact : undefined}>
        {value}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={size === 'title' ? styles.caretLg : styles.caretSm}>
        ▾
      </ThemedText>
    </Pressable>
  );
}

function SelectMenu({
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
    <View style={styles.menu}>
      <ThemedText type="subtitle" style={styles.menuTitle}>
        {title}
      </ThemedText>
      {options.map((opt) => (
        <Pressable
          key={opt}
          onPress={() => {
            onSelect(opt);
            closeTop();
          }}>
          <ThemedView type="backgroundElement" style={styles.row}>
            <ThemedText>{opt}</ThemedText>
            <View style={[styles.dot, opt === selected && styles.dotOn]} />
          </ThemedView>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  // The bridge/page bar uses `subtitle` (32) — render it a notch smaller.
  subtitleCompact: {
    fontSize: 24,
    lineHeight: 32,
  },
  caretLg: {
    fontSize: 20,
  },
  caretSm: {
    fontSize: 13,
  },
  menu: {
    gap: Spacing.two,
  },
  menuTitle: {
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
  dotOn: {
    borderColor: '#3478F6',
    backgroundColor: '#3478F6',
  },
});
