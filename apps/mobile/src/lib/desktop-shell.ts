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
  setRunInTray(on: boolean): void;
  dimCaptionButtons(dim: boolean): void;
  watchTopEdge(edge: number, onChange: (inside: boolean) => void): () => void;
};

export function desktopShell(): DesktopShell | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  return (window as Window & { comicalDesktop?: DesktopShell }).comicalDesktop;
}

/** Seeded from the shell's own saved copy, which is what it acts on when the window closes. */
const runInTray$ = observable(desktopShell()?.runInTray ?? false);

export function useRunInTray(): [boolean, (on: boolean) => void] {
  return [use$(runInTray$), setRunInTray];
}

function setRunInTray(on: boolean): void {
  runInTray$.set(on);
  desktopShell()?.setRunInTray(on);
}

/** What the platform calls the place a background app's icon lives. */
export function trayName(): string {
  return desktopShell()?.platform === 'darwin' ? 'menu bar' : 'tray';
}
