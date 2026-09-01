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
import { OptionRow } from '@/components/overlay/option-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { useIsCompact } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

/** Size of the bridge thumbnail shown in the dropdown rows — also reused by the
 *  browse top bar so the two read at the same size. */
export const BridgeThumbSize = 28;

/** Matches the rail's own bridge thumbnail (`THUMB_SIZE` in sidebar-bridges), because on the
 *  popover those are two views of one list. The sheet's rows are 10pt taller, so they keep the full
 *  size — the thumb is sized to its row, not to the platform. */
const POPOVER_THUMB_SIZE = 18;

type SelectorProps = {
  /** Menu heading, e.g. "Bridge" or "Page". */
  title: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Optional thumbnail URLs keyed by option value, shown in the dropdown. */
  thumbnails?: Record<string, string>;
  /** Optional LOCAL image modules (`require(...)`) keyed by option value — for a synthetic option
   *  (e.g. Comical) whose art is a bundled asset rather than a remote URL. Takes precedence over
   *  `thumbnails` for that option. */
  sources?: Record<string, number>;
  /**
   * Optional display text keyed by option value. When an option's `value` is an opaque, unique key
   * (e.g. a bridge `id`) rather than something human-readable, this maps it to the label shown in the
   * trigger + menu — letting two options that share a display name still be distinct values. Falls
   * back to the value itself when absent.
   */
  labels?: Record<string, string>;
  /** Visual size of the trigger text. */
  size?: 'title' | 'subtitle' | 'small';
  /** Automation selector for the trigger; each option derives `${testID}.option.<value>` (see src/lib/test-id.ts). */
  testID: string;
};

/** Tappable label that opens a single-select bottom-sheet menu (via the overlay system). */
export function Selector({ title, value, options, onChange, thumbnails, sources, labels, size = 'title', testID }: SelectorProps) {
  const { ref, openAt } = useAnchoredOverlay();
  const compact = useIsCompact();
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      testID={testID}
      ref={ref}
      {...handlers}
      style={[styles.trigger, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() =>
        openAt(() => (
          <SelectMenu
            title={title}
            options={options}
            selected={value}
            onSelect={onChange}
            thumbnails={thumbnails}
            sources={sources}
            labels={labels}
            testID={testID}
          />
        ))
      }>
      <ThemedText
        type={size}
        numberOfLines={1}
        style={[
          styles.triggerLabel,
          size === 'subtitle' ? (compact ? styles.subtitleCompact : styles.subtitleWide) : null,
        ]}>
        {labels?.[value] ?? value}
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
  sources,
  labels,
  testID,
}: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  thumbnails?: Record<string, string>;
  sources?: Record<string, number>;
  labels?: Record<string, string>;
  testID: string;
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
          <OptionRow
            key={opt}
            testID={testId(testID, 'option', opt)}
            label={labels?.[opt] ?? opt}
            selected={opt === selected}
            leading={<OptionThumb label={labels?.[opt] ?? opt} thumbnail={thumbnails ? (thumbnails[opt] ?? null) : undefined} source={sources?.[opt]} />}
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


/**
 * The row's leading slot. Renders the slot even when this option has NO thumbnail (and nothing at
 * all when the menu has none at all), so a list mixing bridges with and without one keeps every
 * title starting at the same x — omitting the Image instead drops a child from the row and the
 * labels beside it shift.
 */
function OptionThumb({
  label,
  thumbnail,
  source,
}: {
  label: string;
  /** `undefined` when the menu has no thumbnails at all; `null` for an option that just doesn't
   *  have one (still reserves the slot). */
  thumbnail?: string | null;
  source?: number;
}) {
  const popover = useOverlayPresentation() === 'popover';
  if (thumbnail === undefined && source === undefined) return null;
  return (
    <BridgeThumb
      key={thumbnail ?? label}
      source={source}
      uri={thumbnail ?? undefined}
      label={label}
      size={popover ? POPOVER_THUMB_SIZE : BridgeThumbSize}
      style={popover ? styles.popoverOptionThumb : styles.optionThumb}
    />
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
  // No `flex: 1` (see `sheetBody` in overlay.tsx for why) — this just hugs
  // its `MeasuredHeader`/`OptionList` content, both of which already size
  // themselves to a real number.
  menu: {
    gap: Spacing.three,
  },
  optionThumb: {
    borderRadius: 6,
  },
  // Same corner RATIO as the full-size thumb (6 on 28), so the smaller tile is the same shape
  // rather than a lozenge — the rule sidebar-bridges' own thumb follows.
  popoverOptionThumb: {
    borderRadius: 4,
  },
});
