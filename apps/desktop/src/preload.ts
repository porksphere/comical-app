/**
 * The page's one line to the shell, for what no web standard can say. Sandboxed, so `electron`'s
 * renderer half is all it can reach.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("comicalDesktop", {
  /** Fade the caption buttons' glyphs back, for a screen that has hidden its own chrome. */
  dimCaptionButtons: (dim: boolean) => ipcRenderer.send("caption-dim", dim === true),
});
