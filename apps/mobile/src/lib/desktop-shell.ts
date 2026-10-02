/**
 * What the desktop (Electron) shell exposes to the page through its preload — absent in a browser
 * and on native, where every caller here degrades to doing nothing.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { Platform } from 'react-native';

export type ShellCommand = { type: 'open'; route: string } | { type: 'navigate'; dir: 'back' | 'forward' };

type DesktopShell = {
  platform: string;
  runInTray: boolean;
  openAtLogin: boolean;
  loginItems: boolean;
  /** Absent before the shell could install its own updates. */
  updates?: boolean;
  onUpdateReady?(onReady: (version: string) => void): () => void;
  installUpdate?(): void;
  /** Absent before the shell had links, notices or back/forward to pass on. */
  onShellCommand?(onCommand: (command: ShellCommand) => void): () => void;
  notify?(title: string, body: string, route?: string): void;
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
  updateReady: null as string | null,
});
desktopShell()?.onUpdateReady?.((version) => shell$.updateReady.set(version));

/** Whether this build downloads and installs its own updates (a release build's Windows installer
 *  or AppImage). Everywhere else an update is a link to the download page. */
export function desktopSelfUpdates(): boolean {
  return desktopShell()?.updates === true;
}

/** The version a self-updating build has downloaded and will install on restart, once it has. */
export function useDesktopUpdateReady(): string | null {
  return use$(shell$.updateReady);
}

export function installDesktopUpdate(): void {
  desktopShell()?.installUpdate?.();
}

/** A system notice, which brings the window up on `route` when clicked. */
export function notifyDesktop(title: string, body: string, route?: string): void {
  desktopShell()?.notify?.(title, body, route);
}

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
