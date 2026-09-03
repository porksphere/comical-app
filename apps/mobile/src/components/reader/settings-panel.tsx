import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MoveLeftIcon, MoveRightIcon, MoveVerticalIcon, SettingsIcon } from '@/components/icons/reader-icons';
import type { IconProps } from '@/components/icons/ui-icons';
import { OverlayHeading, useAnchoredOverlay } from '@/components/overlay/overlay';
import { IntStepper } from '@/components/reader/int-stepper';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import {
  PREFETCH_AHEAD_MAX,
  PREFETCH_AHEAD_MIN,
  useReaderSettings,
  type DoubleTapMode,
  type PageFit,
  type ReaderDirection,
  type ReaderSettings,
} from '@/hooks/use-reader-settings';
import { testId } from '@/lib/test-id';

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
export function SettingsControl() {
  const { ref, openAt } = useAnchoredOverlay();

  return (
    <Pressable
      testID="reader.settings.open"
      ref={ref}
      hitSlop={12}
      onPress={() => openAt(() => <SettingsContent />)}
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
 *  readers stay dark for immersion while their controls track the app theme. */
function SettingsContent() {
  const [settings, set] = useReaderSettings();
  return (
    <View style={styles.content}>
      <OverlayHeading>Reader settings</OverlayHeading>
      <DirectionRow settings={settings} set={set} />
      <Segment
        label="Page fit"
        testIdPrefix="reader.settings.page-fit"
        value={settings.pageFit}
        options={[
          ['fit-width', 'Fit width'],
          ['fit-height', 'Fit height'],
        ]}
        onChange={(v) => set({ pageFit: v as PageFit })}
      />
      {settings.mode === 'webtoon' && (
        <ThemedText style={styles.hint}>
          {settings.pageFit === 'fit-height' ? 'One page at a time, like Paged' : 'Continuous scroll'}
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
      <ToggleRow
        label="Keep screen on"
        testID="reader.settings.keep-awake"
        value={settings.keepAwake}
        onChange={(v) => set({ keepAwake: v })}
      />
      <ToggleRow
        label="Page count when hidden"
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
  return fit === 'fit-height' ? 'fit-page' : 'fit-width';
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
  const value = settings.mode === 'webtoon' ? 'vertical' : settings.direction;
  const onChange = (v: 'ltr' | 'vertical' | 'rtl') =>
    v === 'vertical' ? set({ mode: 'webtoon' }) : set({ mode: 'paged', direction: v as ReaderDirection });
  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>Reading direction</ThemedText>
      <View style={styles.segRow}>
        {DIRECTION_OPTIONS.map(({ value: v, label, Icon }) => {
          const on = value === v;
          return (
            <Pressable
              key={v}
              testID={testId('reader.settings.direction', v)}
              onPress={() => onChange(v)}
              style={[styles.opt, styles.optIcon, on && styles.optOn]}>
              <Icon color={on ? '#fff' : 'rgba(255,255,255,0.8)'} size={18} />
              <ThemedText style={[styles.optText, on && styles.optTextOn]}>{label}</ThemedText>
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
  return (
    <View style={styles.toggleRow}>
      <ThemedText style={styles.segLabel}>{label}</ThemedText>
      <IntStepper value={value} min={min} max={max} onChange={onChange} testIdPrefix={testIdPrefix} />
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
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <ThemedText style={styles.segLabel}>{label}</ThemedText>
      <ThemedSwitch testID={testID} value={value} onValueChange={onChange} />
    </View>
  );
}

function Segment({
  label,
  value,
  options,
  onChange,
  testIdPrefix,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  testIdPrefix: string;
}) {
  return (
    <View style={styles.seg}>
      <ThemedText style={styles.segLabel}>{label}</ThemedText>
      <View style={styles.segRow}>
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <Pressable
              key={v}
              testID={testId(testIdPrefix, v)}
              onPress={() => onChange(v)}
              style={[styles.opt, on && styles.optOn]}>
              <ThemedText style={[styles.optText, on && styles.optTextOn]}>{l}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
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
    color: 'rgba(255,255,255,0.8)',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  optIcon: {
    gap: 4,
  },
  optOn: {
    backgroundColor: '#3478F6',
  },
  optText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  optTextOn: {
    color: '#fff',
    fontWeight: '600',
  },
  hint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
