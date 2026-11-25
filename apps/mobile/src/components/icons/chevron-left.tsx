import { ArrowLeft, ChevronLeft } from 'lucide-react-native';
import { Platform } from 'react-native';

export type IconProps = { color: string; size?: number };

// Material's back affordance is an arrow.
const Back = Platform.OS === 'android' ? ArrowLeft : ChevronLeft;
const SIZE = Platform.OS === 'android' ? 24 : 26;

/** The "back" glyph of every bar the app draws: a left-pointing chevron, an arrow on Android. */
export function ChevronLeftIcon({ color, size = SIZE }: IconProps) {
  return <Back color={color} size={size} />;
}
