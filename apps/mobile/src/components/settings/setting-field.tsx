import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRightIcon, MinusIcon, PlusIcon } from '@/components/icons/ui-icons';
import { MeasuredHeader, OptionList, OverlayHeading, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { SettingsSelectRow, SettingsTextRow, SettingsToggleRow, type SettingsOption } from '@/components/settings/settings-fields';
import { settingsRowFrame, SettingsRow } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { SettingDescriptor, SettingValue } from '@/data/api';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight, hapticSelection } from '@/lib/haptics';

type FieldProps<D extends SettingDescriptor> = {
  descriptor: D;
  value: SettingValue | undefined;
  /** True when a `secret` string field already has a stored value server-side
   *  (the server never sends the value itself, just this flag). */
  secretSet?: boolean;
  onChange: (v: SettingValue) => void;
};

/** Label with a trailing `*` for a required field. */
const fieldLabel = (d: SettingDescriptor): string => `${d.label}${'required' in d && d.required ? ' *' : ''}`;

/**
 * Dispatches to the right control for a `SettingDescriptor`, one per descriptor inside a
 * `SettingsSection` (`bridge-settings.tsx` / `tracker-settings.tsx`). Every type renders as a standard
 * settings row — string/number via `SettingsTextRow`, boolean via `SettingsToggleRow`, a single enum
 * via `SettingsSelectRow` — so a bridge's config reads like the rest of Settings. Multi-select enums
 * and bounded numbers keep their own controls (a multi picker, a ± stepper), framed as rows.
 */
export function SettingFieldEditor({ descriptor, value, onChange }: FieldProps<SettingDescriptor>) {
  switch (descriptor.type) {
    case 'string':
      return (
        <SettingsTextRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          value={(value as string | undefined) ?? ''}
          onChange={onChange}
          // A secret reads as a password field: a masked dots placeholder (whether or not one is
          // already stored — leaving it blank keeps the existing value), revealed with the eye button.
          placeholder={descriptor.secret ? '••••••••' : (descriptor.placeholder ?? 'Type…')}
          secureTextEntry={!!descriptor.secret}
          autoCapitalize="none"
          autoCorrect={false}
        />
      );
    case 'number':
      if (descriptor.min !== undefined && descriptor.max !== undefined) {
        return <StepperRow descriptor={descriptor} value={value as number | undefined} onChange={onChange} />;
      }
      return (
        <SettingsTextRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          // Sent as a raw string on save — the server's settings validator coerces a numeric string.
          value={value === undefined ? '' : String(value)}
          onChange={onChange}
          keyboardType="numeric"
          placeholder={descriptor.default !== undefined ? String(descriptor.default) : undefined}
        />
      );
    case 'boolean':
      return (
        <SettingsToggleRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          value={(value as boolean | undefined) ?? descriptor.default ?? false}
          onChange={onChange}
        />
      );
    case 'enum':
      if (descriptor.multiple) {
        return <MultiEnumRow descriptor={descriptor} value={value} onChange={onChange} />;
      }
      return (
        <SettingsSelectRow
          label={fieldLabel(descriptor)}
          description={descriptor.description}
          value={typeof value === 'string' ? value : ''}
          options={descriptor.options.map((o): SettingsOption<string> => ({ value: o.value, label: o.label }))}
          onChange={onChange}
          heading={descriptor.label}
          placeholder="Select…"
        />
      );
    case 'oauth-pin':
    case 'oauth-callback':
      return <SettingsRow label={descriptor.label} description="Manage this in the web app." />;
  }
}

/** A bounded number as a settings row: label on the left, a −/+ stepper on the right. */
function StepperRow({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'number' }>;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const min = descriptor.min!;
  const max = descriptor.max!;
  const n = value ?? descriptor.default ?? min;
  return (
    <View style={[settingsRowFrame.row, settingsRowFrame.escape]}>
      <View style={settingsRowFrame.text}>
        <ThemedText type="small" numberOfLines={1}>
          {fieldLabel(descriptor)}
        </ThemedText>
        {descriptor.description && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {descriptor.description}
          </ThemedText>
        )}
      </View>
      <View style={styles.stepper}>
        <StepperButton icon="minus" disabled={n <= min} onPress={() => onChange(Math.max(min, n - 1))} />
        <ThemedText type="smallBold" style={styles.stepperValue}>
          {n}
        </ThemedText>
        <StepperButton icon="plus" disabled={n >= max} onPress={() => onChange(Math.min(max, n + 1))} />
      </View>
    </View>
  );
}

function StepperButton({ icon, onPress, disabled }: { icon: 'minus' | 'plus'; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      disabled={disabled}
      android_ripple={{ color: theme.backgroundElement, borderless: true }}
      style={[styles.pressableCursor, disabled && styles.stepBtnDisabled]}>
      <ThemedView type="backgroundSelected" style={styles.stepBtn}>
        {icon === 'minus' ? <MinusIcon color={theme.text} size={18} /> : <PlusIcon color={theme.text} size={18} />}
      </ThemedView>
    </Pressable>
  );
}

/** A multi-select enum as a settings row: label on the left, a comma-joined summary + chevron on the
 *  right, tapping opens the multi-select picker (which stays open as you toggle options). */
function MultiEnumRow({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'enum' }>;
  value: SettingValue | undefined;
  onChange: (v: SettingValue) => void;
}) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const selected = Array.isArray(value) ? value : [];
  const summary =
    selected.length === 0
      ? 'None selected'
      : descriptor.options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(', ');
  return (
    <Pressable
      ref={ref}
      onPress={() => {
        hapticImpactLight();
        openAt(() => <EnumPicker descriptor={descriptor} value={value} onChange={onChange} />);
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <View style={[settingsRowFrame.row, settingsRowFrame.escape, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <View style={settingsRowFrame.text}>
          <ThemedText type="small" numberOfLines={1}>
            {fieldLabel(descriptor)}
          </ThemedText>
          {descriptor.description && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {descriptor.description}
            </ThemedText>
          )}
        </View>
        <View style={styles.rowValue}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.summary}>
            {summary}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        </View>
      </View>
    </Pressable>
  );
}

function EnumPicker({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'enum' }>;
  value: SettingValue | undefined;
  onChange: (v: SettingValue) => void;
}) {
  const { closeTop } = useOverlay();
  const selected = Array.isArray(value) ? value : [];
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeader>
        <OverlayHeading>{descriptor.label}</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
        {descriptor.options.map((opt) => (
          <EnumOption key={opt.value} label={opt.label} on={selected.includes(opt.value)} onPress={() => toggle(opt.value)} />
        ))}
        {/* A "Done" affordance isn't needed — dismissing the sheet commits; the toggles are live. */}
        {selected.length > 0 && (
          <Pressable onPress={closeTop} style={styles.pressableCursor}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold" style={{ color: '#3478F6' }}>
                Done
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
      </OptionList>
    </View>
  );
}

function EnumOption({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <ThemedView type={hovered ? 'backgroundSelected' : 'backgroundElement'} style={styles.row}>
        <ThemedText>{label}</ThemedText>
        <View style={[styles.check, on && { borderColor: theme.accent, backgroundColor: theme.accent }]} />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepperValue: {
    minWidth: 28,
    textAlign: 'center',
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
    minWidth: 0,
  },
  summary: {
    flexShrink: 1,
    minWidth: 0,
  },
  // No `flex: 1` (see `sheetBody` in overlay.tsx) — hugs its MeasuredHeader/OptionList content.
  body: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  pressableCursor: {
    cursor: 'pointer',
  },
});
