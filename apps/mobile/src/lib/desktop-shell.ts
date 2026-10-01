/**
 * What the desktop (Electron) shell exposes to the page through its preload — absent in a browser
 * and on native, where every caller here degrades to doing nothing.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { Platform } from 'react-native';

type DesktopShell = {
  platform: string;
  runInTray: boolean;
  openAtLogin: boolean;
  loginItems: boolean;
  setRunInTray(on: boolean): void;
  setOpenAtLogin(on: boolean): void;
  dimCaptionButtons(dim: boolean): void;
  watchTopEdge(edge: number, onChange: (inside: boolean) => void): () => void;
};

export function desktopShell(): DesktopShell | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  return (window as Window & { comicalDesktop?: DesktopShell }).comicalDesktop;
}

/** Seeded from the shell's own saved copies, which are what it acts on when the window closes or
 *  the session starts. */
const shell$ = observable({
  runInTray: desktopShell()?.runInTray ?? false,
  openAtLogin: desktopShell()?.openAtLogin ?? false,
});

export function useRunInTray(): [boolean, (on: boolean) => void] {
  return [use$(shell$.runInTray), setRunInTray];
}

function setRunInTray(on: boolean): void {
  shell$.runInTray.set(on);
  desktopShell()?.setRunInTray(on);
}

export function useOpenAtLogin(): [boolean, (on: boolean) => void] {
  return [use$(shell$.openAtLogin), setOpenAtLogin];
}

function setOpenAtLogin(on: boolean): void {
  shell$.openAtLogin.set(on);
  desktopShell()?.setOpenAtLogin(on);
}

/** What the platform calls the place a background app's icon lives. */
export function trayName(): string {
  return desktopShell()?.platform === 'darwin' ? 'menu bar' : 'tray';
}
