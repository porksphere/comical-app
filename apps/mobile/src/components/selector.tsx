import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useIsCompact } from '@/hooks/use-responsive';

type SelectorProps = {
  /** Menu heading, e.g. "Bridge" or "Page". */
  title: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Optional thumbnail URLs keyed by option label, shown in the dropdown. */
  thumbnails?: Record<string, string>;
  /** Visual size of the trigger text. */
  size?: 'title' | 'subtitle' | 'small';
};

/** Tappable label that opens a single-select bottom-sheet menu (via the overlay system). */
export function Selector({ title, value, options, onChange, thumbnails, size = 'title' }: SelectorProps) {
  const { open } = useOverlay();
  const compact = useIsCompact();
  return (
    <Pressable
      style={styles.trigger}
      onPress={() =>
        open(() => (
          <SelectMenu title={title} options={options} selected={value} onSelect={onChange} thumbnails={thumbnails} />
        ))
      }>
      <ThemedText
        type={size}
        numberOfLines={1}
        style={size === 'subtitle' ? (compact ? styles.subtitleCompact : styles.subtitleWide) : undefined}>
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
  thumbnails,
}: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  thumbnails?: Record<string, string>;
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
            {thumbnails?.[opt] ? (
              <Image source={{ uri: thumbnails[opt] }} style={styles.optionThumb} />
            ) : null}
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
  // Bridge/page selectors mirror the reference's header title (`#app-title` h1,
  // which the page selector inherits): 1.4rem mobile / 1.75rem desktop
  // (1rem = 16px).
  subtitleCompact: {
    fontSize: 22.4,
    lineHeight: 28,
  },
  subtitleWide: {
    fontSize: 28,
    lineHeight: 34,
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
  optionThumb: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
});
