import type { LabelProps } from '@expo/ui/swift-ui';

import { Selector } from '@/components/selector';

export type SystemSymbol = NonNullable<LabelProps['systemImage']>;

export type NativeSelectorAction = {
  label: string;
  systemImage: SystemSymbol;
  onPress: () => void;
};

/** `Selector`'s props, for the system menu: see `native-selector.ios.tsx`. */
export type NativeSelectorProps = {
  /** Names the selection in the menu. */
  title: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Display text keyed by option value, as `Selector`'s. */
  labels?: Record<string, string>;
  /** Row pictures keyed by option value — a URL, or a bundled asset (`require(...)`), which wins. */
  thumbnails?: Record<string, string>;
  sources?: Record<string, number>;
  /** Every row carries a tile: its picture where it has one, else a mark — `glyphs[value]`, or
   *  the option's initial (the letter tile a bridge without art gets elsewhere). Off, a row
   *  without a picture is plain text. */
  tiles?: boolean;
  glyphs?: Record<string, SystemSymbol>;
  /** Rows after the options, each a command rather than a choice ("Manage collections…"). */
  actions?: NativeSelectorAction[];
  /** The trigger's text truncates past this, in points. */
  maxWidth?: number;
  testID: string;
};

/**
 * Where there is no system menu, the overlay `Selector` at the bar's size. `actions` and `glyphs`
 * have no overlay counterpart here: the bars that need them render their own overlay selector,
 * so this stands in for the typed props and the iOS file is the only one rendered in the app.
 */
export function NativeSelector({ title, value, options, onChange, labels, thumbnails, sources, testID }: NativeSelectorProps) {
  return (
    <Selector
      testID={testID}
      title={title}
      value={value}
      options={options}
      onChange={onChange}
      labels={labels}
      thumbnails={thumbnails}
      sources={sources}
      size="bar"
    />
  );
}
