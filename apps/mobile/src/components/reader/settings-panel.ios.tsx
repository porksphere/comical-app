import { Form, Host, Picker, Section, Stepper, Text, Toggle } from '@expo/ui/swift-ui';
import { accessibilityIdentifier, disabled, pickerStyle, scrollContentBackground, tag } from '@expo/ui/swift-ui/modifiers';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, type ViewInstance } from 'react-native';

import { SettingsIcon } from '@/components/icons/reader-icons';
import { useReaderSettingsForm, type ReaderSettingsField } from '@/components/reader/reader-settings-form';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { holdSystemSheet } from '@/lib/native-overlay-sheets';
import { presentReaderSettings } from '@/lib/nav';
import { testId } from '@/lib/test-id';

/** Gear button that opens the reader's settings — the custom toolbar's, which iOS shows only off
 *  the system bar (see `ReaderNativeToolbar` for the bar's own gear). */
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

/**
 * The reader's settings as a system form sheet (`app/reader-settings`), over the reader. The
 * settings are global state, so the sheet needs nothing from the reader but the series the spread
 * shift is stored against, a route param. `onOpenChange` follows the sheet, for the reader to hold
 * its chrome up: on from the push, off when the screen under the sheet is focused again, which is
 * how a sheet swiped away reports itself. The sheet is counted as a system sheet BEFORE the push,
 * since the blur the push causes is what the screen's holds (the hidden tab bar) are released on.
 * `ref` is for the base's anchored overlay; a system sheet has no anchor.
 */
export function useReaderSettingsOverlay(seriesKey: string | null, onOpenChange?: (open: boolean) => void) {
  const ref = useRef<ViewInstance>(null);
  const navigation = useNavigation();
  const release = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !onOpenChange) return;
    onOpenChange(true);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        release.current?.();
        release.current = null;
        setOpen(false);
      }),
    [navigation],
  );
  // The screen leaving under an open sheet (a deep link) gives the count back itself.
  useEffect(() => () => release.current?.(), []);
  const openSheet = () => {
    if (release.current) return;
    release.current = holdSystemSheet();
    setOpen(true);
    presentReaderSettings(seriesKey);
  };
  return { ref, open: openSheet };
}

// Under the system's glass (iOS 26) the form's own grouped background is dropped, so the sheet
// shows through it, as the root layout clears the sheet's content behind it.
const SHEET_GLASS = isLiquidGlassAvailable();

/**
 * The reader's settings (`useReaderSettingsForm`) as a SwiftUI form, the shape of the system's own
 * settings: each choice a segmented control in a section of its own, headed by its label and
 * footed by its note; the switches and the stepper together in one. The form is a list, which
 * sizes itself to what it is offered rather than to its rows, so the host hands it the sheet's
 * viewport and the form scrolls inside the sheet's detent.
 */
export function ReaderSettingsBody({ seriesKey }: { seriesKey: string | null }) {
  const fields = useReaderSettingsForm(seriesKey);
  const scheme = useActiveColorScheme();
  const theme = useTheme();
  return (
    <Host style={styles.host} colorScheme={scheme} seedColor={theme.accent} useViewportSizeMeasurement>
      <Form modifiers={SHEET_GLASS ? [scrollContentBackground('hidden')] : undefined}>
        {sections(fields).map((section) => {
          const [head] = section;
          return head.kind === 'choice' ? (
            <Section key={head.key} title={head.label} footer={head.hint ? <Text>{head.hint}</Text> : undefined}>
              <Field field={head} />
            </Section>
          ) : (
            <Section key={head.key}>
              {section.map((field) => (
                <Field key={field.key} field={field} />
              ))}
            </Section>
          );
        })}
      </Form>
    </Host>
  );
}

/** A choice stands alone, with its label as the section's title; the rest run together. */
function sections(fields: ReaderSettingsField[]): ReaderSettingsField[][] {
  const out: ReaderSettingsField[][] = [];
  for (const field of fields) {
    const last = out.at(-1);
    if (field.kind !== 'choice' && last && last[0]!.kind !== 'choice') last.push(field);
    else out.push([field]);
  }
  return out;
}

function Field({ field }: { field: ReaderSettingsField }) {
  const id = `reader.settings.${field.key}`;
  switch (field.kind) {
    case 'choice':
      return (
        <Picker
          selection={field.value}
          onSelectionChange={(v) => field.onChange(String(v))}
          modifiers={[pickerStyle('segmented'), accessibilityIdentifier(id), ...(field.disabled ? [disabled()] : [])]}>
          {field.options.map((option) => (
            <Text key={option.value} modifiers={[tag(option.value), accessibilityIdentifier(testId(id, option.value))]}>
              {option.label}
            </Text>
          ))}
        </Picker>
      );
    case 'toggle':
      return (
        <Toggle
          label={field.label}
          isOn={field.value}
          onIsOnChange={field.onChange}
          modifiers={[accessibilityIdentifier(id), ...(field.disabled ? [disabled()] : [])]}
        />
      );
    case 'stepper':
      return (
        <Stepper
          label={`${field.label}: ${field.value}`}
          value={field.value}
          min={field.min}
          max={field.max}
          step={1}
          onValueChange={(v) => field.onChange(Math.round(v))}
          modifiers={[accessibilityIdentifier(id)]}
        />
      );
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

const styles = StyleSheet.create({
  gear: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  host: {
    flex: 1,
  },
});
