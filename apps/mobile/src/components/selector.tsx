import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { OverlayHeading, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useIsCompact } from '@/hooks/use-responsive';

/** Size of the bridge thumbnail shown in the dropdown rows — also reused by the
 *  browse top bar so the two read at the same size. */
export const BridgeThumbSize = 28;

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
  const { ref, openAt } = useAnchoredOverlay();
  const compact = useIsCompact();
  return (
    <Pressable
      ref={ref}
      style={styles.trigger}
      onPress={() =>
        openAt(() => (
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
      <OverlayHeading>{title}</OverlayHeading>
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
    alignSelf: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  // Bridge/page selectors mirror the reference's header title (`#app-title` h1,
  // which the page selector inherits via `font-weight: inherit`): 1.4rem mobile
  // / 1.75rem desktop (1rem = 16px), bold like the h1.
  subtitleCompact: {
    fontSize: 22.4,
    lineHeight: 28,
    fontWeight: '700',
  },
  subtitleWide: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
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
    width: BridgeThumbSize,
    height: BridgeThumbSize,
    borderRadius: 6,
  },
});
