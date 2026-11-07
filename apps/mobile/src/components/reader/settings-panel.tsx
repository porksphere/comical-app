import { useEffect, type ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MoveLeftIcon, MoveRightIcon, MoveVerticalIcon, SettingsIcon } from '@/components/icons/reader-icons';
import type { IconProps } from '@/components/icons/ui-icons';
import { OverlayHeading, useAnchoredOverlay } from '@/components/overlay/overlay';
import { IntStepper } from '@/components/reader/int-stepper';
import { readerSettingsSections, useReaderSettingsForm, type ReaderSettingsField } from '@/components/reader/reader-settings-form';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
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
  const { ref, open } = useReaderSettingsOverlay(seriesKey, onOpenChange);
  return (
    <Pressable
      testID="reader.settings.open"
      ref={ref}
      hitSlop={12}
      onPress={open}
      style={styles.gear}
      accessibilityRole="button"
      accessibilityLabel="Reader settings">
      <SettingsIcon color="#fff" size={20} />
    </Pressable>
  );
}

/** The settings sheet behind any trigger: anchored to `ref` when the trigger is a view that can
 *  be measured (the gear above), a plain sheet when it is not. `onOpenChange` follows the sheet,
 *  for the reader to hold its chrome up while it is open. (iOS presents a system sheet of its own
 *  instead — the `.ios` sibling.) */
export function useReaderSettingsOverlay(seriesKey: string | null, onOpenChange?: (open: boolean) => void) {
  const { ref, openAt, isOpen } = useAnchoredOverlay();
  useEffect(() => {
    if (!isOpen || !onOpenChange) return;
    onOpenChange(true);
    return () => onOpenChange(false);
  }, [isOpen, onOpenChange]);
  const open = () => openAt(() => <ReaderSettingsBody seriesKey={seriesKey} />);
  return { ref, open };
}

/** The reader's settings (`useReaderSettingsForm`) as the custom panel: segments, the app's switch
 *  and the platform's stepper, inside the overlay (sheet or popover).
 *  Note: the overlay panel follows the app's theme (`useTheme`), so under a
 *  light appearance it renders light while the reader keeps its own always-dark
 *  viewing surface — an intentional split, matching how media
 *  readers stay dark for immersion while their controls track the app theme.
 *  So every colour in here is the theme's: a hardcoded white was white on white. */
export function ReaderSettingsBody({ seriesKey }: { seriesKey: string | null }) {
  const fields = useReaderSettingsForm(seriesKey);
  const theme = useTheme();
  return (
    <View style={styles.content}>
      <OverlayHeading>Reader settings</OverlayHeading>
      {/* The model's groups, as the iOS sheet draws them (`readerSettingsSections`). */}
      {readerSettingsSections(fields).map((section) => (
        <View key={section.id} style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>{section.title.toUpperCase()}</ThemedText>
          {section.fields.map((field) => (
            <Field key={field.key} field={field} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Field({ field }: { field: ReaderSettingsField }) {
  const theme = useTheme();
  switch (field.kind) {
    case 'choice':
      return (
        <>
          <Segment field={field} />
          {field.hint ? <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>{field.hint}</ThemedText> : null}
        </>
      );
    case 'toggle':
      return <ToggleRow field={field} />;
    case 'stepper':
      return <StepperRow field={field} />;
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

// The reading direction's options draw their arrow beside the label.
const OPTION_ICONS: Record<string, ComponentType<IconProps>> = {
  ltr: MoveRightIcon,
  vertical: MoveVerticalIcon,
  rtl: MoveLeftIcon,
};

/** A bounded whole number: label on the left, the platform's integer control on the right (see
 *  `IntStepper` — a system stepper on iOS, a discrete slider on Android, −/+ on web). */
function StepperRow({ field }: { field: Extract<ReaderSettingsField, { kind: 'stepper' }> }) {
  const c = useSegmentColors();
  return (
    <View style={styles.toggleRow}>
      <ThemedText style={c.label}>{field.label}</ThemedText>
      <IntStepper
        value={field.value}
        min={field.min}
        max={field.max}
        onChange={field.onChange}
        testIdPrefix={`reader.settings.${field.key}`}
        // The sheet springs up from below the screen; the native control is mounted once it has
        // arrived — see `deferMountMs`.
        deferMountMs={SHEET_SETTLE_MS}
      />
    </View>
  );
}

/** A boolean row: label on the left, the app's switch (the same `ThemedSwitch` every Settings
 *  toggle uses) on the right — an on/off choice is a switch, not a two-way segment. */
function ToggleRow({ field }: { field: Extract<ReaderSettingsField, { kind: 'toggle' }> }) {
  const c = useSegmentColors();
  const disabled = field.disabled ?? false;
  return (
    <View style={[styles.toggleRow, disabled && styles.disabled]}>
      <ThemedText style={c.label}>{field.label}</ThemedText>
      <ThemedSwitch
        testID={`reader.settings.${field.key}`}
        value={field.value}
        onValueChange={field.onChange}
        disabled={disabled}
      />
    </View>
  );
}

function Segment({ field }: { field: Extract<ReaderSettingsField, { kind: 'choice' }> }) {
  const c = useSegmentColors();
  const disabled = field.disabled ?? false;
  return (
    <View style={[styles.seg, disabled && styles.disabled]}>
      <ThemedText style={c.label}>{field.label}</ThemedText>
      <View style={styles.segRow}>
        {field.options.map((option) => {
          const on = field.value === option.value;
          const Icon = OPTION_ICONS[option.value];
          return (
            <Pressable
              key={option.value}
              testID={testId(`reader.settings.${field.key}`, option.value)}
              onPress={() => field.onChange(option.value)}
              disabled={disabled}
              accessibilityState={{ disabled, selected: on }}
              style={[styles.opt, Icon && styles.optIcon, on ? c.optOn : c.opt]}>
              {Icon ? <Icon color={on ? c.onColor : c.offColor} size={18} /> : null}
              <ThemedText style={on ? c.optTextOn : c.optText}>{option.label}</ThemedText>
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
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.three,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: -Spacing.one,
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
