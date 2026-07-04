import { useState } from 'react';

/** Web-only pointer hover state, exposed as `Pressable`'s `onHoverIn`/`onHoverOut` handlers
 *  plus the current boolean — native platforms never call these, so `hovered` just stays
 *  false there and the row falls back to its plain pressed state. */
export function useHovered() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    onHoverIn: () => setHovered(true),
    onHoverOut: () => setHovered(false),
  };
}
