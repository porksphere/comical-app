/**
 * What the desktop (Electron) shell exposes to the page through its preload — absent in a browser
 * and on native, where every caller here degrades to doing nothing.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import type { PairedDevice } from '@comical/sync';
import { Platform } from 'react-native';

export type ShellCommand = { type: 'open'; route: string } | { type: 'navigate'; dir: 'back' | 'forward' };

/** Where the shell's own update stands. `ready` carries the version a restart installs; `manual`
 *  means it couldn't get one the page knows of, which leaves the download page. */
export type DesktopUpdate =
  | { phase: 'idle' | 'downloading' | 'manual'; version: null }
  | { phase: 'ready'; version: string };

/** What one phone scans to pair with this computer: its address ending in a code that works once, until `expiresAt`. */
export type PairingOffer = { address: string; expiresAt: number };

type DesktopShell = {
  platform: string;
  runInTray: boolean;
  openAtLogin: boolean;
  loginItems: boolean;
  /** Absent before the shell could install its own updates. */
  updates?: boolean;
  onUpdateState?(onState: (state: DesktopUpdate) => void): () => void;
  downloadUpdate?(): void;
  installUpdate?(): void;
  /** Absent before the shell fetched Release assets for the page. */
  releaseJson?(url: string): Promise<unknown>;
  /** Absent before the shell had links, notices or back/forward to pass on. */
  onShellCommand?(onCommand: (command: ShellCommand) => void): () => void;
  notify?(title: string, body: string, route?: string): void;
  /** Absent before the shell could be other devices' sync hub. */
  networkSync?: boolean;
  setNetworkSync?(on: boolean): Promise<string | null>;
  networkSyncAddress?(): Promise<string | null>;
  openSyncPairing?(): Promise<PairingOffer | null>;
  closeSyncPairing?(): void;
  syncDevices?(): Promise<PairedDevice[]>;
  unlinkSyncDevice?(id: string): Promise<boolean>;
  onSyncDevices?(onDevices: (devices: PairedDevice[]) => void): () => void;
  onSynced?(onSynced: () => void): () => void;
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
  update: { phase: 'idle', version: null } as DesktopUpdate,
  networkSync: desktopShell()?.networkSync ?? false,
  networkSyncAddress: null as string | null,
  syncDevices: [] as PairedDevice[],
});
desktopShell()?.onUpdateState?.((update) => shell$.update.set(update));
desktopShell()?.onSyncDevices?.((devices) => shell$.syncDevices.set(devices));
void desktopShell()
  ?.syncDevices?.()
  .then((devices) => shell$.syncDevices.set(devices));

/** Whether this build downloads and installs its own updates (a release or nightly build's Windows
 *  installer or AppImage). Everywhere else an update is a link to the download page. */
export function desktopSelfUpdates(): boolean {
  return desktopShell()?.updates === true;
}

export function useDesktopUpdate(): DesktopUpdate {
  return use$(shell$.update);
}

/** Have a self-updating build fetch the update now; it reports back through `useDesktopUpdate`.
 *  Nothing happens on a build that doesn't update itself. */
export function downloadDesktopUpdate(): void {
  desktopShell()?.downloadUpdate?.();
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

/** Whether this shell can let other devices sync with its library. */
export function desktopSyncsDevices(): boolean {
  return !!desktopShell()?.setNetworkSync;
}

export function useNetworkSync(): [boolean, (on: boolean) => void] {
  return [use$(shell$.networkSync), setNetworkSync];
}

function setNetworkSync(on: boolean): void {
  shell$.networkSync.set(on);
  shell$.networkSyncAddress.set(null);
  void desktopShell()
    ?.setNetworkSync?.(on)
    .then((address) => shell$.networkSyncAddress.set(address));
}

/** Where a phone reaches this computer; null while off or on no network. */
export function useNetworkSyncAddress(): string | null {
  return use$(shell$.networkSyncAddress);
}

/** For a screen about to offer pairing: the computer may have changed networks since. Kept out
 *  of the hook above, which a real hook beside its `use$` would get compiled and break. */
export function refreshNetworkSyncAddress(): void {
  void desktopShell()
    ?.networkSyncAddress?.()
    .then((address) => shell$.networkSyncAddress.set(address));
}

/** The devices paired with this computer, most recently active first; kept current by the shell. */
export function useSyncDevices(): PairedDevice[] {
  return use$(shell$.syncDevices);
}

/** A fresh code for one phone to pair with, replacing any still open. Null while sync is off or
 *  this computer is on no network. */
export function openSyncPairing(): Promise<PairingOffer | null> {
  return desktopShell()?.openSyncPairing?.() ?? Promise.resolve(null);
}

/** The code is off the screen, so it stops working. */
export function closeSyncPairing(): void {
  desktopShell()?.closeSyncPairing?.();
}

/** Stop syncing with one paired device; the rest carry on. The list above loses it by itself. */
export async function unlinkSyncDevice(id: string): Promise<void> {
  await desktopShell()?.unlinkSyncDevice?.(id);
}

/** What the platform calls the place a background app's icon lives. */
export function trayName(): string {
  return desktopShell()?.platform === 'darwin' ? 'menu bar' : 'tray';
}
