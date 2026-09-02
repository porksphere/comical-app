/**
 * The settings modal's open state and current category.
 *
 * Shared rather than local because two surfaces move it: the rail's settings button opens it, and
 * the modal's own category list changes what it shows. In-memory, not persisted — a settings pane
 * left open is not a state to resume into on the next launch.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

type SettingsModalState = { open: boolean; category: string };

const settingsModal$ = observable<SettingsModalState>({ open: false, category: 'general' });

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useSettingsModal(): SettingsModalState {
  return use$(settingsModal$);
}

export function openSettingsModal(): void {
  settingsModal$.assign({ open: true });
}

export function closeSettingsModal(): void {
  settingsModal$.open.set(false);
}

export function setSettingsCategory(category: string): void {
  settingsModal$.category.set(category);
}
