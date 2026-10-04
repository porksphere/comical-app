/**
 * The page's one line to the shell, for what no web standard can say. Sandboxed, so `electron`'s
 * renderer half is all it can reach.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { PairedDevice } from "@comical/sync";

const settings = ipcRenderer.sendSync("shell-settings") as {
  runInTray: boolean;
  openAtLogin: boolean;
  loginItems: boolean;
  updates: boolean;
  networkSync: boolean;
};

contextBridge.exposeInMainWorld("comicalDesktop", {
  platform: process.platform,
  /** As saved when the page loaded; the page owns them from there, through the setters. */
  runInTray: settings.runInTray,
  openAtLogin: settings.openAtLogin,
  /** False in a dev run, which has nothing a login launch could start. */
  loginItems: settings.loginItems,
  /** This build installs its own updates. False in dev, on a PR build and on a .deb. */
  updates: settings.updates,
  /** Called with the version once an update has downloaded — at once, if one already has. Returns
   *  the unsubscribe. */
  onUpdateReady: (onReady: (version: string) => void) => {
    const listener = (_e: IpcRendererEvent, version: string) => onReady(version);
    ipcRenderer.on("update-ready", listener);
    const ready = ipcRenderer.sendSync("update-ready?") as string | null;
    if (ready) onReady(ready);
    return () => {
      ipcRenderer.off("update-ready", listener);
    };
  },
  /** A JSON asset of one of this app's Releases, fetched by the shell — the page's own fetch of one
   *  is refused for want of CORS headers. Rejects when it can't be had. */
  releaseJson: (url: string) => ipcRenderer.invoke("release-json", url) as Promise<unknown>,
  /** Quit, install the downloaded update and relaunch. */
  installUpdate: () => ipcRenderer.send("update-install"),
  /** Routes to open (a `comical://` link, a click on a notice) and the back/forward buttons. Call
   *  once the page can navigate: anything asked for before then is delivered at once. Returns the
   *  unsubscribe. */
  onShellCommand: (
    onCommand: (command: { type: "open"; route: string } | { type: "navigate"; dir: "back" | "forward" }) => void,
  ) => {
    const listener = (_e: IpcRendererEvent, command: Parameters<typeof onCommand>[0]) => onCommand(command);
    ipcRenderer.on("shell-command", listener);
    const pending = ipcRenderer.sendSync("shell-commands") as string | null;
    if (pending) onCommand({ type: "open", route: pending });
    return () => {
      ipcRenderer.off("shell-command", listener);
    };
  },
  /** A system notice; clicking it brings the window up on `route`. */
  notify: (title: string, body: string, route?: string) => ipcRenderer.send("notify", title, body, route ?? null),
  setRunInTray: (on: boolean) => ipcRenderer.send("run-in-tray", on === true),
  setOpenAtLogin: (on: boolean) => ipcRenderer.send("open-at-login", on === true),
  /** Whether phones on the network may sync with this library, as saved when the page loaded. */
  networkSync: settings.networkSync,
  /** Resolves to where a phone reaches this computer — null when turned off, or while this
   *  computer is on no network. */
  setNetworkSync: (on: boolean) => ipcRenderer.invoke("network-sync", on === true) as Promise<string | null>,
  networkSyncAddress: () => ipcRenderer.invoke("network-sync") as Promise<string | null>,
  /** What one phone scans to pair: this computer's address ending in a code that works once, until
   *  `expiresAt`. Each call replaces the last code. Null when sync is off or there is no network. */
  openSyncPairing: () =>
    ipcRenderer.invoke("sync-pairing-open") as Promise<{ address: string; expiresAt: number } | null>,
  /** The code on screen is no longer on screen. */
  closeSyncPairing: () => ipcRenderer.send("sync-pairing-close"),
  /** The devices paired with this computer, most recently active first. */
  syncDevices: () => ipcRenderer.invoke("sync-devices") as Promise<PairedDevice[]>,
  /** Stop syncing with one of them. The others are untouched. False when it wasn't paired. */
  unlinkSyncDevice: (id: string) => ipcRenderer.invoke("sync-device-unlink", id) as Promise<boolean>,
  /** Called with the new list whenever it changes. Returns the unsubscribe. */
  onSyncDevices: (onDevices: (devices: PairedDevice[]) => void) => {
    const listener = (_e: IpcRendererEvent, devices: PairedDevice[]) => onDevices(devices);
    ipcRenderer.on("sync-devices", listener);
    return () => {
      ipcRenderer.off("sync-devices", listener);
    };
  },
  /** Called when another device's changes have landed in this library. Returns the unsubscribe. */
  onSynced: (onSynced: () => void) => {
    const listener = () => onSynced();
    ipcRenderer.on("synced", listener);
    return () => {
      ipcRenderer.off("synced", listener);
    };
  },
  /** Fade the caption buttons' glyphs back, for a screen that has hidden its own chrome. */
  dimCaptionButtons: (dim: boolean) => ipcRenderer.send("caption-dim", dim === true),
  /** Reports the pointer entering and leaving the top `edge` px of the window — over a drag
   *  region, where the page itself receives no pointer events. Returns the unsubscribe. */
  watchTopEdge: (edge: number, onChange: (inside: boolean) => void) => {
    const listener = (_e: IpcRendererEvent, inside: boolean) => onChange(inside === true);
    ipcRenderer.on("top-edge", listener);
    ipcRenderer.send("top-edge-watch", edge);
    return () => {
      ipcRenderer.off("top-edge", listener);
      ipcRenderer.send("top-edge-watch", 0);
    };
  },
});
