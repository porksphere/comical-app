import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ViewInstance } from 'react-native';

type Box = { left: number; top: number; width: number; height: number };

/**
 * Draws `children` over `anchor`, in a layer of its own at the top of the document, positioned
 * absolutely against a box that tracks the anchor's on-screen rect.
 *
 * For anything that has to overflow the view it belongs to. In place it can't: LegendList's web
 * item container is `contain: paint`, which clips its contents to the cell and is the containing
 * block of a `position: fixed` inside it too, and react-native-web gives every view `z-index: 0`, so
 * a card's z-index never reaches past its own row.
 */
export function FloatOver({ anchor, children }: { anchor: RefObject<ViewInstance | null>; children: ReactNode }) {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const node = anchor.current as unknown as HTMLElement | null;
    if (!node) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      setBox((prev) =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height },
      );
    };
    measure();
    // The anchor moves without itself changing whenever anything it sits in scrolls, and those are
    // nested scrollers (the body never scrolls), whose scroll events only a capturing listener sees.
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), measure()));
    };
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [anchor]);

  if (!box) return null;
  return createPortal(
    <div style={{ position: 'fixed', ...box, zIndex: 1000, pointerEvents: 'none' }}>{children}</div>,
    document.body,
  );
}
