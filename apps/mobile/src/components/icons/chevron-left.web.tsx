import { ChevronLeft } from 'lucide-react';

import type { IconProps } from './chevron-left';

// Web back chevron. Always use lucide on web (see AGENTS.md); the native
// `.tsx` sibling uses a system glyph because lucide-react is web-only.

/** Left-pointing chevron — the "back" glyph in the series top bar. */
export function ChevronLeftIcon({ color, size = 26 }: IconProps) {
  return <ChevronLeft color={color} size={size} />;
}
