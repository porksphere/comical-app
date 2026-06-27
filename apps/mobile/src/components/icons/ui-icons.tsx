import { Text, type TextStyle } from 'react-native';

// Native UI icons. The web build swaps in lucide via the `.web.tsx` sibling
// (lucide-react is web-only); these system glyphs are the RN fallback. Keep the
// two files' exports in sync.

export type IconProps = { color: string; size?: number };

function Glyph({ glyph, color, size = 16, style }: IconProps & { glyph: string; style?: TextStyle }) {
  return (
    <Text
      allowFontScaling={false}
      style={[{ color, fontSize: size, lineHeight: size * 1.1, textAlign: 'center' }, style]}>
      {glyph}
    </Text>
  );
}

export const SearchIcon = (p: IconProps) => <Glyph glyph="⌕" {...p} size={(p.size ?? 16) * 1.3} />;
export const ClearIcon = (p: IconProps) => <Glyph glyph="✕" {...p} />;
export const PlayIcon = (p: IconProps) => <Glyph glyph="▶" {...p} />;
export const PlusIcon = (p: IconProps) => <Glyph glyph="＋" {...p} />;
export const StarIcon = (p: IconProps) => <Glyph glyph="☆" {...p} />;
export const ChevronDownIcon = (p: IconProps) => <Glyph glyph="▾" {...p} />;
