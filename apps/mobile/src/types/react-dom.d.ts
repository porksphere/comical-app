// react-dom is only here as react-native-web's renderer, so its types aren't installed; this is the
// one piece of it the app calls directly (FloatOver, web only).

declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
