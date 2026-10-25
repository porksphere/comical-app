import { useEffect, type ComponentType } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { MoveLeftIcon, MoveRightIcon, MoveVerticalIcon, SettingsIcon } from '@/components/icons/reader-icons';
import type { IconProps } from '@/components/icons/ui-icons';
import { OverlayHeading, useAnchoredOverlay } from '@/components/overlay/overlay';
import { IntStepper } from '@/components/reader/int-stepper';
import { readsDouble } from '@/components/reader/spreads';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import {
  PREFETCH_AHEAD_MAX,
  PREFETCH_AHEAD_MIN,
  setSpreadShift,
  useReaderSettings,
  useSpreadShift,
  type DoubleTapMode,
  type PageFit,
  type PageLayout,
  type ReaderDirection,
  type ReaderSettings,
} from '@/hooks/use-reader-settings';
import { useIsDesktop } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

/** How long the sheet's entrance spring takes to come to rest, generously — the native controls in
 *  it wait this out before mounting (see IntStepper's `deferMountMs`). */
const SHEET_SETTLE_MS = 600;

/** Gear button that opens reader settings in the app's shared overlay system — a
 *  near-full-width bottom sheet on mobile/narrow web, an anchored popover
 *  (matching Browse's filter buttons) on wide desktop web.
 *
 *  Rendered inline in the reader toolbar's trailing slot, so it inherits that
 *  bar's fade/auto-hide rather than positioning or animating itself.
 *
 *  SETTINGS ONLY. It used to carry a "This page", a "This chapter" and a "This series" block of
 *  collect actions as well, which made the gear the app's densest screen and put three different
 *  subjects behind one control that names none of them. Each of the three already has a home where
 *  its subject is the thing you are looking at: a page has the toolbar's own save button beside this
 *  gear (`CollectPageControl`); a chapter has its row's long-press menu on the series screen
 *  (`series.chapter-menu.collect`); a series has the series screen. Nothing was lost, and the sheet
 *  is now only the three things that actually change how the reader behaves. */
export function SettingsControl({
  seriesKey,
  onOpenChange,
}: {
  /** `bridgeId:seriesId` — what the per-series spread shift is stored against. */
  seriesKey: string | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const { ref, openAt, isOpen } = useAnchoredOverlay();
  useEffect(() => {
    if (!isOpen || !onOpenChange) return;
    onOpenChange(true);
    return () => onOpenChange(false);
  }, [isOpen, onOpenChange]);

  return (
    <Pressable
      testID="reader.settings.open"
      ref={ref}
      hitSlop={12}
      onPress={() => openAt(() => <SettingsContent seriesKey={seriesKey} />)}
      style={styles.gear}
      accessibilityRole="button"
      accessibilityLabel="Reader settings">
      <SettingsIcon color="#fff" size={20} />
    </Pressable>
  );
}

/** Reader settings content, rendered inside the overlay (sheet or popover).
 *  Note: the overlay panel follows the app's theme (`useTheme`), so under a
 *  light appearance it renders light while the reader keeps its own always-dark
 *  viewing surface — an intentional split, matching how media
 *  readers stay dark for immersion while their controls track the app theme.
 *  So every colour in here is the theme's: a hardcoded white was white on white. */
function SettingsContent({ seriesKey }: { seriesKey: string | null }) {
  const [settings, set] = useReaderSettings(seriesKey);
  const shift = useSpreadShift(seriesKey);
  // The window stands in for the reader's frame, which is the window less any safe-area inset —
  // close enough to say whether `auto` is pairing right now.
  const window = useWindowDimensions();
  const paged = settings.mode === 'paged';
  const pairing = paged && readsDouble(settings.pageLayout, window);
  const theme = useTheme();
  const hint = [styles.hint, { color: theme.textSecondary }];
  // A desktop window has no orientation to speak of; it is nearly always wider than tall.
  const desktop = useIsDesktop();
  return (
    <View style={styles.content}>
      <OverlayHeading>Reader settings</OverlayHeading>
      <DirectionRow settings={settings} set={set} />
      <Segment
        label="Page fit"
        testIdPrefix="reader.settings.page-fit"
        // Webtoon has only the two layouts (one page per screen, or a continuous strip), so it
        // shows two and reads `auto` as the page — the same mapping WebtoonReader applies.
        value={settings.mode === 'webtoon' ? (webtoonFit(settings.pageFit) === 'fit-page' ? 'fit-height' : 'fit-width') : settings.pageFit}
        options={[
          ...(settings.mode === 'paged' ? [['auto', 'Auto'] as [string, string]] : []),
          ['fit-width', 'Fit width'],
          ['fit-height', 'Fit height'],
        ]}
        onChange={(v) => set({ pageFit: v as PageFit })}
      />
      {settings.mode === 'webtoon' && (
        <ThemedText style={hint}>
          {webtoonFit(settings.pageFit) === 'fit-page' ? 'One page at a time, like Paged' : 'Continuous scroll'}
        </ThemedText>
      )}
      <Segment
        label="Double-tap"
        testIdPrefix="reader.settings.double-tap"
        value={settings.doubleTap}
        options={[
          ['magnify', 'Magnify'],
          ['switch-fit', 'Switch fit'],
          ['off', 'Off'],
        ]}
        onChange={(v) => set({ doubleTap: v as DoubleTapMode })}
      />
      <Segment
        label="Page layout"
        testIdPrefix="reader.settings.page-layout"
        value={settings.pageLayout}
        options={[
          ['single', 'Single'],
          ['double', 'Double'],
          ['auto', 'Auto'],
        ]}
        onChange={(v) => set({ pageLayout: v as PageLayout })}
        disabled={!paged}
      />
      {paged && settings.pageLayout === 'auto' && (
        <ThemedText style={hint}>
          {desktop ? 'Two pages side by side when the window is wider than tall' : 'Two pages side by side in landscape'}
        </ThemedText>
      )}
      <ToggleRow
        label="Shift spreads by a page"
        testID="reader.settings.spread-shift"
        value={shift}
        onChange={(v) => seriesKey && setSpreadShift(seriesKey, v)}
        disabled={!pairing || !seriesKey}
      />
      <ToggleRow
        label="Keep screen on"
        testID="reader.settings.keep-awake"
        value={settings.keepAwake}
        onChange={(v) => set({ keepAwake: v })}
      />
      <ToggleRow
        label="Show page count when hidden"
        testID="reader.settings.page-count"
        value={settings.pageCountWhenHidden}
        onChange={(v) => set({ pageCountWhenHidden: v })}
      />
      <ToggleRow
        label="Respect safe areas"
        testID="reader.settings.safe-area"
        value={settings.respectSafeArea}
        onChange={(v) => set({ respectSafeArea: v })}
      />
      {/* The web image ignores `allowDownscaling` — the browser decodes an <img> its own way. */}
      {Platform.OS !== 'web' && (
        <ToggleRow
          label="Downsample images"
          testID="reader.settings.downsample"
          value={settings.downsample}
          onChange={(v) => set({ downsample: v })}
        />
      )}
      <StepperRow
        label="Preload ahead"
        testIdPrefix="reader.settings.preload-ahead"
        value={settings.prefetchAhead}
        min={PREFETCH_AHEAD_MIN}
        max={PREFETCH_AHEAD_MAX}
        onChange={(v) => set({ prefetchAhead: v })}
      />
    </View>
  );
}

/** The layout webtoon gives a page fit — see `PageFit`: one page per screen, or the strip. */
export function webtoonFit(fit: PageFit): 'fit-page' | 'fit-width' {
  return fit === 'fit-width' ? 'fit-width' : 'fit-page';
}

const DIRECTION_OPTIONS: { value: 'ltr' | 'vertical' | 'rtl'; label: string; Icon: ComponentType<IconProps> }[] = [
  { value: 'ltr', label: 'L → R', Icon: MoveRightIcon },
  { value: 'vertical', label: 'Vertical', Icon: MoveVerticalIcon },
  { value: 'rtl', label: 'R → L', Icon: MoveLeftIcon },
];

/** Merges "Mode" (Paged/Webtoon) and "Direction" (L→R/R→L) into one 3-way row —
 *  reading direction is really one choice, not two independent settings. Picking
 *  "Vertical" only touches `mode`; `direction` is left as whatever it was, so
 *  switching back to L→R/R→L restores it (harmless — unread while webtoon). */
function DirectionRow({
  settings,
  set,
}: {
  settings: ReaderSettings;
  set: (patch: Partial<ReaderSettings>) => void;
}) {
  const c = useSegmentColors();
  const value = settings.mode === 'webtoon' ? 'vertical' : settings.direction;
  const onChange = (v: 'ltr' | 'vertical' | 'rtl') =>
    v === 'vertical' ? set({ mode: 'webtoon' }) : set({ mode: 'paged', direction: v as ReaderDirection });
  return (
    <View style={styles.seg}>
      <ThemedText style={c.label}>Reading direction</ThemedText>
      <View style={styles.segRow}>
        {DIRECTION_OPTIONS.map(({ value: v, label, Icon }) => {
          const on = value === v;
          return (
            <Pressable
              key={v}
              testID={testId('reader.settings.direction', v)}
              onPress={() => onChange(v)}
              style={[styles.opt, styles.optIcon, on ? c.optOn : c.opt]}>
              <Icon color={on ? c.onColor : c.offColor} size={18} />
              <ThemedText style={on ? c.optTextOn : c.optText}>{label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A bounded whole number: label on the left, the platform's integer control on the right (see
 *  `IntStepper` — a system stepper on iOS, a discrete slider on Android, −/+ on web). */
function StepperRow({
  label,
  value,
  min,
  max,
  onChange,
  testIdPrefix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  testIdPrefix: string;
}) {
  const c = useSegmentColors();
  return (
    <View style={styles.toggleRow}>
      <ThemedText style={c.label}>{label}</ThemedText>
      <IntStepper
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        testIdPrefix={testIdPrefix}
        // The sheet springs up from below the screen; the native control is mounted once it has
        // arrived — see `deferMountMs`.
        deferMountMs={SHEET_SETTLE_MS}
      />
    </View>
  );
}

/** A boolean row: label on the left, the app's switch (the same `ThemedSwitch` every Settings
 *  toggle uses) on the right — an on/off choice is a switch, not a two-way segment. */
function ToggleRow({
  label,
  value,
  onChange,
  testID,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID: string;
  disabled?: boolean;
}) {
  const c = useSegmentColors();
  return (
    <View style={[styles.toggleRow, disabled && styles.disabled]}>
      <ThemedText style={c.label}>{label}</ThemedText>
      <ThemedSwitch testID={testID} value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

function Segment({
  label,
  value,
  options,
  onChange,
  testIdPrefix,
  disabled = false,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  testIdPrefix: string;
  disabled?: boolean;
}) {
  const c = useSegmentColors();
  return (
    <View style={[styles.seg, disabled && styles.disabled]}>
      <ThemedText style={c.label}>{label}</ThemedText>
      <View style={styles.segRow}>
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <Pressable
              key={v}
              testID={testId(testIdPrefix, v)}
              onPress={() => onChange(v)}
              disabled={disabled}
              accessibilityState={{ disabled, selected: on }}
              style={[styles.opt, on ? c.optOn : c.opt]}>
              <ThemedText style={on ? c.optTextOn : c.optText}>{l}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function useSegmentColors() {
  const theme = useTheme();
  return {
    label: [styles.segLabel, { color: theme.text }],
    opt: { backgroundColor: theme.overlayHover },
    optOn: { backgroundColor: theme.accent },
    optText: [styles.optText, { color: theme.text }],
    optTextOn: [styles.optText, styles.optTextOn, { color: theme.accentOn }],
    offColor: theme.text,
    onColor: theme.accentOn,
  };
}

const styles = StyleSheet.create({
  gear: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: Spacing.three,
  },
  seg: {
    gap: Spacing.one,
  },
  // One label style for every row, segment and switch alike.
  segLabel: {
    fontSize: 13,
  },
  segRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  opt: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.one,
    ...ContinuousCorner,
    borderRadius: Spacing.two,
  },
  optIcon: {
    gap: 4,
  },
  optText: {
    fontSize: 13,
  },
  optTextOn: {
    fontWeight: '600',
  },
  hint: {
    fontSize: 11,
  },
  disabled: {
    opacity: 0.4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
