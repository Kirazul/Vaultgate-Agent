// Minimal, typed bridge. The renderer has no Node access; anything
// it needs from the OS must be added here explicitly.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vaultgate", {
  platform: process.platform,
  version: process.versions.electron,
  window: {
    close: () => ipcRenderer.send("window:close"),
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    toggleFullscreen: () => ipcRenderer.send("window:toggle-fullscreen"),
  },
  dialog: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:openFolder"),
  },
});
