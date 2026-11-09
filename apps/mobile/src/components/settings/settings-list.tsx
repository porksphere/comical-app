import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { use, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View, type ScrollViewInstance, type ViewInstance } from 'react-native';
import type { LegacyPanGesture as PanGesture } from 'react-native-gesture-handler';

import { ChipRow } from '@/components/chip';
import { Holdable } from '@/components/context-menu';
import { CumulativeDownloadRadial } from '@/components/downloads/cumulative-radial';
import { SelectLead, SelectLeadGap, useDragSelect } from '@/components/multi-select/select-mode';
import { IntStepper } from '@/components/reader/int-stepper';
import { ScreenScrollMarker, ScreenScrollView } from '@/components/screen-scroll-marker';
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
import { SwipeableSettingsRow, swipeActionsOf } from '@/components/settings/swipeable-row';
import { FOCUS_WASH, FocusRowContext, useFocusRow } from '@/components/settings/use-focus-row';
import { UpdateDot, UpdatePip } from '@/components/tab-badge';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, SettingsCardInset, SettingsRowHeight, Spacing } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';
import { useListLayout } from '@/hooks/use-list-layout';
import { useReselectScrollToTop } from '@/hooks/use-scroll-to-top-on-reselect';
import { useSettingsListPad, useSettingsScrollPadding, useSettingsSidePad } from '@/hooks/use-settings-scroll-padding';
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
 * which owns its scroll, its pull and its card; a screen with an `unbounded` section is a recycled
 * list (`RecycledSections`); any other screen scrolls its sections, with the shared pull where it
 * refreshes.
 */
export function SettingsList(props: SettingsListProps) {
  const unbounded = props.sections.findIndex((s) => s.unbounded && s.fields.length > 0);
  return unbounded >= 0 ? <RecycledSections {...props} at={unbounded} /> : <ScrolledSections {...props} />;
}

function ScrolledSections(props: SettingsListProps) {
  const { sections, focus } = props;
  const ref = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const focusRef = useRef<ViewInstance>(null);
  // Centred in the scroller, from where both stand on screen: the one measurement that holds
  // whatever the content around the row is. Only the plain scroller is followed for its offset;
  // the draggable and refreshable lists leave the row where it is.
  const marked = useFocusRow(focus, sections, () => {
    const list = ref.current;
    const row = focusRef.current;
    if (!list || !row) return;
    list.measureInWindow((_lx, ly, _lw, lh) =>
      row.measureInWindow((_rx, ry, _rw, rh) => {
        list.scrollTo({ y: Math.max(0, offset.current + ry - ly - (lh - rh) / 2), animated: true });
      }),
    );
  });
  return (
    <FocusRowContext value={{ focus, marked, hold: (view) => (focusRef.current = view) }}>
      <Sections {...props} scrollRef={ref} onOffset={(y) => (offset.current = y)} />
    </FocusRowContext>
  );
}

function Sections({
  sections,
  column = MaxContentWidth,
  reselectRoute,
  refresh,
  scrollRef: ref,
  onOffset,
}: SettingsListProps & { scrollRef: RefObject<ScrollViewInstance | null>; onOffset: (y: number) => void }) {
  const padding = useSettingsScrollPadding(column);
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
      onScroll={(e) => onOffset(e.nativeEvent.contentOffset.y)}
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

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * A screen whose `at` section runs to hundreds of rows: that section is the screen's scroller, a
 * recycled list of fixed-height rows, with the sections before it above the rows and the ones after
 * below. A recycled row is a view handed from one item to the next, never a member of a group, so
 * the rows are laid out plain, at the cards' text inset, and the sections around them pad back out
 * to the cards' edge (`useSettingsListPad`). A drag down the check circles sweeps them where the
 * selection can be replaced wholesale (`selectSet`). No pull to refresh here.
 */
function RecycledSections({ sections, at, focus }: SettingsListProps & { at: number }) {
  const theme = useTheme();
  const section = sections[at];
  const width = useContentWidth();
  const { paddingTop, paddingBottom } = useSettingsScrollPadding();
  const sidePad = useSettingsSidePad(width);
  const listPad = useSettingsListPad(width);
  const listRef = useRef<LegendListRef>(null);
  const scrollY = useRef(0);
  const focusRef = useRef<ViewInstance>(null);
  const keys = useMemo(() => section.fields.map(fieldKey), [section.fields]);
  const selection = section.selection;
  const sweep = useDragSelect({
    keys,
    selected: selection?.selected ?? NO_KEYS,
    selectSet: (set) => {
      const allowed = selection?.selectable;
      selection?.selectSet?.(allowed ? new Set([...set].filter((k) => allowed.has(k))) : set);
    },
    rowHeight: SettingsRowHeight,
    scrollRef: listRef,
    scrollYRef: scrollY,
    selecting: !!selection?.selecting && !!selection.selectSet,
  });
  const marked = useFocusRow(focus, sections, (key) => {
    const index = keys.indexOf(key);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  });
  const extra = useListLayout(
    listRef,
    sidePad.left,
    useMemo(() => ({ selected: selection?.selected, selecting: selection?.selecting, marked }), [selection?.selected, selection?.selecting, marked]),
  );
  const around = (from: number, to: number) => {
    const group = sections.slice(from, to).filter((s) => s.fields.length > 0);
    if (group.length === 0) return null;
    return (
      <View style={styles.around}>
        {group.map((s, i) => (
          <SettingsSection key={s.title ?? i} title={s.title} footer={s.footer}>
            {s.fields.map((field) => (
              <Field key={fieldTestID(field)} field={field} section={s} />
            ))}
          </SettingsSection>
        ))}
      </View>
    );
  };
  const before = around(0, at);
  const after = around(at + 1, sections.length);
  return (
    <FocusRowContext value={{ focus, marked, hold: (view) => (focusRef.current = view) }}>
      <ScreenScrollMarker>
        <LegendList
          ref={listRef}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          style={[styles.recycled, scrollbarInset(paddingTop)]}
          data={section.fields as SettingsField[]}
          keyExtractor={fieldKey}
          recycleItems
          estimatedItemSize={SettingsRowHeight}
          // Every row is one settings row tall, so the list need not measure each one, nor correct
          // the scroll from measurements as it goes (a flinging jitter).
          getFixedItemSize={() => SettingsRowHeight}
          maintainVisibleContentPosition={{ data: false, size: false }}
          extraData={extra}
          renderItem={({ item, index }) => (
            <View>
              <Field field={item} section={section} sweep={sweep.gestureFor(index)} />
              {index < keys.length - 1 && <View pointerEvents="none" style={[styles.recycledDivider, { backgroundColor: theme.hairline }]} />}
            </View>
          )}
          ListHeaderComponent={
            before || section.title ? (
              <>
                {before}
                {section.title ? (
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.recycledTitle}>
                    {section.title}
                  </ThemedText>
                ) : null}
              </>
            ) : undefined
          }
          ListFooterComponent={
            section.footer || after ? (
              <>
                {section.footer ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.recycledFooter}>
                    {section.footer}
                  </ThemedText>
                ) : null}
                {after}
              </>
            ) : undefined
          }
          contentContainerStyle={{ flexGrow: 1, paddingTop, paddingBottom, paddingLeft: listPad.left, paddingRight: listPad.right }}
          showsVerticalScrollIndicator={Platform.OS === 'web'}
        />
      </ScreenScrollMarker>
    </FocusRowContext>
  );
}

function Field({ field, section, sweep }: { field: SettingsField; section: SettingsFormSection; sweep?: PanGesture }) {
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
      return <LinkRow field={field} section={section} id={id} sweep={sweep} />;
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
type LinkRowProps = { field: Extract<SettingsField, { kind: 'link' }>; section: SettingsFormSection; id: string; sweep?: PanGesture };

function LinkRow(props: LinkRowProps) {
  const { field } = props;
  const theme = useTheme();
  const { focus, marked, hold } = use(FocusRowContext);
  const row = <LinkRowBody {...props} />;
  if (focus !== fieldKey(field)) return row;
  // The mark lies OVER the row: a swipeable row fills its own opaque background.
  return (
    <View ref={hold} collapsable={false}>
      {row}
      {marked && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.accent, opacity: FOCUS_WASH }]} />}
    </View>
  );
}

function LinkRowBody({ field, section, id, sweep }: LinkRowProps) {
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
      <RowIcon uri={field.icon.uri} fallback={field.icon.glyph} bare={field.icon.bare} />
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
        <SelectLead progress={selection.progress} selected={selection.selected.has(key)} itemKey={key} edgeOffset={SettingsCardInset} gesture={sweep} />
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
  if (!field.actions?.length) return <SettingsRow {...common} chevron={!selecting && !!field.onPress} />;
  const actions = swipeActionsOf(field.actions);
  const row = (onLongPress?: Parameters<typeof SwipeableSettingsRow>[0]['onLongPress']) => (
    <SwipeableSettingsRow {...common} recycleKey={key} onLongPress={onLongPress} swipeEnabled={!selecting} actions={actions} />
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
  recycled: {
    flex: 1,
  },
  // The cards around a recycled list pad back out to where a card's edge is (see `useSettingsListPad`).
  around: {
    gap: Spacing.five,
    paddingHorizontal: SettingsCardInset,
    paddingBottom: Spacing.five,
  },
  recycledTitle: {
    paddingHorizontal: SettingsCardInset,
    paddingBottom: Spacing.two,
    textTransform: 'uppercase',
  },
  recycledFooter: {
    paddingHorizontal: SettingsCardInset,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
  // The cards' inset divider, absolute so a row stays exactly one settings row tall.
  recycledDivider: {
    position: 'absolute',
    bottom: 0,
    left: SettingsCardInset,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
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
