import type { ReactNode, RefObject } from 'react';
import type { View } from 'react-native';

/** Web only (see `float-over.web.tsx`): native has no hover, so nothing floats over a card there. */
export function FloatOver(_: { anchor: RefObject<View | null>; children: ReactNode }) {
  return null;
}
