import { Platform, type PressableAndroidRippleConfig } from 'react-native';

import { StateLayer } from '@/constants/material';
import { useTheme } from '@/hooks/use-theme';

/** Whether a press is answered by a ripple, so a pressable need not also dim itself. */
export const RIPPLES = Platform.OS === 'android';

const PRESSED = Math.round(StateLayer.pressed * 255)
  .toString(16)
  .padStart(2, '0');

type RippleOptions = {
  /** The colour of what the pressed surface holds, as `#RRGGBB`: the theme's text unless the
   *  surface is a filled one. */
  on?: string;
  borderless?: boolean;
  radius?: number;
  /** Over the children: for a pressable whose child paints a background of its own, which would
   *  cover a ripple drawn behind it. */
  foreground?: boolean;
};

/** A `Pressable`'s `android_ripple`: Material's pressed state layer, the content colour laid faintly
 *  over the surface. The prop does nothing off Android. */
export function useRipple({ on, borderless, radius, foreground }: RippleOptions = {}): PressableAndroidRippleConfig {
  const theme = useTheme();
  return { color: `${on ?? theme.text}${PRESSED}`, borderless, radius, foreground };
}
