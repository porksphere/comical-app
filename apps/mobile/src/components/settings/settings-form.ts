import type { Image } from '@expo/ui/swift-ui';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { SharedValue } from 'react-native-reanimated';

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
 * Colour: exactly one thing on a row is ever tinted, and it is the thing that acts — an action's
 * verb where it has one, else its label; red where it destroys. Everything else is the label
 * colour, with notes in the muted one; a note that needs attention says so through `tone`.
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
      /** Several of a closed set: a summary on the row, a checklist to open. */
      kind: 'multi';
      label: string;
      description?: string;
      value: readonly string[];
      options: readonly SettingsOption<string>[];
      onChange: (value: string[]) => void;
      testID?: string;
    }
  | {
      /** A line of text typed on the row, applied as it is typed. */
      kind: 'text';
      label: string;
      description?: string;
      value: string;
      /** Muted, in the empty field: a default or inherited value the blank falls back to. */
      placeholder?: string;
      /** A secret: masked, with a reveal where the platform has one. */
      secure?: boolean;
      keyboard?: 'default' | 'url' | 'numeric';
      onChange: (value: string) => void;
      testID?: string;
    }
  | {
      /** A whole number within bounds. */
      kind: 'stepper';
      label: string;
      description?: string;
      value: number;
      min: number;
      max: number;
      onChange: (value: number) => void;
      testID?: string;
    }
  | {
      /** A row that opens something: a pushed screen, a dialog. Ends in a chevron. */
      kind: 'link';
      /** The row's identity among its section's rows, for reordering and selecting. Defaults to
       *  the test id; a list of things gives each its own id. */
      key?: string;
      label: string;
      description?: string;
      tone?: SettingsTone;
      /** The current state, read-only, before the chevron: a count, a version, a URL. */
      value?: string;
      icon?: SettingsIcon;
      /** Updates waiting behind this row (registry updates, an app update): a counted pip. */
      badge?: number;
      /** Something waits behind this one row (an update for it): a dot. */
      marked?: boolean;
      /** Work in flight behind this row, 0–1 (downloads). */
      progress?: number;
      /** Work in flight on this row: a spinner. */
      busy?: boolean;
      /** What a swipe (a hover, on web) reveals: at most three, the last at the edge. */
      actions?: readonly SettingsRowAction[];
      onPress: () => void;
      testID?: string;
    }
  | {
      /** A row that does something here: export, clear, check. No chevron; the verb is tinted. */
      kind: 'action';
      label: string;
      description?: string;
      tone?: SettingsTone;
      /** The verb, trailing, when the label names the thing rather than the deed ("Connect"
       *  on an account row). The tint goes on it instead of the label. */
      verb?: string;
      /** The outcome or state, trailing, muted: `Copied`, `Exporting…`. */
      detail?: string;
      role?: 'destructive';
      /** Something waits on this action (an update is ready): a dot before the label. */
      marked?: boolean;
      /** Work in flight on this row: a spinner in the verb's place. */
      busy?: boolean;
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
      tone?: SettingsTone;
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
      /** A run of short labels as chips: a bridge's capabilities. The id keys it. */
      kind: 'chips';
      testID: string;
      items: readonly string[];
    }
  | {
      /** Anything else, drawn by the screen. The id keys it; nothing is derived from it. */
      kind: 'custom';
      testID: string;
      render: () => ReactNode;
    };

/** How a note reads: informational, something to attend to, or wrong. */
export type SettingsTone = 'info' | 'warn' | 'danger';

export type SFSymbol = NonNullable<ComponentProps<typeof Image>['systemName']>;

/**
 * A row's leading picture, in both languages: the SF Symbol the iOS form draws, and the glyph the
 * app's own rows draw (a lucide icon, as a function of colour and size). With `uri` the picture is
 * that artwork (a bridge's icon), and the glyph stands in while it loads or where there is none.
 */
export type SettingsIcon = {
  symbol: SFSymbol;
  glyph: (color: string, size: number) => ReactNode;
  uri?: string;
};

/** One thing a swipe on a row reveals. The last is at the edge: the natural destructive slot. */
export type SettingsRowAction = {
  /** Stable key; defaults to `label`. */
  key?: string;
  label: string;
  symbol: SFSymbol;
  glyph: ComponentType<{ color: string; size?: number }>;
  /** Red (a delete, an uninstall); the rest take the accent. */
  destructive?: boolean;
  onPress: () => void;
};

/**
 * A screen's select mode over a section's rows (`use-select-mode`, `use-multi-select`): which are
 * chosen, and the row's tap toggling it. `progress` is the mode's arrival, 0–1, for the rows'
 * animated leading slot on the app's own renderer.
 */
export type SettingsSelection = {
  selecting: boolean;
  progress: SharedValue<number>;
  selected: ReadonlySet<string>;
  /** The rows that can be selected; every keyed row when absent. The rest keep their column. */
  selectable?: ReadonlySet<string>;
  toggle: (key: string) => void;
  /** A hold on a row: select from the last toggled row to this one. */
  rangeFill?: (key: string) => void;
};

export type SettingsFormSection = {
  /** The uppercase caption over the card. A screen whose whole content is one list has none. */
  title?: string;
  /** The group's explanation, under the card, so its rows stay one line each. */
  footer?: string;
  /** No card: the rows sit on the page (iOS; the app's own renderer draws every section as a card). */
  plain?: boolean;
  /** Empty, the section is not drawn: a screen leaves a section out by emptying it. */
  fields: readonly SettingsField[];
  /** The rows are an ordered set the user drags into order: called with every row's key in the
   *  new order. A screen that is one such section is drawn as the draggable list. */
  onReorder?: (keys: string[]) => void;
  /** The screen's select mode over the rows with a `key`; the rest go inert while it is on. */
  selection?: SettingsSelection;
};

/** What a screen hands its list (`settings-list.tsx`, `settings-list.ios.tsx`). */
export type SettingsListProps = {
  sections: readonly SettingsFormSection[];
  /** The reading column's cap. Defaults to `MaxContentWidth`; the landing tab is wider. */
  column?: number;
  /** A tab root: the tab whose reselect scrolls this to the top, and whose bar the list names. */
  reselectRoute?: string;
  /** Pull to refresh. */
  refresh?: () => Promise<unknown>;
};

/** The id a field's row carries, for tests and as its React key. */
export function fieldTestID(field: SettingsField): string {
  switch (field.kind) {
    case 'toggle':
      return field.testID ?? testId('settings.toggle', field.label);
    case 'select':
      return field.testID ?? testId('settings.select', field.label);
    case 'multi':
      return field.testID ?? testId('settings.multi', field.label);
    case 'text':
      return field.testID ?? testId('settings.text', field.label);
    case 'stepper':
      return field.testID ?? testId('settings.stepper', field.label);
    case 'link':
    case 'action':
    case 'value':
      return field.testID ?? testId('settings.row', field.label);
    case 'note':
      return field.testID ?? testId('settings.note', field.title);
    case 'chips':
    case 'custom':
      return field.testID;
  }
}

/** A row's identity among its section's rows: its own key where it has one, else its id. */
export function fieldKey(field: SettingsField): string {
  return (field.kind === 'link' && field.key) || fieldTestID(field);
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

/** The keys in their new order after SwiftUI's move: the rows at `from` lifted out and put down
 *  before what was at `to` (`move(fromOffsets:toOffset:)`). */
export function movedKeys(keys: readonly string[], from: readonly number[], to: number): string[] {
  const lifted = new Set(from);
  const moving = from.map((i) => keys[i]!);
  const rest = keys.filter((_, i) => !lifted.has(i));
  rest.splice(to - from.filter((i) => i < to).length, 0, ...moving);
  return rest;
}
