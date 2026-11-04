import { Button, Form, Host, HStack, Image, LabeledContent, Picker, RNHostView, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  background,
  bold,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  monospacedDigit,
  padding,
  pickerStyle,
  scrollContentBackground,
  shapes,
  tag,
  textSelection,
} from '@expo/ui/swift-ui/modifiers';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { fieldTestID, type SettingsField, type SettingsIcon, type SettingsListProps } from '@/components/settings/settings-form';
import { useReselectScrollToTop } from '@/hooks/use-scroll-to-top-on-reselect';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

import { ContentScrollAnchor, type ContentScrollAnchorRef } from '../../../modules/content-scroll-view';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });
const PRIMARY = foregroundStyle({ type: 'hierarchical', style: 'primary' });
const FOOTNOTE = font({ textStyle: 'footnote' });

/**
 * A settings screen's sections (`settings-form.ts`) as a SwiftUI form, the shape of the system's
 * own Settings: grouped sections headed and footed by their text, the system's switches, menu
 * pickers, buttons and label–value rows, scrolling under the navigation bar the screen's `TopBar`
 * sets. The form is a list, which sizes itself to what it is offered rather than to its rows, so
 * the host hands it the screen. Its own grouped background is dropped for the screen's, and its
 * rows take the card colour the app's rows have, so a page reads the same as it does elsewhere.
 *
 * The list sits a few views into the SwiftUI host, where neither UIKit nor react-native-screens'
 * marker finds it: the content-scroll-view anchor names it to the screen's controller (the bar's
 * slide, and the tab bar's edge on the landing tab), and scrolls it on the tab's reselect.
 * `column` is the reading column's cap, which the form has no need of: a list insets itself.
 */
export function SettingsList({ sections, reselectRoute }: SettingsListProps) {
  const scheme = useActiveColorScheme();
  const theme = useTheme();
  const anchor = useRef<ContentScrollAnchorRef>(null);
  useReselectScrollToTop(reselectRoute, () => void anchor.current?.scrollToTop());
  const form = (
    <Host style={styles.fill} colorScheme={scheme} seedColor={theme.accent} useViewportSizeMeasurement>
      <Form modifiers={[scrollContentBackground('hidden')]}>
        {sections.map(
          (section, i) =>
            section.fields.length > 0 && (
              <Section
                key={section.title ?? i}
                title={section.title}
                footer={section.footer ? <Text>{section.footer}</Text> : undefined}
                modifiers={[listRowBackground(theme.backgroundElement)]}>
                {section.fields.map((field) => (
                  <Field key={fieldTestID(field)} field={field} />
                ))}
              </Section>
            ),
        )}
      </Form>
    </Host>
  );
  if (!ContentScrollAnchor) return form;
  return (
    <ContentScrollAnchor ref={anchor} style={styles.fill} tabBar={!!reselectRoute}>
      {form}
    </ContentScrollAnchor>
  );
}

function Field({ field }: { field: SettingsField }) {
  const theme = useTheme();
  const id = fieldTestID(field);
  switch (field.kind) {
    case 'toggle': {
      const modifiers = [accessibilityIdentifier(id), ...(field.disabled ? [disabled()] : [])];
      return field.description ? (
        <Toggle isOn={field.value} onIsOnChange={field.onChange} modifiers={modifiers}>
          <Labelled label={field.label} description={field.description} />
        </Toggle>
      ) : (
        <Toggle label={field.label} isOn={field.value} onIsOnChange={field.onChange} modifiers={modifiers} />
      );
    }
    case 'select':
      // The menu picker: label leading, the current value and its chevrons trailing, the options
      // as a system menu. An option's `description` has no line in a menu, so it is not shown.
      return (
        <Picker
          label={field.description ? <Labelled label={field.label} description={field.description} /> : field.label}
          selection={field.value}
          onSelectionChange={(v) => field.onChange(String(v))}
          modifiers={[pickerStyle('menu'), accessibilityIdentifier(id)]}>
          {field.options.map((option) => (
            <Text key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </Text>
          ))}
        </Picker>
      );
    case 'link':
      // A button whose label is the whole row, so the row highlights as the system's do; its text
      // is set back to the primary colour, since a button's label is tinted.
      return (
        <Button onPress={field.onPress} modifiers={[accessibilityIdentifier(id)]}>
          <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
            {field.icon ? <Tile icon={field.icon} /> : null}
            <Labelled label={field.label} description={field.description} primary />
            <Spacer />
            {field.value !== undefined ? (
              <Text modifiers={[SECONDARY, lineLimit(1)]}>{field.value}</Text>
            ) : null}
            {field.progress !== undefined ? (
              <Text modifiers={[SECONDARY, monospacedDigit()]}>{`${Math.round(field.progress * 100)}%`}</Text>
            ) : null}
            {field.badge !== undefined && field.badge > 0 ? <Pip count={field.badge} /> : null}
            <Image systemName="chevron.right" size={13} modifiers={[TERTIARY, font({ size: 13, weight: 'semibold' })]} />
          </HStack>
        </Button>
      );
    case 'action': {
      const modifiers = [accessibilityIdentifier(id), ...(field.disabled ? [disabled()] : [])];
      if (!field.description && field.detail === undefined && !field.marked) {
        return <Button label={field.label} role={field.role} onPress={field.onPress} modifiers={modifiers} />;
      }
      return (
        <Button role={field.role} onPress={field.onPress} modifiers={modifiers}>
          <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
            {field.marked ? <Image systemName="circle.fill" size={8} color={theme.accent} /> : null}
            <Labelled label={field.label} description={field.description} />
            <Spacer />
            {field.detail !== undefined ? <Text modifiers={[SECONDARY, lineLimit(1)]}>{field.detail}</Text> : null}
          </HStack>
        </Button>
      );
    }
    case 'value': {
      const label = <Labelled label={field.label} description={field.description} selectable={field.selectable} />;
      if (field.value === undefined) return <HStack modifiers={[accessibilityIdentifier(id)]}>{label}</HStack>;
      return (
        <LabeledContent label={label} modifiers={[accessibilityIdentifier(id)]}>
          <Text modifiers={field.selectable ? [textSelection(true), lineLimit(1)] : [lineLimit(1)]}>{field.value}</Text>
        </LabeledContent>
      );
    }
    case 'note':
      return (
        <VStack alignment="leading" spacing={4} modifiers={[accessibilityIdentifier(id), padding({ vertical: 4 })]}>
          <HStack spacing={8}>
            <Text modifiers={[bold()]}>{field.title}</Text>
            <Spacer />
            {field.caption ? <Text modifiers={[FOOTNOTE, SECONDARY]}>{field.caption}</Text> : null}
          </HStack>
          {field.text ? <Text modifiers={field.selectable ? [textSelection(true)] : undefined}>{field.text}</Text> : null}
          {field.lines?.map((line, i) => (
            <HStack key={`${i}-${line}`} alignment="top" spacing={6}>
              <Text modifiers={[SECONDARY]}>•</Text>
              <Text modifiers={field.selectable ? [textSelection(true)] : undefined}>{line}</Text>
            </HStack>
          ))}
        </VStack>
      );
    case 'custom':
      // The screen's own block, hosted in a row of its own with no inset of the row's: the block
      // keeps the inset it draws with elsewhere.
      return (
        <VStack modifiers={[listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 })]}>
          <RNHostView matchContents={{ vertical: true }}>
            <View testID={id}>{field.render()}</View>
          </RNHostView>
        </VStack>
      );
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

/** A row's label, with its note under it in the footnote size where it has one. */
function Labelled({
  label,
  description,
  primary,
  selectable,
}: {
  label: string;
  description?: string;
  primary?: boolean;
  selectable?: boolean;
}) {
  const title = <Text modifiers={primary ? [PRIMARY] : undefined}>{label}</Text>;
  if (!description) return title;
  return (
    <VStack alignment="leading" spacing={2}>
      {title}
      <Text modifiers={selectable ? [FOOTNOTE, SECONDARY, textSelection(true)] : [FOOTNOTE, SECONDARY]}>{description}</Text>
    </VStack>
  );
}

/** The leading tile of a landing-screen row: the glyph on a tinted rounded square, as the system's
 *  Settings rows have, the size the app's own tile is (`settings-form.tsx`). */
function Tile({ icon }: { icon: SettingsIcon }) {
  const theme = useTheme();
  return (
    <Image
      systemName={icon.symbol}
      size={15}
      color={theme.text}
      modifiers={[frame({ width: 28, height: 28 }), background(theme.tileWash, shapes.roundedRectangle({ cornerRadius: 7 }))]}
    />
  );
}

/** The counted accent pill the tab badge is, trailing on the row. */
function Pip({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <Text
      modifiers={[
        font({ size: 12, weight: 'bold' }),
        foregroundStyle(theme.accentOn),
        padding({ horizontal: 6, vertical: 2 }),
        background(theme.accent, shapes.capsule()),
      ]}>
      {count > 9 ? '9+' : String(count)}
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
