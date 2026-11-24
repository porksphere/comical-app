import {
  Column,
  Row,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Slider,
  Switch,
  Text,
} from '@expo/ui/jetpack-compose';
import { alpha, fillMaxWidth, testID as testTag, weight, width } from '@expo/ui/jetpack-compose/modifiers';
import { StyleSheet } from 'react-native';

import { MaterialHost } from '@/components/material-host';
import { readerSettingsSections, type ReaderSettingsField } from '@/components/reader/reader-settings-form';
import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

const SLIDER_WIDTH = 160;
const DISABLED = 0.4;

/**
 * Android: the reader's settings as one Jetpack Compose column, sized to its content inside the
 * sheet's own scroller. A choice is Material's segmented buttons, a toggle its switch, a bounded
 * number its discrete slider (Material has no stepper). Each control carries the test id its
 * counterpart in the app's own panel has.
 */
export function ReaderSettingsFields({ fields }: { fields: ReaderSettingsField[] }) {
  const theme = useTheme();
  return (
    <MaterialHost matchContents={{ vertical: true }} style={styles.host}>
      <Column verticalArrangement={{ spacedBy: 24 }} modifiers={[fillMaxWidth()]}>
        {readerSettingsSections(fields).map((section) => (
          <Column key={section.id} verticalArrangement={{ spacedBy: 16 }} modifiers={[fillMaxWidth()]}>
            <Text color={theme.accent} style={{ typography: 'labelLarge' }}>
              {section.title}
            </Text>
            {section.fields.map((field) => (
              <Field key={field.key} field={field} />
            ))}
          </Column>
        ))}
      </Column>
    </MaterialHost>
  );
}

function Field({ field }: { field: ReaderSettingsField }) {
  const theme = useTheme();
  const id = `reader.settings.${field.key}`;
  switch (field.kind) {
    case 'choice': {
      const disabled = field.disabled ?? false;
      return (
        <Column verticalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth(), alpha(disabled ? DISABLED : 1)]}>
          <Text style={{ typography: 'bodyLarge' }}>{field.label}</Text>
          <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
            {field.options.map((option) => (
              <SegmentedButton
                key={option.value}
                selected={field.value === option.value}
                enabled={!disabled}
                modifiers={[testTag(testId(id, option.value))]}
                onClick={() => {
                  hapticSelection();
                  field.onChange(option.value);
                }}>
                <SegmentedButton.Label>
                  <Text maxLines={1}>{option.label}</Text>
                </SegmentedButton.Label>
              </SegmentedButton>
            ))}
          </SingleChoiceSegmentedButtonRow>
          {field.hint ? (
            <Text color={theme.textSecondary} style={{ typography: 'bodySmall' }}>
              {field.hint}
            </Text>
          ) : null}
        </Column>
      );
    }
    case 'toggle': {
      const disabled = field.disabled ?? false;
      return (
        <Row verticalAlignment="center" modifiers={[fillMaxWidth(), alpha(disabled ? DISABLED : 1)]}>
          <Text style={{ typography: 'bodyLarge' }} modifiers={[weight(1)]}>
            {field.label}
          </Text>
          <Switch
            value={field.value}
            enabled={!disabled}
            modifiers={[testTag(id)]}
            onCheckedChange={(value) => {
              hapticSelection();
              field.onChange(value);
            }}
          />
        </Row>
      );
    }
    case 'stepper':
      return (
        <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 12 }} modifiers={[fillMaxWidth()]}>
          <Text style={{ typography: 'bodyLarge' }} modifiers={[weight(1)]}>
            {field.label}
          </Text>
          <Text style={{ typography: 'labelLarge' }} modifiers={[testTag(testId(id, 'value'))]}>
            {String(field.value)}
          </Text>
          <Slider
            value={field.value}
            min={field.min}
            max={field.max}
            // Material counts the stops BETWEEN the ends.
            steps={Math.max(0, field.max - field.min - 1)}
            modifiers={[width(SLIDER_WIDTH)]}
            onValueChange={(v) => field.onChange(Math.round(v))}
          />
        </Row>
      );
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

const styles = StyleSheet.create({
  host: {
    alignSelf: 'stretch',
  },
});
