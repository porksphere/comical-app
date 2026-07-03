import { ChevronLeft } from 'lucide-react-native';

export type IconProps = { color: string; size?: number };

/** Left-pointing chevron — the "back" glyph in the series top bar. */
export function ChevronLeftIcon({ color, size = 26 }: IconProps) {
  return <ChevronLeft color={color} size={size} />;
}
