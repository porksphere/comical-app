import { useRef, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';

import { ChipRow } from '@/components/chip';
import { Holdable } from '@/components/context-menu';
import { CumulativeDownloadRadial } from '@/components/downloads/cumulative-radial';
import { SelectLead, SelectLeadGap } from '@/components/multi-select/select-mode';
import { IntStepper } from '@/components/reader/int-stepper';
import { ScreenScrollView } from '@/components/screen-scroll-marker';
import { MultiSelectRow } from '@/components/settings/multi-select-row';
import { RefreshableScrollView } from '@/components/settings/refreshable-scroll';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { RowIcon } from '@/components/settings/row-icon';
import { SettingsSelectRow, SettingsTextRow, SettingsToggleRow } from '@/components/settings/settings-fields';
import {
  fieldKey,
  fieldTestID,
  type SettingsField,
  type SettingsFormSection,
  type SettingsListProps,
  type SettingsTone,
} from '@/components/settings/settings-form';
import { settingsRowFrame, SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { UpdateDot, UpdatePip } from '@/components/tab-badge';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, SettingsCardInset, Spacing } from '@/constants/theme';
import { BAR_SCROLLED_AT } from '@/hooks/use-bar-scrolled';
import { useReselectScrollToTop } from '@/hooks/use-scroll-to-top-on-reselect';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';
import { scrollbarInset } from '@/lib/scrollbar-inset';

/**
 * A settings screen's sections (`settings-form.ts`) drawn as the app's own cards and rows — the
 * `SettingsSection`/`SettingsRow` family — in the screen's scroll view, padded past its top bar.
 * Android, web and the desktop settings panes; iOS draws the same sections as a SwiftUI form
 * (`settings-list.ios.tsx`). The screen keeps its `TopBar` and its frame; this is the list.
 *
 * A screen that is one section of draggable rows (Bridges, Registries) is the reorderable list,
 * which owns its scroll, its pull and its card; any other screen scrolls its sections, with the
 * shared pull where it refreshes.
 */
export function SettingsList({ sections, column = MaxContentWidth, reselectRoute, refresh, onScrolledPast }: SettingsListProps) {
  const padding = useSettingsScrollPadding(column);
  const ref = useRef<ScrollViewInstance>(null);
  const past = useRef(false);
  const reportScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > BAR_SCROLLED_AT;
    if (next === past.current) return;
    past.current = next;
    onScrolledPast?.(next);
  };
  useReselectScrollToTop(reselectRoute, () => ref.current?.scrollTo({ y: 0, animated: true }));
  const [only] = sections;
  if (sections.length === 1 && only?.onReorder) {
    return (
      <ReorderableList
        data={[...only.fields]}
        keyOf={fieldKey}
        renderRow={(field) => <Field field={field} section={only} />}
        onReorder={only.onReorder}
        dragEnabled={!only.selection?.selecting}
        refresh={refresh}
      />
    );
  }
  const content = sections.map((section, i) => (
    <SettingsSection key={section.title ?? i} title={section.title} footer={section.footer}>
      {section.fields.map((field) => (
        <Field key={fieldTestID(field)} field={field} section={section} />
      ))}
    </SettingsSection>
  ));
  if (refresh) {
    return (
      <RefreshableScrollView
        refresh={refresh}
        style={scrollbarInset(padding.paddingTop)}
        contentContainerStyle={padding}
        contentStyle={[styles.content, { maxWidth: column }]}>
        {content}
      </RefreshableScrollView>
    );
  }
  return (
    <ScreenScrollView
      ref={ref}
      onScroll={onScrolledPast ? reportScroll : undefined}
      scrollEventThrottle={16}
      style={scrollbarInset(padding.paddingTop)}
      contentContainerStyle={[
        styles.content,
        { maxWidth: column },
        padding,
        // A tab root fills the viewport even when the list is short, so the space below it is
        // still draggable (see SeriesGrid's note).
        reselectRoute ? styles.fill : null,
      ]}>
      {content}
    </ScreenScrollView>
  );
}

function Field({ field, section }: { field: SettingsField; section: SettingsFormSection }) {
  const theme = useTheme();
  const id = fieldTestID(field);
  switch (field.kind) {
    case 'toggle':
      return (
        <SettingsToggleRow
          testID={id}
          label={field.label}
          description={field.description}
          value={field.value}
          onChange={field.onChange}
          disabled={field.disabled}
        />
      );
    case 'select':
      return (
        <SettingsSelectRow
          testID={id}
          label={field.label}
          description={field.description}
          value={field.value}
          options={field.options}
          onChange={field.onChange}
          placeholder={field.placeholder}
        />
      );
    case 'multi':
      return (
        <MultiSelectRow
          testID={id}
          label={field.label}
          description={field.description}
          value={field.value}
          options={field.options}
          onChange={field.onChange}
        />
      );
    case 'text':
      return (
        <SettingsTextRow
          testID={id}
          label={field.label}
          description={field.description}
          value={field.value}
          placeholder={field.placeholder}
          onChange={field.onChange}
          keyboardType={field.keyboard === 'numeric' ? 'numeric' : field.keyboard === 'url' ? 'url' : undefined}
          secureTextEntry={field.secure}
          autoCapitalize="none"
          autoCorrect={false}
        />
      );
    case 'stepper':
      return (
        <View testID={id} style={settingsRowFrame.row}>
          <View style={settingsRowFrame.text}>
            <ThemedText type="small" numberOfLines={1}>
              {field.label}
            </ThemedText>
            {field.description && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {field.description}
              </ThemedText>
            )}
          </View>
          <IntStepper value={field.value} min={field.min} max={field.max} onChange={field.onChange} testIdPrefix={id} />
        </View>
      );
    case 'link':
      return <LinkRow field={field} section={section} id={id} />;
    case 'action': {
      const tint = field.role === 'destructive' ? theme.danger : theme.accent;
      return (
        <SettingsRow
          testID={id}
          label={field.label}
          labelColor={field.verb === undefined ? tint : undefined}
          description={field.description}
          descriptionColor={toneColor(theme, field.tone)}
          leading={field.marked ? <UpdateDot /> : undefined}
          right={
            field.busy ? (
              <ActivityIndicator size="small" />
            ) : field.verb !== undefined ? (
              <ThemedText type="smallBold" style={{ color: tint }}>
                {field.verb}
              </ThemedText>
            ) : field.detail !== undefined ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.value}>
                {field.detail}
              </ThemedText>
            ) : undefined
          }
          chevron={false}
          disabled={field.disabled}
          onPress={field.onPress}
        />
      );
    }
    case 'value':
      return (
        <SettingsRow
          testID={id}
          label={field.label}
          description={field.description}
          descriptionColor={toneColor(theme, field.tone)}
          descriptionSelectable={field.selectable}
          right={
            field.value !== undefined ? (
              // Clamped to one line so no row outgrows `SettingsRowHeight`: it shrinks against the
              // label rather than pushing it off.
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} selectable={field.selectable} style={styles.value}>
                {field.value}
              </ThemedText>
            ) : undefined
          }
        />
      );
    case 'note':
      return (
        <View testID={id} style={styles.note}>
          <View style={styles.noteHead}>
            <ThemedText type="smallBold">{field.title}</ThemedText>
            {field.caption ? (
              <ThemedText type="small" themeColor="textSecondary">
                {field.caption}
              </ThemedText>
            ) : null}
          </View>
          {field.text ? (
            <ThemedText type="small" selectable={field.selectable}>
              {field.text}
            </ThemedText>
          ) : null}
          {field.lines?.map((line, i) => (
            <View key={`${i}-${line}`} style={styles.line}>
              <ThemedText type="small" style={[styles.bullet, { color: theme.textSecondary }]}>
                •
              </ThemedText>
              <ThemedText type="small" style={styles.lineText} selectable={field.selectable}>
                {line}
              </ThemedText>
            </View>
          ))}
        </View>
      );
    case 'chips':
      return (
        <View testID={id} style={styles.chips}>
          <ChipRow labels={[...field.items]} accent />
        </View>
      );
    case 'custom':
      return <>{field.render()}</>;
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}

/**
 * A link row, with what a list of things adds to one: the artwork tile with its dot or pip, the
 * swipe actions, and the screen's select mode — a check circle sliding in at the leading edge,
 * the tap toggling the row and a hold range-filling, the swipe parked meanwhile. A row without a
 * key in a selecting section keeps its column and goes inert.
 */
function LinkRow({ field, section, id }: { field: Extract<SettingsField, { kind: 'link' }>; section: SettingsFormSection; id: string }) {
  const theme = useTheme();
  const selection = section.selection;
  const key = fieldKey(field);
  const selectable = !!selection && !!field.key && (!selection.selectable || selection.selectable.has(key));
  const selecting = !!selection?.selecting;
  const pip = field.badge !== undefined && field.badge > 0 ? <UpdatePip count={field.badge} /> : field.marked ? <UpdateDot /> : null;
  // The pip sits on the icon's tile where there is one, the way the tab pip sits on the tab
  // icon; otherwise it trails with the value.
  const icon = field.icon ? (
    <View>
      <RowIcon uri={field.icon.uri} fallback={field.icon.glyph} />
      {pip && (
        <View style={field.marked && field.badge === undefined ? styles.tileDot : styles.tilePip} pointerEvents="none">
          {pip}
        </View>
      )}
    </View>
  ) : null;
  const leading = selection ? (
    <>
      {selectable ? (
        <SelectLead progress={selection.progress} selected={selection.selected.has(key)} itemKey={key} edgeOffset={SettingsCardInset} />
      ) : (
        <SelectLeadGap progress={selection.progress} />
      )}
      {icon}
    </>
  ) : icon;
  const trailing: ReactNode[] = [];
  if (field.value !== undefined) {
    trailing.push(
      <ThemedText key="value" type="small" themeColor="textSecondary" numberOfLines={1} style={styles.value}>
        {field.value}
      </ThemedText>,
    );
  }
  if (field.progress !== undefined) trailing.push(<CumulativeDownloadRadial key="progress" fraction={field.progress} size={20} strokeWidth={2.5} />);
  if (field.busy) trailing.push(<ActivityIndicator key="busy" size="small" />);
  if (!field.icon && pip) trailing.push(<View key="pip">{pip}</View>);
  const common = {
    testID: id,
    label: field.label,
    description: field.description,
    descriptionColor: toneColor(theme, field.tone),
    leading: leading ?? undefined,
    right: trailing.length > 0 ? <View style={styles.trailing}>{trailing}</View> : undefined,
    onPress: selecting ? (selectable ? () => selection!.toggle(key) : undefined) : field.onPress,
  };
  if (!field.actions?.length) return <SettingsRow {...common} chevron={!selecting} />;
  const actions = field.actions.map((a) => ({ key: a.key, label: a.label, icon: a.glyph, destructive: a.destructive, onPress: a.onPress }));
  const row = (onLongPress?: Parameters<typeof SwipeableSettingsRow>[0]['onLongPress']) => (
    <SwipeableSettingsRow {...common} onLongPress={onLongPress} swipeEnabled={!selecting} actions={actions} />
  );
  if (!selectable || !selection?.rangeFill) return row();
  const rangeFill = selection.rangeFill;
  return (
    <Holdable
      enabled={selecting}
      onHold={() => {
        hapticSelection();
        rangeFill(key);
      }}>
      {({ onLongPress }) => row(selecting ? onLongPress : undefined)}
    </Holdable>
  );
}

/** A note's colour for its tone; the muted colour without one. */
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
  content: {
    // Spacing BETWEEN sections (SettingsSection carries no top margin — see settings-row).
    gap: Spacing.five,
    width: '100%',
    alignSelf: 'center',
  },
  fill: {
    flexGrow: 1,
  },
  tilePip: {
    position: 'absolute',
    top: -6,
    right: -6,
  },
  // Hugs the top-right corner of the tile so the dot overlaps the artwork.
  tileDot: {
    position: 'absolute',
    top: -3,
    right: -3,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
    minWidth: 0,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
  chips: {
    paddingVertical: Spacing.three,
    paddingHorizontal: SettingsCardInset,
  },
  note: {
    paddingVertical: Spacing.three,
    paddingHorizontal: SettingsCardInset,
    gap: Spacing.two,
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  line: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  bullet: {
    lineHeight: 20,
  },
  lineText: {
    flex: 1,
    lineHeight: 20,
  },
});
