"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qgScene", Object.freeze({
  onAmbientState: (handler) => {
    const listener = (_event, active) => handler(Boolean(active));
    ipcRenderer.on("qg:ambient-active", listener);
    return () => ipcRenderer.removeListener("qg:ambient-active", listener);
  },
  onSceneState: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    ipcRenderer.on("qg:scene-state", listener);
    return () => ipcRenderer.removeListener("qg:scene-state", listener);
  },
  setInputEnabled: (enabled) => ipcRenderer.send("qg:scene-input", Boolean(enabled)),
  saveWidgetPosition: (position) => {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    ipcRenderer.send("qg:scene-position", { x: position.x, y: position.y });
  },
  saveWidgetView: (view) => {
    if (!view || typeof view !== "object") return;
    ipcRenderer.send("qg:scene-view", {
      viewYaw: Number.isFinite(view.viewYaw) ? view.viewYaw : 0,
      viewPitch: Number.isFinite(view.viewPitch) ? view.viewPitch : 0,
      zoom: Number.isFinite(view.zoom) ? view.zoom : 1,
      zoomPan: {
        x: Number.isFinite(view.zoomPan?.x) ? Math.max(-2.5, Math.min(2.5, view.zoomPan.x)) : 0,
        y: Number.isFinite(view.zoomPan?.y) ? Math.max(-2.5, Math.min(2.5, view.zoomPan.y)) : 0
      },
      focusTaskId: /^[a-zA-Z0-9_-]{1,80}$/.test(String(view.focusTaskId || "")) ? String(view.focusTaskId) : null
    });
  },
  openPinball: () => ipcRenderer.send("qg:scene-pinball")
}));
