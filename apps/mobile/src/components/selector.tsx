import { Pressable, StyleSheet, View } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useAnchoredOverlay,
  useOverlay,
  useOverlayPresentation,
} from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RowHeight, Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useIsCompact } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

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
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      ref={ref}
      {...handlers}
      style={[styles.trigger, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() =>
        openAt(() => (
          <SelectMenu title={title} options={options} selected={value} onSelect={onChange} thumbnails={thumbnails} />
        ))
      }>
      <ThemedText
        type={size}
        numberOfLines={1}
        style={[
          styles.triggerLabel,
          size === 'subtitle' ? (compact ? styles.subtitleCompact : styles.subtitleWide) : null,
        ]}>
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
  const presentation = useOverlayPresentation();
  return (
    <View style={styles.menu}>
      {/* On the popover, OverlayHeading renders nothing (the trigger already
          names the menu) — skip the wrapper entirely there too, since
          `styles.menu`'s flex `gap` would otherwise still reserve space
          before an empty sibling (see filter-editors.tsx's MultiEditor). */}
      {presentation !== 'popover' && (
        <MeasuredHeader>
          <OverlayHeading>{title}</OverlayHeading>
        </MeasuredHeader>
      )}
      <OptionList>
        {options.map((opt) => (
          <SelectRow
            key={opt}
            label={opt}
            selected={opt === selected}
            thumbnail={thumbnails ? (thumbnails[opt] ?? null) : undefined}
            onPress={() => {
              onSelect(opt);
              closeTop();
            }}
          />
        ))}
      </OptionList>
    </View>
  );
}

function SelectRow({
  label,
  selected,
  thumbnail,
  onPress,
}: {
  label: string;
  selected: boolean;
  /** `undefined` when the menu has no thumbnails at all; `null` for an option
   *  that just doesn't have one (still reserves the slot — see below). */
  thumbnail?: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable onPress={onPress} {...handlers}>
      <ThemedView
        type="backgroundElement"
        style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        {/* Reserve the thumbnail's slot even when this option has none, so a
            list mixing bridges with/without a thumbnail keeps every title
            starting at the same x — conditionally omitting the Image instead
            (as this used to) drops a child from the row, and `space-between`
            reflows the remaining two to fill the gap, pushing untitled rows'
            labels flush left while thumbnailed rows' labels sit shifted right. */}
        {thumbnail !== undefined && (
          <BridgeThumb
            key={thumbnail ?? label}
            uri={thumbnail ?? undefined}
            label={label}
            size={BridgeThumbSize}
            style={styles.optionThumb}
          />
        )}
        <ThemedText style={styles.optionLabel} numberOfLines={1}>
          {label}
        </ThemedText>
        <View style={[styles.dot, selected && styles.dotOn]} />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.one,
    flexShrink: 1,
    // Without this, flexbox's default `minWidth: auto` floors the shrink at
    // the trigger's untruncated content width, so the `numberOfLines={1}`
    // label never actually gets a chance to truncate against its sibling —
    // it just crowds the row instead (see `FilterButton.summary`, which
    // already sets this for the same reason).
    minWidth: 0,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
  },
  // React Native's `flexShrink` defaults to 0 (unlike web CSS's 1), so without
  // this the label won't actually shrink when the trigger does — it'll just
  // overflow instead of truncating via `numberOfLines`.
  triggerLabel: {
    flexShrink: 1,
    minWidth: 0,
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
    flex: 1,
    minHeight: 0,
    gap: Spacing.three,
  },
  // Same height as the filter bar's own rows (`CONTROL_HEIGHT` in
  // filter-types.ts) so a bridge/page picker row reads at the same size as
  // every other tappable row in the app.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: RowHeight,
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
