"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qgPinball", Object.freeze({
  close: () => ipcRenderer.send("qg:pinball-close")
}));
