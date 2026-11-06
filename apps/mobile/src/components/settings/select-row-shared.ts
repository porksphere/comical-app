/** `SettingsSelectRow`'s contract (`select-row.tsx`, the overlay picker; iOS draws its enum rows as
 *  the settings form's own menu pickers and never reaches it). */

/** One choice in a `SettingsSelectRow`. `description` shows in the picker (not on the row); an optional
 *  `thumbnail` URL renders a leading image (e.g. a bridge icon). */
export type SettingsOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  thumbnail?: string;
};

export type SettingsSelectRowProps<T extends string> = {
  label: string;
  /** Static one-line description under the label (the current value already shows on the right). */
  description?: string;
  value: T;
  options: readonly SettingsOption<T>[];
  onChange: (value: T) => void;
  /** Heading for the picker sheet. Defaults to `label`. */
  heading?: string;
  /** Muted text shown on the right when `value` matches no option (nothing chosen yet). */
  placeholder?: string;
  /** The row's id. Defaults to `settings.select.<label>`. */
  testID?: string;
};
