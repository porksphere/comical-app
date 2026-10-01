/**
 * The page's one line to the shell, for what no web standard can say. Sandboxed, so `electron`'s
 * renderer half is all it can reach.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const settings = ipcRenderer.sendSync("shell-settings") as {
  runInTray: boolean;
  openAtLogin: boolean;
  loginItems: boolean;
};

contextBridge.exposeInMainWorld("comicalDesktop", {
  platform: process.platform,
  /** As saved when the page loaded; the page owns them from there, through the setters. */
  runInTray: settings.runInTray,
  openAtLogin: settings.openAtLogin,
  /** False in a dev run, which has nothing a login launch could start. */
  loginItems: settings.loginItems,
  setRunInTray: (on: boolean) => ipcRenderer.send("run-in-tray", on === true),
  setOpenAtLogin: (on: boolean) => ipcRenderer.send("open-at-login", on === true),
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
