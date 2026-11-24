import type { ImageSourcePropType } from 'react-native';

/**
 * The Material Symbol Android draws for the SF Symbol a menu row or a select verb names
 * (`MenuRowSpec.symbol`, `SelectVerb.symbol`), so a row names its native glyph once and each
 * platform draws its own. Those fields are typed by this table's keys: a symbol with no pair here
 * fails the typecheck. Rounded, weight 400, 24dp, as the vector drawables Google publishes for
 * Android (assets/material-symbols, the `tint` attribute taken off), which the Jetpack Compose
 * components `@expo/ui` hosts draw. Only `.android` files import the table itself, so no other
 * bundle carries the files.
 */
const MATERIAL_SYMBOLS = {
  'checkmark.circle': require('@/assets/material-symbols/check_circle.xml'),
  'xmark.circle': require('@/assets/material-symbols/cancel.xml'),
  xmark: require('@/assets/material-symbols/close.xml'),
  eye: require('@/assets/material-symbols/visibility.xml'),
  'eye.slash': require('@/assets/material-symbols/visibility_off.xml'),
  checklist: require('@/assets/material-symbols/done_all.xml'),
  folder: require('@/assets/material-symbols/folder.xml'),
  plus: require('@/assets/material-symbols/add.xml'),
  star: require('@/assets/material-symbols/star.xml'),
  'star.fill': require('@/assets/material-symbols/star_fill.xml'),
  'person.crop.circle': require('@/assets/material-symbols/account_circle.xml'),
  play: require('@/assets/material-symbols/play_arrow.xml'),
  pause: require('@/assets/material-symbols/pause.xml'),
  'arrow.up': require('@/assets/material-symbols/arrow_upward.xml'),
  'arrow.down.circle': require('@/assets/material-symbols/arrow_circle_down.xml'),
  'arrow.down.to.line': require('@/assets/material-symbols/download.xml'),
  'arrow.counterclockwise': require('@/assets/material-symbols/restart_alt.xml'),
  trash: require('@/assets/material-symbols/delete.xml'),
} satisfies Record<string, ImageSourcePropType>;

export type MenuSymbol = keyof typeof MATERIAL_SYMBOLS;

export function materialSymbol(symbol: MenuSymbol | undefined): ImageSourcePropType | undefined {
  return symbol && MATERIAL_SYMBOLS[symbol];
}
