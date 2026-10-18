/**
 * The settings modal's open state and current category.
 *
 * Shared rather than local because two surfaces move it: the rail's settings button opens it, and
 * the modal's own category list changes what it shows. In-memory, not persisted — a settings pane
 * left open is not a state to resume into on the next launch.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

/** `page` is a sub-page to open straight onto; `opened` counts the openings, so one over an open
 *  modal starts it afresh. */
type SettingsModalState = { open: boolean; category: string; page: string | null; opened: number };

const settingsModal$ = observable<SettingsModalState>({ open: false, category: 'general', page: null, opened: 0 });

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useSettingsModal(): SettingsModalState {
  return use$(settingsModal$);
}

export function openSettingsModal(at?: { category: string; page: string }): void {
  settingsModal$.assign({ open: true, page: at?.page ?? null, opened: settingsModal$.opened.peek() + 1, ...(at && { category: at.category }) });
}

export function closeSettingsModal(): void {
  settingsModal$.open.set(false);
}

export function setSettingsCategory(category: string): void {
  settingsModal$.category.set(category);
}
