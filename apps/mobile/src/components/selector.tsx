import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useAnchoredOverlay,
  useListMaxHeight,
  useOverlay,
} from '@/components/overlay/overlay';
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
  const [headerHeight, setHeaderHeight] = useState(0);
  const maxHeight = useListMaxHeight(headerHeight);
  return (
    <View style={styles.menu}>
      <MeasuredHeader onHeight={setHeaderHeight}>
        <OverlayHeading>{title}</OverlayHeading>
      </MeasuredHeader>
      <OptionList maxHeight={maxHeight}>
        {options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => {
              onSelect(opt);
              closeTop();
            }}>
            <ThemedView type="backgroundElement" style={styles.row}>
              {/* Reserve the thumbnail's slot even when this option has none, so a
                  list mixing bridges with/without a thumbnail keeps every title
                  starting at the same x — conditionally omitting the Image instead
                  (as this used to) drops a child from the row, and `space-between`
                  reflows the remaining two to fill the gap, pushing untitled rows'
                  labels flush left while thumbnailed rows' labels sit shifted right. */}
              {thumbnails && (
                <BridgeThumb
                  key={thumbnails[opt] ?? opt}
                  uri={thumbnails[opt]}
                  label={opt}
                  size={BridgeThumbSize}
                  style={styles.optionThumb}
                />
              )}
              <ThemedText style={styles.optionLabel} numberOfLines={1}>
                {opt}
              </ThemedText>
              <View style={[styles.dot, opt === selected && styles.dotOn]} />
            </ThemedView>
          </Pressable>
        ))}
      </OptionList>
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
  // Matches `useListMaxHeight`'s `HEADER_TO_LIST_GAP` reservation (see overlay.tsx).
  menu: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  // `flex: 1` (not `row`'s old `justifyContent: 'space-between'`) so the label
  // always starts right after the thumbnail slot and always ends right before
  // the dot, regardless of whether the thumbnail slot is rendered this row.
  optionLabel: {
    flex: 1,
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
    borderRadius: 6,
  },
});
