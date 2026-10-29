"use strict";

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const profile = process.env.QG_AMBIENT_PROFILE;
if (profile) {
  fs.mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}

let nativeHost = null;
let snapshot = { categories: [], tasks: [], settings: { side: "right", opacity: 0.82, motion: "measured" } };
let scenes = [];
let receivedSnapshot = false;
let lastUnavailableNotice = 0;
let refreshTimer = null;
let dragPollTimer = null;
let shuttingDown = false;
let lastShellScan = 0;
let cachedHosts = [];

const sendToParent = (message) => {
  if (process.connected) process.send(message);
};

function reportStatus(status, message) {
  sendToParent({ type: "status", payload: { status, message } });
}

function readHosts() {
  if (!nativeHost) return [];
  try { return nativeHost.enumerateDesktopHosts(); }
  catch (error) { sendToParent({ type: "shell-error", message: error.message }); return []; }
}

function monitorBounds(display) {
  return {
    x: display.bounds.x, y: display.bounds.y,
    width: display.bounds.width, height: display.bounds.height,
    scale: display.scaleFactor || 1
  };
}

function nativeHandleBuffer(handle) {
  const value = BigInt(handle);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function widgetBounds(display) {
  return { ...display.bounds };
}

function physicalDisplayBounds(display) {
  const scale = display.scaleFactor || 1;
  return {
    x: display.bounds.x * scale, y: display.bounds.y * scale,
    width: display.bounds.width * scale, height: display.bounds.height * scale
  };
}

function physicalDesktopBounds() {
  const displays = screen.getAllDisplays();
  if (!displays.length) return { x: 0, y: 0, width: 1, height: 1 };
  const bounds = displays.map(physicalDisplayBounds);
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function normalizedDesktopPoint(x, y) {
  const bounds = physicalDesktopBounds();
  return {
    x: Math.max(0, Math.min(1, (x - bounds.x) / bounds.width)),
    y: Math.max(0, Math.min(1, (y - bounds.y) / bounds.height))
  };
}

function globalCorePosition() {
  const bounds = physicalDesktopBounds();
  const saved = snapshot.settings?.widgetDesktopPosition;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: bounds.x + saved.x * bounds.width, y: bounds.y + saved.y * bounds.height };
  }
  const primary = screen.getPrimaryDisplay();
  const displayBounds = physicalDisplayBounds(primary);
  const legacy = snapshot.settings?.widgetPosition || snapshot.settings?.visual?.center || { x: 0.5, y: 0.53 };
  const localX = Number.isFinite(legacy.x) ? legacy.x : 0.5;
  const localY = Number.isFinite(legacy.y) ? legacy.y : 0.53;
  return {
    x: displayBounds.x + localX * displayBounds.width,
    y: displayBounds.y + localY * displayBounds.height
  };
}

function sceneWidgetPosition(window) {
  const display = screen.getAllDisplays().find((item) => item.id === window.__qgDisplayId);
  if (!display) return snapshot.settings?.widgetPosition || snapshot.settings?.visual?.center || { x: 0.5, y: 0.53 };
  const bounds = physicalDisplayBounds(display);
  const core = globalCorePosition();
  return { x: (core.x - bounds.x) / bounds.width, y: (core.y - bounds.y) / bounds.height };
}

function sceneSnapshot(window) {
  const settings = { ...snapshot.settings, widgetPosition: sceneWidgetPosition(window) };
  return { subjects: snapshot.subjects, categories: snapshot.categories, tasks: snapshot.tasks, settings };
}

function chooseHost(hosts, display) {
  const wanted = monitorBounds(display);
  let best = null, bestScore = -1;
  for (const candidate of hosts) {
    const r = candidate.bounds;
    const left = Math.max(wanted.x, r.x / wanted.scale);
    const top = Math.max(wanted.y, r.y / wanted.scale);
    const right = Math.min(wanted.x + wanted.width, (r.x + r.width) / wanted.scale);
    const bottom = Math.min(wanted.y + wanted.height, (r.y + r.height) / wanted.scale);
    const score = Math.max(0, right - left) * Math.max(0, bottom - top);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

function broadcastState() {
  for (const window of scenes) if (!window.isDestroyed() && !window.webContents.isLoading()) window.webContents.send("qg:scene-state", sceneSnapshot(window));
}

function notifyUnavailable(message) {
  reportStatus("unavailable", message);
  const now = Date.now();
  if (now - lastUnavailableNotice < 900_000) return;
  lastUnavailableNotice = now;
  sendToParent({ type: "shell-unavailable", message });
}

function createScene(display, desktopHost) {
  const bounds = widgetBounds(display);
  const window = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    show: false, frame: false, transparent: true, backgroundColor: "#00000000",
    resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false,
    paintWhenInitiallyHidden: false,
    webPreferences: {
      preload: path.join(__dirname, "scene-preload.cjs"), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false
    }
  });
  const nativeWindowHandle = window.getNativeWindowHandle();
  window.__qgNativeHandle = nativeWindowHandle;
  window.__qgHandle = nativeWindowHandle.readBigUInt64LE(0).toString();
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setFocusable(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
  const cockpitEntry = app.isPackaged
    ? path.join(process.resourcesPath, "widget", "index.html")
    : path.resolve(__dirname, "../../index.html");
  window.loadFile(cockpitEntry, { query: { desktopWidget: "1" } });
  window.webContents.once("did-finish-load", () => {
    try {
      if (!nativeHost) throw new Error("Le module Windows de la couche arrière n’est pas disponible.");
      const currentDisplay = screen.getAllDisplays().find((item) => item.id === display.id) || display;
      const currentBounds = widgetBounds(currentDisplay);
      window.__qgDisplayId = display.id;
      window.__qgIconView = desktopHost.iconView;
      nativeHost.attachToDesktop(
        nativeWindowHandle,
        nativeHandleBuffer(desktopHost.handle),
        monitorBounds({ ...currentDisplay, bounds: currentBounds })
      );
      window.__qgAttached = true;
      window.showInactive();
      window.webContents.send("qg:scene-state", sceneSnapshot(window));
      reportStatus("visible", "Widget transparent actif derrière les icônes.");
    } catch (error) {
      reportStatus("unavailable", "Windows n’a pas pu afficher le widget derrière les icônes.");
      sendToParent({ type: "attach-error", message: error.message });
      window.destroy();
    }
  });
  window.on("closed", () => {
    try { nativeHost?.removeCoreDragArea?.(nativeWindowHandle); } catch (_) {}
    scenes = scenes.filter((item) => item !== window);
  });
  scenes.push(window);
}

function moveScenesInPlace() {
  if (!nativeHost || !scenes.length) return false;
  const displays = screen.getAllDisplays();
  try {
    for (const window of scenes) {
      if (window.isDestroyed() || !window.__qgAttached) continue;
      const display = displays.find((item) => item.id === window.__qgDisplayId);
      if (!display) return false;
      const bounds = widgetBounds(display);
      nativeHost.moveDesktopWindow(
        window.getNativeWindowHandle(),
        monitorBounds({ ...display, bounds })
      );
    }
    return true;
  } catch (error) {
    sendToParent({ type: "shell-error", message: error.message });
    return false;
  }
}

function rebuildScenes() {
  for (const window of scenes) if (!window.isDestroyed()) window.destroy();
  scenes = [];
  if (!receivedSnapshot) return;
  if (snapshot.settings?.fieldEnabled === false) { reportStatus("hidden", "Widget transparent masqué dans les préférences."); return; }
  reportStatus("starting", "Recherche de la couche arrière du bureau Windows…");
  cachedHosts = readHosts();
  lastShellScan = Date.now();
  const hosts = cachedHosts;
  if (!hosts.length) {
    notifyUnavailable("Le fond Windows n’a pas pu être détecté; la scène reste masquée pour protéger vos icônes.");
    return;
  }
  let created = 0;
  for (const display of screen.getAllDisplays()) {
    const host = chooseHost(hosts, display);
    if (host) { createScene(display, host); created++; }
  }
  if (!created) notifyUnavailable("Aucune surface de fond Windows compatible n’a été trouvée.");
  else reportStatus("starting", "Installation du widget derrière les icônes…");
}

function checkShell() {
  if (!receivedSnapshot || snapshot.settings?.fieldEnabled === false) return;
  if (Date.now() - lastShellScan > 8000) {
    cachedHosts = readHosts();
    lastShellScan = Date.now();
  }
  const hosts = cachedHosts;
  const current = new Set(hosts.map((entry) => entry.handle));
  const missing = scenes.some((window) => {
    if (window.isDestroyed() || window.webContents.isLoading()) return false;
    const parent = nativeHost ? nativeHost.getParentHandle(window.getNativeWindowHandle()) : null;
    return !parent || (current.size > 0 && !current.has(parent));
  });
  if (missing || (!scenes.length && current.size)) rebuildScenes();
}

ipcMain.on("qg:scene-input", (event, enabled) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return;
  // Keep the scene click-through at all times; toggling this off removes the
  // native transparent-child style needed by Windows' desktop composition.
  window.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.on("qg:scene-hit-area", (event, area) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed() || !window.__qgAttached || !area || !nativeHost?.setCoreDragArea) return;
  if (![area.x, area.y, area.radius].every(Number.isFinite)) return;
  const display = screen.getAllDisplays().find((item) => item.id === window.__qgDisplayId);
  if (!display) return;
  const scale = display.scaleFactor || 1;
  const bounds = display.bounds;
  try {
    nativeHost.setCoreDragArea(window.__qgNativeHandle, nativeHandleBuffer(window.__qgIconView), {
      x: (bounds.x + area.x) * scale,
      y: (bounds.y + area.y) * scale,
      radius: area.radius * scale
    });
  } catch (error) {
    sendToParent({ type: "shell-error", message: error.message });
  }
});

ipcMain.on("qg:scene-mascot-area", (event, area) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed() || !window.__qgAttached || !area || !nativeHost?.setMascotClickArea) return;
  if (![area.x, area.y, area.radius].every(Number.isFinite)) return;
  const display = screen.getAllDisplays().find((item) => item.id === window.__qgDisplayId);
  if (!display) return;
  const scale = display.scaleFactor || 1;
  const bounds = physicalDisplayBounds(display);
  try {
    nativeHost.setMascotClickArea(window.__qgNativeHandle, nativeHandleBuffer(window.__qgIconView), {
      x: bounds.x + area.x * display.bounds.width * scale,
      y: bounds.y + area.y * display.bounds.height * scale,
      radius: area.radius * scale,
      active: area.active === true
    });
  } catch (error) {
    sendToParent({ type: "shell-error", message: error.message });
  }
});

ipcMain.on("qg:scene-position", (_event, position) => {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
  const window = BrowserWindow.fromWebContents(_event.sender);
  const display = window && screen.getAllDisplays().find((item) => item.id === window.__qgDisplayId);
  if (!display) return;
  const bounds = physicalDisplayBounds(display);
  const normalized = normalizedDesktopPoint(
    bounds.x + position.x * bounds.width,
    bounds.y + position.y * bounds.height
  );
  snapshot.settings = { ...snapshot.settings, widgetDesktopPosition: normalized };
  broadcastState();
  sendToParent({ type: "widget-position", payload: normalized });
});

ipcMain.on("qg:scene-view", (_event, view) => {
  if (!view || typeof view !== "object") return;
  sendToParent({ type: "widget-view", payload: {
    viewYaw: Number.isFinite(view.viewYaw) ? view.viewYaw : 0,
    viewPitch: Number.isFinite(view.viewPitch) ? view.viewPitch : 0,
    zoom: Number.isFinite(view.zoom) ? Math.max(.65, Math.min(6, view.zoom)) : 1,
    zoomPan: {
      x: Number.isFinite(view.zoomPan?.x) ? Math.max(-2.5, Math.min(2.5, view.zoomPan.x)) : 0,
      y: Number.isFinite(view.zoomPan?.y) ? Math.max(-2.5, Math.min(2.5, view.zoomPan.y)) : 0
    },
    focusTaskId: /^[a-zA-Z0-9_-]{1,80}$/.test(String(view.focusTaskId || "")) ? String(view.focusTaskId) : null
  } });
});

ipcMain.on("qg:scene-pinball", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window && scenes.includes(window)) sendToParent({ type: "pinball" });
});

function pollCoreDrag() {
  if (!nativeHost?.pollCoreDrag) return;
  let events;
  try { events = nativeHost.pollCoreDrag(); }
  catch (error) { sendToParent({ type: "shell-error", message: error.message }); return; }
  for (const drag of events || []) {
    const window = scenes.find((scene) => scene.__qgHandle === String(drag.handle));
    if (!window || window.isDestroyed() || window.webContents.isLoading()) continue;
    if (drag.kind === "mascot-click") {
      window.webContents.send("qg:scene-mascot-click");
      continue;
    }
    const display = screen.getAllDisplays().find((item) => item.id === window.__qgDisplayId);
    if (!display) continue;
    if (![drag.x, drag.y, drag.originX, drag.originY, drag.coreOriginX, drag.coreOriginY].every(Number.isFinite)) continue;
    const nextPosition = normalizedDesktopPoint(
      drag.coreOriginX + drag.x - drag.originX,
      drag.coreOriginY + drag.y - drag.originY
    );
    snapshot.settings = { ...snapshot.settings, widgetDesktopPosition: nextPosition };
    broadcastState();
    if (drag.phase === "end") sendToParent({ type: "widget-position", payload: nextPosition });
  }
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "snapshot" && message.payload && typeof message.payload === "object") {
    const previousSide = snapshot.settings?.side;
    snapshot = message.payload;
    receivedSnapshot = true;
    if (snapshot.settings?.fieldEnabled === false || !scenes.length) rebuildScenes();
    else if (previousSide !== snapshot.settings?.side) {
      if (moveScenesInPlace()) {
        broadcastState();
        reportStatus("visible", "Widget transparent déplacé sur le bureau.");
      } else rebuildScenes();
    } else broadcastState();
  } else if (message.type === "rebuild") {
    rebuildScenes();
  } else if (message.type === "shutdown") {
    shuttingDown = true;
    if (refreshTimer) clearInterval(refreshTimer);
    if (dragPollTimer) clearInterval(dragPollTimer);
    try { nativeHost?.removeCoreDragHook?.(); } catch (_) {}
    for (const window of scenes) if (!window.isDestroyed()) window.destroy();
    app.quit();
  }
});

process.on("disconnect", () => {
  shuttingDown = true;
  if (refreshTimer) clearInterval(refreshTimer);
  if (app.isReady()) app.quit();
});

app.whenReady().then(() => {
  if (process.platform !== "win32") { sendToParent({ type: "shell-unavailable", message: "La couche arrière cible Windows." }); app.quit(); return; }
  try { nativeHost = require("desktop-host"); }
  catch (error) { sendToParent({ type: "shell-unavailable", message: `Le module de bureau Windows ne s’est pas chargé : ${error.message}` }); }
  if (shuttingDown) { app.quit(); return; }
  app.setAppUserModelId("ca.ceomelyxja.qgdesktop.ambient");
  screen.on("display-added", rebuildScenes);
  screen.on("display-removed", rebuildScenes);
  screen.on("display-metrics-changed", rebuildScenes);
  refreshTimer = setInterval(checkShell, 1400);
  dragPollTimer = setInterval(pollCoreDrag, 16);
  checkShell();
  sendToParent({ type: "ready" });
});

app.on("before-quit", () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (dragPollTimer) clearInterval(dragPollTimer);
  try { nativeHost?.removeCoreDragHook?.(); } catch (_) {}
});

app.on("window-all-closed", () => { if (shuttingDown) app.quit(); });
