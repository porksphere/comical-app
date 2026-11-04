import type { Image } from '@expo/ui/swift-ui';
import type { ComponentProps, ReactNode } from 'react';

import type { SettingsOption } from '@/components/settings/select-row-shared';
import { testId } from '@/lib/test-id';

export type { SettingsOption };

/**
 * A settings screen as data: its sections in order, each a run of fields, and each field its
 * value, what a change sets or a tap does, and whether it applies right now. The ONE place a
 * screen's rows are listed. Two renderers draw it — the app's own cards and rows
 * (`settings-list.tsx`, Android and web, the desktop settings panes included) and a SwiftUI form
 * (`settings-list.ios.tsx`) — each with a switch over `kind` that the typecheck requires to be
 * complete, so a new kind of field fails until both can draw it, and a new field of a kind they
 * know appears on every platform at once. Nothing here is a view: no component, no style, no
 * platform's control. What a screen holds that is not a row goes in a `custom` field, which the
 * iOS form hosts in a row of its own, so a screen never falls back whole.
 *
 * Test ids: `fieldTestID` gives each field the id its row had — `settings.toggle.<label>`,
 * `settings.select.<label>`, `settings.row.<label>` — unless the field names its own.
 */
export type SettingsField =
  | {
      kind: 'toggle';
      label: string;
      description?: string;
      value: boolean;
      onChange: (value: boolean) => void;
      /** Greyed out, never hidden: a setting that doesn't apply right now still says it exists. */
      disabled?: boolean;
      testID?: string;
    }
  | {
      kind: 'select';
      label: string;
      description?: string;
      value: string;
      options: readonly SettingsOption<string>[];
      onChange: (value: string) => void;
      /** Shown when `value` matches no option (nothing chosen yet). */
      placeholder?: string;
      testID?: string;
    }
  | {
      /** A row that opens something: a pushed screen, a dialog. Ends in a chevron. */
      kind: 'link';
      label: string;
      description?: string;
      /** The current state, read-only, before the chevron: a count, a version, a URL. */
      value?: string;
      icon?: SettingsIcon;
      /** Updates waiting behind this row (registry updates, an app update): a counted pip. */
      badge?: number;
      /** Work in flight behind this row, 0–1 (downloads). */
      progress?: number;
      onPress: () => void;
      testID?: string;
    }
  | {
      /** A row that does something here: export, clear, check. No chevron; the label is the verb. */
      kind: 'action';
      label: string;
      description?: string;
      /** The outcome or state, trailing: `Copied`, `Exporting…`. */
      detail?: string;
      role?: 'destructive';
      /** Something waits on this action (an update is ready): a dot before the label. */
      marked?: boolean;
      disabled?: boolean;
      onPress: () => void;
      testID?: string;
    }
  | {
      /** A fact: label and value, nothing to do. */
      kind: 'value';
      label: string;
      /** State under the label, where the fact is a line rather than a value: a count of things. */
      description?: string;
      value?: string;
      /** The value can be selected and copied (a commit, a URL). */
      selectable?: boolean;
      testID?: string;
    }
  | {
      /** A block of text in the card: a release's notes, a logged failure. */
      kind: 'note';
      title: string;
      /** Trailing the title: a date, a time. */
      caption?: string;
      /** Paragraphs under the title. */
      text?: string;
      /** Points under the title, bulleted. */
      lines?: readonly string[];
      selectable?: boolean;
      testID?: string;
    }
  | {
      /** Anything else, drawn by the screen. The id keys it; nothing is derived from it. */
      kind: 'custom';
      testID: string;
      render: () => ReactNode;
    };

/**
 * A row's leading picture, in both languages: the SF Symbol the iOS form draws, and the glyph the
 * app's own rows draw (a lucide icon, as a function of colour and size).
 */
export type SettingsIcon = {
  symbol: NonNullable<ComponentProps<typeof Image>['systemName']>;
  glyph: (color: string, size: number) => ReactNode;
};

export type SettingsFormSection = {
  /** The uppercase caption over the card. A screen whose whole content is one list has none. */
  title?: string;
  /** The group's explanation, under the card, so its rows stay one line each. */
  footer?: string;
  /** Empty, the section is not drawn: a screen leaves a section out by emptying it. */
  fields: readonly SettingsField[];
};

/** What a screen hands its list (`settings-list.tsx`, `settings-list.ios.tsx`). */
export type SettingsListProps = {
  sections: readonly SettingsFormSection[];
  /** The reading column's cap. Defaults to `MaxContentWidth`; the landing tab is wider. */
  column?: number;
  /** A tab root: the tab whose reselect scrolls this to the top, and whose bar the list names. */
  reselectRoute?: string;
};

/** The id a field's row carries, for tests and as its React key. */
export function fieldTestID(field: SettingsField): string {
  switch (field.kind) {
    case 'toggle':
      return field.testID ?? testId('settings.toggle', field.label);
    case 'select':
      return field.testID ?? testId('settings.select', field.label);
    case 'link':
    case 'action':
    case 'value':
      return field.testID ?? testId('settings.row', field.label);
    case 'note':
      return field.testID ?? testId('settings.note', field.title);
    case 'custom':
      return field.testID;
  }
}

/** A section's fields, the conditional ones written as `condition && field`. */
export function fields(...items: (SettingsField | false | null | undefined)[]): SettingsField[] {
  return items.filter((item): item is SettingsField => !!item);
}

/** A choice over a closed set of values, typed at the field and widened for the renderers. */
export function select<T extends string>(field: {
  label: string;
  description?: string;
  value: T;
  options: readonly SettingsOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  testID?: string;
}): SettingsField {
  return { kind: 'select', ...field, onChange: (v) => field.onChange(v as T) };
}
