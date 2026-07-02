import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

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
import type { SettingDescriptor, SettingValue } from '@/data/api';
import { useTheme } from '@/hooks/use-theme';

type FieldProps<D extends SettingDescriptor> = {
  descriptor: D;
  value: SettingValue | undefined;
  /** True when a `secret` string field already has a stored value server-side
   *  (the server never sends the value itself, just this flag). */
  secretSet?: boolean;
  onChange: (v: SettingValue) => void;
};

/** Dispatches to the right control for a `SettingDescriptor`. Rendered inline in
 *  a settings form (`bridge-settings.tsx` / `tracker-settings.tsx`), one per
 *  descriptor — not inside an overlay itself (unlike `enum`'s picker, which is). */
export function SettingFieldEditor({ descriptor, value, secretSet, onChange }: FieldProps<SettingDescriptor>) {
  switch (descriptor.type) {
    case 'string':
      return (
        <StringField descriptor={descriptor} value={value as string | undefined} secretSet={secretSet} onChange={onChange} />
      );
    case 'number':
      return <NumberField descriptor={descriptor} value={value as number | undefined} onChange={onChange} />;
    case 'boolean':
      return <BooleanField descriptor={descriptor} value={value as boolean | undefined} onChange={onChange} />;
    case 'enum':
      return <EnumField descriptor={descriptor} value={value} onChange={onChange} />;
    case 'oauth-pin':
    case 'oauth-callback':
      return <OAuthField descriptor={descriptor} />;
  }
}

function FieldWrap({
  label,
  description,
  required,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">
        {label}
        {required ? ' *' : ''}
      </ThemedText>
      {description && (
        <ThemedText type="small" themeColor="textSecondary">
          {description}
        </ThemedText>
      )}
      {children}
    </View>
  );
}

function StringField({
  descriptor,
  value,
  secretSet,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'string' }>;
  value: string | undefined;
  secretSet?: boolean;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <FieldWrap label={descriptor.label} description={descriptor.description} required={descriptor.required}>
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder={
          descriptor.secret && secretSet
            ? '(secret already set — leave blank to keep)'
            : (descriptor.placeholder ?? 'Type…')
        }
        placeholderTextColor={theme.textSecondary}
        secureTextEntry={!!descriptor.secret}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
    </FieldWrap>
  );
}

function NumberField({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'number' }>;
  value: number | undefined;
  onChange: (v: SettingValue) => void;
}) {
  if (descriptor.min !== undefined && descriptor.max !== undefined) {
    return <BoundedNumberField descriptor={descriptor} value={value} onChange={onChange} />;
  }
  return <PlainNumberField descriptor={descriptor} value={value} onChange={onChange} />;
}

function BoundedNumberField({
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
    <FieldWrap label={descriptor.label} description={descriptor.description} required={descriptor.required}>
      <View style={styles.stepper}>
        <StepperButton label="−" disabled={n <= min} onPress={() => onChange(Math.max(min, n - 1))} />
        <ThemedText type="title" style={styles.stepperValue}>
          {n}
        </ThemedText>
        <StepperButton label="+" disabled={n >= max} onPress={() => onChange(Math.min(max, n + 1))} />
      </View>
    </FieldWrap>
  );
}

function PlainNumberField({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'number' }>;
  value: number | undefined;
  onChange: (v: SettingValue) => void;
}) {
  const theme = useTheme();
  return (
    <FieldWrap label={descriptor.label} description={descriptor.description} required={descriptor.required}>
      <TextInput
        // Sent as a raw string on save — the server's settings validator already
        // coerces a numeric string, so no local NaN-handling is needed here.
        value={value === undefined ? '' : String(value)}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder={descriptor.default !== undefined ? String(descriptor.default) : undefined}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
    </FieldWrap>
  );
}

function StepperButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={disabled ? styles.stepBtnDisabled : undefined}>
      <ThemedView type="backgroundSelected" style={styles.stepBtn}>
        <ThemedText type="title">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function BooleanField({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'boolean' }>;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[styles.field, styles.boolRow]}>
      <View style={styles.boolText}>
        <ThemedText type="smallBold">{descriptor.label}</ThemedText>
        {descriptor.description && (
          <ThemedText type="small" themeColor="textSecondary">
            {descriptor.description}
          </ThemedText>
        )}
      </View>
      <Switch value={value ?? descriptor.default ?? false} onValueChange={onChange} />
    </View>
  );
}

function EnumField({
  descriptor,
  value,
  onChange,
}: {
  descriptor: Extract<SettingDescriptor, { type: 'enum' }>;
  value: SettingValue | undefined;
  onChange: (v: SettingValue) => void;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const selected = descriptor.multiple ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? value : undefined;
  const summary = descriptor.multiple
    ? (selected as string[]).length === 0
      ? 'None selected'
      : descriptor.options
          .filter((o) => (selected as string[]).includes(o.value))
          .map((o) => o.label)
          .join(', ')
    : (descriptor.options.find((o) => o.value === selected)?.label ?? 'Select…');
  return (
    <FieldWrap label={descriptor.label} description={descriptor.description} required={descriptor.required}>
      <Pressable ref={ref} onPress={() => openAt(() => <EnumPicker descriptor={descriptor} value={value} onChange={onChange} />)}>
        <ThemedView type="backgroundElement" style={styles.enumRow}>
          <ThemedText numberOfLines={1} style={styles.enumSummary}>
            {summary}
          </ThemedText>
          <ThemedText themeColor="textSecondary">{'›'}</ThemedText>
        </ThemedView>
      </Pressable>
    </FieldWrap>
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
  const [headerHeight, setHeaderHeight] = useState(0);
  const maxHeight = useListMaxHeight(headerHeight);
  const multi = !!descriptor.multiple;
  const selected = multi ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? value : undefined;
  const toggle = (v: string) => {
    if (!multi) {
      onChange(v);
      closeTop();
      return;
    }
    const arr = selected as string[];
    onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeader onHeight={setHeaderHeight}>
        <OverlayHeading>{descriptor.label}</OverlayHeading>
      </MeasuredHeader>
      <OptionList maxHeight={maxHeight}>
        {descriptor.options.map((opt) => {
          const on = multi ? (selected as string[]).includes(opt.value) : selected === opt.value;
          return (
            <Pressable key={opt.value} onPress={() => toggle(opt.value)}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <ThemedText>{opt.label}</ThemedText>
                <View style={[styles.check, on && styles.checkOn]} />
              </ThemedView>
            </Pressable>
          );
        })}
      </OptionList>
    </View>
  );
}

function OAuthField({ descriptor }: { descriptor: Extract<SettingDescriptor, { type: 'oauth-pin' | 'oauth-callback' }> }) {
  return (
    <FieldWrap label={descriptor.label} description={descriptor.description}>
      <ThemedText type="small" themeColor="textSecondary">
        Manage this in the web app.
      </ThemedText>
    </FieldWrap>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 220,
  },
  stepperValue: {
    minWidth: 64,
    textAlign: 'center',
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  boolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  boolText: {
    flex: 1,
    gap: Spacing.half,
  },
  enumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  enumSummary: {
    flex: 1,
  },
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
  checkOn: {
    borderColor: '#3478F6',
    backgroundColor: '#3478F6',
  },
});
