import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  LabeledContent,
  List,
  Picker,
  ProgressView,
  RNHostView,
  Section,
  SecureField,
  Spacer,
  Stepper,
  SwipeActions,
  Text,
  TextField,
  Toggle,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  autocorrectionDisabled,
  background,
  bold,
  clipShape,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  lineLimit,
  listRowBackground,
  listRowInsets,
  monospacedDigit,
  moveDisabled,
  multilineTextAlignment,
  onLongPressGesture,
  onTapGesture,
  padding,
  pickerStyle,
  progressViewStyle,
  refreshable,
  resizable,
  scrollContentBackground,
  shapes,
  tag,
  textInputAutocapitalization,
  textSelection,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChipRow } from '@/components/chip';
import { BAR_SCROLLED_AT, useBarManaged, useBarScrolled, useReportBarRow, useReportBarScrolled } from '@/components/bar-scrolled';
import { useOverlay } from '@/components/overlay/overlay';
import { MultiSelectPicker, multiSummary } from '@/components/settings/multi-select-row';
import {
  fieldKey,
  fieldTestID,
  movedKeys,
  type SettingsField,
  type SettingsFormSection,
  type SettingsIcon,
  type SettingsListProps,
  type SettingsTone,
} from '@/components/settings/settings-form';
import { useReselectScrollToTop } from '@/hooks/use-scroll-to-top-on-reselect';
import { SettingsCardInset, Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { MENU_THUMB_RADIUS, useMenuThumbFiles } from '@/lib/menu-thumb-files';
import { useFoldedBarEdge } from '@/lib/native-bar';
import { testId } from '@/lib/test-id';

import { ContentScrollAnchor, type ContentScrollAnchorRef } from '../../../modules/content-scroll-view';

const FOOTNOTE = font({ textStyle: 'footnote' });
const CHEVRON = font({ size: 13, weight: 'semibold' });

/**
 * A settings screen's sections (`settings-form.ts`) as a SwiftUI form, the shape of the system's
 * own Settings: grouped sections headed and footed by their text, the system's switches, menu
 * pickers, fields, steppers, buttons and label–value rows, scrolling under the navigation bar the
 * screen's `TopBar` sets, with the system's pull to refresh, swipe actions and drag to reorder.
 * The form is a list, which sizes itself to what it is offered rather than to its rows, so the
 * host hands it the screen. Its own grouped background is dropped for the screen's, and its rows
 * take the card colour the app's rows have, so a page reads the same as it does elsewhere.
 *
 * Colour is explicit on every row: a button's label is tinted by the system, and a hierarchical
 * style inside one resolves against that tint, so the theme's text colours are named outright.
 *
 * The list sits a few views into the SwiftUI host, where neither UIKit nor react-native-screens'
 * marker finds it: the content-scroll-view anchor names it to the screen's controller (the bar's
 * slide, and the tab bar's edge on the landing tab), and scrolls it on the tab's reselect.
 * `column` is the reading column's cap, which the form has no need of: a list insets itself.
 */
export function SettingsList({ sections, reselectRoute, refresh }: SettingsListProps) {
  const scheme = useActiveColorScheme();
  const theme = useTheme();
  const anchor = useRef<ContentScrollAnchorRef>(null);
  const report = useReportBarScrolled();
  const reportRow = useReportBarRow();
  const managed = useBarManaged();
  const scrolled = useBarScrolled();
  const foldedEdge = useFoldedBarEdge();
  useReselectScrollToTop(reselectRoute, () => void anchor.current?.scrollToTop());
  const form = (
    <Host style={styles.fill} colorScheme={scheme} seedColor={theme.accent} useViewportSizeMeasurement>
      <Form
        modifiers={[
          scrollContentBackground('hidden'),
          ...(refresh
            ? [
                refreshable(async () => {
                  await refresh();
                }),
              ]
            : []),
        ]}>
        {sections.map(
          (section, i) =>
            section.fields.length > 0 && (
              <Section
                key={section.title ?? i}
                title={section.title}
                footer={section.footer ? <Text>{section.footer}</Text> : undefined}
                modifiers={[listRowBackground(section.plain ? 'transparent' : theme.backgroundElement)]}>
                <Rows section={section} />
              </Section>
            ),
        )}
      </Form>
    </Host>
  );
  if (!ContentScrollAnchor) return form;
  return (
    <ContentScrollAnchor
      ref={anchor}
      style={styles.fill}
      tabBar={!!reselectRoute}
      scrolledPast={report && (managed === 'list' || managed === 'heading') ? BAR_SCROLLED_AT : undefined}
      scrolledUpOnly={managed !== 'heading'}
      onScrolledPast={report && (managed === 'list' || managed === 'heading') ? (e) => report(e.nativeEvent.past) : undefined}
      onBarFrame={reportRow ? (e) => reportRow(e.nativeEvent) : undefined}
      // The screen's own edge option never reaches a SwiftUI list: set on the list itself, where
      // the bar switches its own backing — see ScreenScrollMarker.
      topEdge={managed ? (foldedEdge && scrolled ? 'hard' : 'hidden') : undefined}>
      {form}
    </ContentScrollAnchor>
  );
}

/** A section's rows; an ordered set the user drags into order where the section reorders. */
function Rows({ section }: { section: SettingsFormSection }) {
  const rows = section.fields.map((field) => <Field key={fieldTestID(field)} field={field} section={section} />);
  const { onReorder } = section;
  if (!onReorder) return <>{rows}</>;
  const keys = section.fields.map(fieldKey);
  return <List.ForEach onMove={(from, to) => onReorder(movedKeys(keys, from, to))}>{rows}</List.ForEach>;
}

function Field({ field, section }: { field: SettingsField; section: SettingsFormSection }) {
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
    case 'multi':
      return <MultiRow field={field} id={id} />;
    case 'text':
      return <TextRow field={field} id={id} />;
    case 'stepper':
      // The system stepper names its value in its label; the note is left off, as the system's are.
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
    case 'link':
      return <LinkRow field={field} section={section} id={id} />;
    case 'action': {
      const modifiers = [accessibilityIdentifier(id), ...(field.disabled ? [disabled()] : [])];
      const accent = field.role === 'destructive' ? theme.danger : theme.accent;
      if (!field.description && field.verb === undefined && field.detail === undefined && !field.marked && !field.busy) {
        return <Button label={field.label} role={field.role} onPress={field.onPress} modifiers={modifiers} />;
      }
      // The verb takes the tint where there is one; the label is then a name, in the text colour.
      return (
        <Button role={field.role} onPress={field.onPress} modifiers={modifiers}>
          <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
            {field.marked ? <Image systemName="circle.fill" size={8} color={theme.accent} /> : null}
            <Labelled label={field.label} description={field.description} tone={field.tone} color={field.verb === undefined ? accent : theme.text} />
            <Spacer />
            {field.busy ? (
              <ProgressView modifiers={[progressViewStyle('circular')]} />
            ) : field.verb !== undefined ? (
              <Text modifiers={[foregroundStyle(accent), bold()]}>{field.verb}</Text>
            ) : field.detail !== undefined ? (
              <Text modifiers={[foregroundStyle(theme.textSecondary), lineLimit(1)]}>{field.detail}</Text>
            ) : null}
          </HStack>
        </Button>
      );
    }
    case 'value': {
      const label = <Labelled label={field.label} description={field.description} tone={field.tone} selectable={field.selectable} />;
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
            {field.caption ? <Text modifiers={[FOOTNOTE, foregroundStyle(theme.textSecondary)]}>{field.caption}</Text> : null}
          </HStack>
          {field.text ? <Text modifiers={field.selectable ? [textSelection(true)] : undefined}>{field.text}</Text> : null}
          {field.lines?.map((line, i) => (
            <HStack key={`${i}-${line}`} alignment="top" spacing={6}>
              <Text modifiers={[foregroundStyle(theme.textSecondary)]}>•</Text>
              <Text modifiers={field.selectable ? [textSelection(true)] : undefined}>{line}</Text>
            </HStack>
          ))}
        </VStack>
      );
    case 'chips':
      // The app's own chips, hosted: one chip, drawn once, everywhere.
      return (
        <Hosted id={id}>
          <View style={styles.chips}>
            <ChipRow labels={[...field.items]} accent />
          </View>
        </Hosted>
      );
    case 'custom':
      return <Hosted id={id}>{field.render()}</Hosted>;
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

/** A line of text on the row, trailing its label; a secure one masked. The field starts from the
 *  value and reports every keystroke; the value is the model's from then on. */
function TextRow({ field, id }: { field: Extract<SettingsField, { kind: 'text' }>; id: string }) {
  const text = useNativeState(field.value);
  const modifiers = [
    accessibilityIdentifier(testId(id, 'input')),
    multilineTextAlignment('trailing'),
    autocorrectionDisabled(),
    textInputAutocapitalization('never'),
    ...(field.keyboard === 'url' ? [keyboardType('url')] : field.keyboard === 'numeric' ? [keyboardType('numeric')] : []),
  ];
  return (
    <LabeledContent label={<Labelled label={field.label} description={field.description} />} modifiers={[accessibilityIdentifier(id)]}>
      {field.secure ? (
        <SecureField text={text} placeholder={field.placeholder} onTextChange={field.onChange} modifiers={modifiers} />
      ) : (
        <TextField text={text} placeholder={field.placeholder} onTextChange={field.onChange} modifiers={modifiers} />
      )}
    </LabeledContent>
  );
}

/** Several of a set: the row shows what is chosen and opens the overlay's checklist, as the
 *  app's own row does — a system menu holds one check. */
function MultiRow({ field, id }: { field: Extract<SettingsField, { kind: 'multi' }>; id: string }) {
  const theme = useTheme();
  const { openDialog } = useOverlay();
  const open = () =>
    openDialog(
      () => <MultiSelectPicker label={field.label} value={field.value} options={field.options} onChange={field.onChange} testID={id} />,
      { accessibilityLabel: field.label },
    );
  return (
    <Button onPress={open} modifiers={[accessibilityIdentifier(id)]}>
      <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
        <Labelled label={field.label} description={field.description} color={theme.text} />
        <Spacer />
        <Text modifiers={[foregroundStyle(theme.textSecondary), lineLimit(1)]}>{multiSummary(field.value, field.options)}</Text>
        <Chevron />
      </HStack>
    </Button>
  );
}

/**
 * A link row: a button whose label is the whole row, so the row highlights as the system's do,
 * with what a list of things adds to one — the artwork tile, the swipe actions, and the screen's
 * select mode, where the tap toggles a check circle at the leading edge and a hold range-fills,
 * the swipe and the drag parked meanwhile.
 */
function LinkRow({ field, section, id }: { field: Extract<SettingsField, { kind: 'link' }>; section: SettingsFormSection; id: string }) {
  const theme = useTheme();
  const selection = section.selection;
  const key = fieldKey(field);
  const selectable = !!selection && !!field.key && (!selection.selectable || selection.selectable.has(key));
  const selecting = !!selection?.selecting;
  const selected = selectable && !!selection?.selected.has(key);
  const rangeFill = selection?.rangeFill;
  const content = (
    <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
      {selecting && selectable ? (
        <Image systemName={selected ? 'checkmark.circle.fill' : 'circle'} size={22} color={selected ? theme.accent : theme.textSecondary} />
      ) : null}
      {field.icon ? <Tile icon={field.icon} /> : null}
      <Labelled label={field.label} description={field.description} tone={field.tone} color={theme.text} />
      <Spacer />
      {field.value !== undefined ? <Text modifiers={[foregroundStyle(theme.textSecondary), lineLimit(1)]}>{field.value}</Text> : null}
      {field.progress !== undefined ? (
        <Text modifiers={[foregroundStyle(theme.textSecondary), monospacedDigit()]}>{`${Math.round(field.progress * 100)}%`}</Text>
      ) : null}
      {field.busy ? <ProgressView modifiers={[progressViewStyle('circular')]} /> : null}
      {field.badge !== undefined && field.badge > 0 ? (
        <Pip count={field.badge} />
      ) : field.marked ? (
        <Image systemName="circle.fill" size={8} color={theme.accent} />
      ) : null}
      {selecting ? null : <Chevron />}
    </HStack>
  );
  if (selecting) {
    // Not a button while selecting: a long press on a SwiftUI button swallows its tap, so the row
    // is plain content with the tap and the hold as gestures of its own, and it holds its place in
    // the order. An unselectable row goes inert.
    const gestures = selectable
      ? [onTapGesture(() => selection!.toggle(key)), ...(rangeFill ? [onLongPressGesture(() => rangeFill(key))] : [])]
      : [disabled()];
    return <HStack modifiers={[accessibilityIdentifier(id), moveDisabled(true), ...gestures]}>{content}</HStack>;
  }
  const row = (
    <Button onPress={field.onPress} modifiers={[accessibilityIdentifier(id)]}>
      {content}
    </Button>
  );
  if (!field.actions?.length) return row;
  return (
    <SwipeActions>
      {row}
      <SwipeActions.Actions edge="trailing" allowsFullSwipe={field.actions.length === 1}>
        {field.actions.map((action) => (
          <Button
            key={action.key ?? action.label}
            label={action.label}
            systemImage={action.symbol}
            role={action.destructive ? 'destructive' : undefined}
            onPress={action.onPress}
            modifiers={action.destructive ? undefined : [tint(theme.accent)]}
          />
        ))}
      </SwipeActions.Actions>
    </SwipeActions>
  );
}

/** A React Native block hosted in a row of its own, with no inset of the row's: the block keeps
 *  the inset it draws with elsewhere. For what a screen draws itself, and the app's chips. */
function Hosted({ id, children }: { id: string; children: ReactNode }) {
  return (
    <VStack modifiers={[listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 })]}>
      <RNHostView matchContents={{ vertical: true }}>
        <View testID={id}>{children}</View>
      </RNHostView>
    </VStack>
  );
}

/** A row's label, with its note under it in the footnote size where it has one. */
function Labelled({
  label,
  description,
  tone,
  color,
  selectable,
}: {
  label: string;
  description?: string;
  tone?: SettingsTone;
  /** The label's colour where the row would otherwise tint it (a button's). */
  color?: string;
  selectable?: boolean;
}) {
  const theme = useTheme();
  const title = <Text modifiers={color ? [foregroundStyle(color)] : undefined}>{label}</Text>;
  if (!description) return title;
  const note = [FOOTNOTE, foregroundStyle(toneColor(theme, tone) ?? theme.textSecondary), ...(selectable ? [textSelection(true)] : [])];
  return (
    <VStack alignment="leading" spacing={2}>
      {title}
      <Text modifiers={note}>{description}</Text>
    </VStack>
  );
}

function Chevron() {
  const theme = useTheme();
  return <Image systemName="chevron.right" size={13} modifiers={[foregroundStyle(theme.textSecondary), CHEVRON]} />;
}

/** The leading tile of a list row: the artwork where there is some, else the glyph on a tinted
 *  rounded square, as the system's Settings rows have, the size the app's own tile is. */
function Tile({ icon }: { icon: SettingsIcon }) {
  const theme = useTheme();
  const file = useThumbFile(icon.uri);
  if (file) {
    return <Image uiImage={file} modifiers={[resizable(), frame({ width: 28, height: 28 }), clipShape('roundedRectangle', 7)]} />;
  }
  return (
    <Image
      systemName={icon.symbol}
      size={15}
      color={theme.text}
      modifiers={[frame({ width: 28, height: 28 }), background(theme.tileWash, shapes.roundedRectangle({ cornerRadius: 7 }))]}
    />
  );
}

/** The artwork as a file at the tile's size and corner, decoded once (`menu-thumb-files`): a
 *  SwiftUI image takes a file, not a URL. */
function useThumbFile(uri: string | undefined): string | undefined {
  const wanted = useMemo(() => (uri ? { icon: uri } : undefined), [uri]);
  return useMenuThumbFiles(wanted, undefined, MENU_THUMB_RADIUS).icon;
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

/** A note's colour for its tone; none without one. */
function toneColor(theme: ReturnType<typeof useTheme>, tone: SettingsTone | undefined): string | undefined {
  switch (tone) {
    case 'info':
      return theme.badgeInfo;
    case 'warn':
      return theme.badgeWarn;
    case 'danger':
      return theme.danger;
    default:
      return undefined;
  }
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  chips: {
    paddingVertical: Spacing.three,
    paddingHorizontal: SettingsCardInset,
  },
});
