import { useCallback, useState } from 'react';

/**
 * Web-only hover-highlight state for a `Pressable`: wire `handlers` onto the
 * trigger and use `hovered` to tint it. `onHoverIn`/`onHoverOut` are real RN
 * props (typed cross-platform) that only ever fire on web — native has no
 * hover concept, so `hovered` simply stays `false` there.
 */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);
  return { hovered, handlers: { onHoverIn, onHoverOut } };
}
