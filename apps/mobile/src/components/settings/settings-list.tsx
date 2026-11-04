import { useRef } from 'react';
import { StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { CumulativeDownloadRadial } from '@/components/downloads/cumulative-radial';
import { ScreenScrollView } from '@/components/screen-scroll-marker';
import { SettingsSelectRow, SettingsToggleRow } from '@/components/settings/settings-fields';
import { fieldTestID, type SettingsField, type SettingsListProps } from '@/components/settings/settings-form';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { UpdateDot, UpdatePip } from '@/components/tab-badge';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, SettingsCardInset, Spacing } from '@/constants/theme';
import { useReselectScrollToTop } from '@/hooks/use-scroll-to-top-on-reselect';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { scrollbarInset } from '@/lib/scrollbar-inset';

/**
 * A settings screen's sections (`settings-form.ts`) drawn as the app's own cards and rows — the
 * `SettingsSection`/`SettingsRow` family — in the screen's scroll view, padded past its top bar.
 * Android, web and the desktop settings panes; iOS draws the same sections as a SwiftUI form
 * (`settings-list.ios.tsx`). The screen keeps its `TopBar` and its frame; this is the list.
 */
export function SettingsList({ sections, column = MaxContentWidth, reselectRoute }: SettingsListProps) {
  const padding = useSettingsScrollPadding(column);
  const ref = useRef<ScrollViewInstance>(null);
  useReselectScrollToTop(reselectRoute, () => ref.current?.scrollTo({ y: 0, animated: true }));
  return (
    <ScreenScrollView
      ref={ref}
      style={scrollbarInset(padding.paddingTop)}
      contentContainerStyle={[
        styles.content,
        { maxWidth: column },
        padding,
        // A tab root fills the viewport even when the list is short, so the space below it is
        // still draggable (see SeriesGrid's note).
        reselectRoute ? styles.fill : null,
      ]}>
      {sections.map((section, i) => (
        <SettingsSection key={section.title ?? i} title={section.title} footer={section.footer}>
          {section.fields.map((field) => (
            <Field key={fieldTestID(field)} field={field} />
          ))}
        </SettingsSection>
      ))}
    </ScreenScrollView>
  );
}

function Field({ field }: { field: SettingsField }) {
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
    case 'link': {
      // The pip sits on the icon's tile where there is one, the way the tab pip sits on the tab
      // icon; otherwise it trails with the value.
      const pip = field.badge !== undefined && field.badge > 0 ? <UpdatePip count={field.badge} /> : null;
      const trailing = field.value !== undefined || field.progress !== undefined || (pip && !field.icon);
      return (
        <SettingsRow
          testID={id}
          label={field.label}
          description={field.description}
          leading={
            field.icon ? (
              <View style={[styles.tile, { backgroundColor: theme.tileWash }]}>
                {field.icon.glyph(theme.text, 18)}
                {pip && (
                  <View style={styles.tilePip} pointerEvents="none">
                    {pip}
                  </View>
                )}
              </View>
            ) : undefined
          }
          right={
            trailing ? (
              <View style={styles.trailing}>
                {field.value !== undefined && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.value}>
                    {field.value}
                  </ThemedText>
                )}
                {field.progress !== undefined && <CumulativeDownloadRadial fraction={field.progress} size={20} strokeWidth={2.5} />}
                {!field.icon && pip}
              </View>
            ) : undefined
          }
          chevron
          onPress={field.onPress}
        />
      );
    }
    case 'action':
      return (
        <SettingsRow
          testID={id}
          label={field.label}
          labelColor={field.role === 'destructive' ? theme.danger : theme.accent}
          description={field.description}
          leading={field.marked ? <UpdateDot /> : undefined}
          right={
            field.detail !== undefined ? (
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
    case 'value':
      return (
        <SettingsRow
          testID={id}
          label={field.label}
          description={field.description}
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
    case 'custom':
      return <>{field.render()}</>;
    default: {
      const unhandled: never = field;
      return unhandled;
    }
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
  // The glyph's tile: the same shape a bridge's icon takes in `RowIcon`, so the hub's rows and the
  // list rows behind them share a leading column.
  tile: {
    width: 28,
    height: 28,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tilePip: {
    position: 'absolute',
    top: -6,
    right: -6,
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
