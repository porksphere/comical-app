/**
 * The page's one line to the shell, for what no web standard can say. Sandboxed, so `electron`'s
 * renderer half is all it can reach.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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
  /** Resolves to the address a phone is given as its sync server — null when turned off, or while
   *  this computer is on no network. */
  setNetworkSync: (on: boolean) => ipcRenderer.invoke("network-sync", on === true) as Promise<string | null>,
  networkSyncAddress: () => ipcRenderer.invoke("network-sync") as Promise<string | null>,
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
