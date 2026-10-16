import type { ReactNode } from 'react';

/** The settings modal is web-only (`SETTINGS_AS_MODAL`), so there is no pane header to render into here. */
export function PaneActions(_: { children: ReactNode }) {
  return null;
}
