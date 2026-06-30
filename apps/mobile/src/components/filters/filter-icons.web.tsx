import { ArrowUpDown, Check, SlidersHorizontal } from 'lucide-react';

import type { IconProps } from './filter-icons';

// Web icons for the filter bar. Always use lucide on web (see AGENTS.md); the
// native `.tsx` sibling hand-builds equivalents because lucide-react is web-only.

/** Sliders — the "filters" glyph on the overflow chip. */
export function FiltersIcon({ color, size = 16 }: IconProps) {
  return <SlidersHorizontal color={color} size={size} />;
}

/** Checkmark — the "show results" confirm glyph in the filters sheet. */
export function CheckIcon({ color, size = 22 }: IconProps) {
  return <Check color={color} size={size} strokeWidth={3} />;
}

/** Up/down arrows — the sort glyph. */
export function SortIcon({ color, size = 16 }: IconProps) {
  return <ArrowUpDown color={color} size={size} />;
}
