import { Text, type TextStyle } from 'react-native';

import type { IconProps } from './ui-icons';

// Native reader icons (system glyphs). The web build swaps in lucide via the
// `.web.tsx` sibling. Keep the two files' exports in sync.

function Glyph({ glyph, color, size = 16, style }: IconProps & { glyph: string; style?: TextStyle }) {
  return (
    <Text
      allowFontScaling={false}
      style={[{ color, fontSize: size, lineHeight: size * 1.1, textAlign: 'center' }, style]}>
      {glyph}
    </Text>
  );
}

export const SettingsIcon = (p: IconProps) => <Glyph glyph="⚙" {...p} />;
export const WarnIcon = (p: IconProps) => <Glyph glyph="⚠" {...p} />;
