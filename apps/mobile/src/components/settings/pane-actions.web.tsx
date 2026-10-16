import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { SettingsPaneActionsContext } from '@/lib/settings-pane';

/**
 * Renders a screen's top-bar actions into the settings modal's pane header. A portal rather than
 * state handed up: the actions are a fresh element every render, so publishing them through a setter
 * re-renders the modal, which re-renders the pane, which publishes them again.
 */
export function PaneActions({ children }: { children: ReactNode }) {
  const slot = useContext(SettingsPaneActionsContext);
  if (!slot || !children) return null;
  return createPortal(children, slot);
}
