/**
 * The page's one line to the shell, for what no web standard can say. Sandboxed, so `electron`'s
 * renderer half is all it can reach.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("comicalDesktop", {
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
