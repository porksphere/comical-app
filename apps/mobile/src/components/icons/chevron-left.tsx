import { Text } from 'react-native';

// Native back chevron. The web build swaps in lucide via the `.web.tsx`
// sibling (lucide-react is web-only); this system glyph is the RN fallback.
// Keep the two files' exports in sync.

export type IconProps = { color: string; size?: number };

/** Left-pointing chevron — the "back" glyph in the series top bar. */
export function ChevronLeftIcon({ color, size = 30 }: IconProps) {
  return (
    <Text style={{ color, fontSize: size, lineHeight: size, fontWeight: '300', marginTop: -2 }}>
      ‹
    </Text>
  );
}
