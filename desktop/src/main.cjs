"use strict";

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, screen, shell, nativeImage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

if (process.argv.includes("--qg-ambient-host")) {
  require("./ambient.cjs");
} else if (process.platform !== "win32") {
  app.whenReady().then(() => dialog.showErrorBox("DumbFuckCockpit Widget", "Le widget transparent cible Windows 10 et Windows 11."));
} else {
  // Keep the original QG Desktop data folder across the DumbFuckCockpit rebrand.
  app.setPath("userData", path.join(app.getPath("appData"), "QG Desktop"));
  const singleInstance = app.requestSingleInstanceLock();
  if (!singleInstance) app.quit();
  else {
  app.on("second-instance", () => { if (appReady) openPanel(); else secondInstancePending = true; });
  const CATEGORIES = [
    ["tat", "Boutique", "#b77f83"], ["ate", "Atelier 3D", "#8e9d7b"], ["dro", "Studio drone", "#77979a"],
    ["gar", "Garage trottinette", "#b38c63"], ["lab", "Labo code", "#9586a6"], ["ban", "Banque", "#b8a477"],
    ["cor", "Corps", "#78a398"], ["mai", "Maison connectée", "#ad8068"], ["cry", "Crypto", "#a39870"],
    ["vr", "VR et AR", "#9685a3"], ["arc", "Arcade", "#b47a7d"], ["soc", "Contenu et réseaux", "#7992a1"],
    ["app", "Design visuel", "#a87d98"]
  ];
  const categoryIds = new Set(CATEGORIES.map(([id]) => id));
  const durations = new Set([5, 15, 30, 60, 90]);
  const statuses = new Set(["inbox", "todo", "doing", "done", "archived"]);
  const MAX_TASKS = 500;
  let tray = null;
  let panel = null;
  let panelBoundsSaveTimer = null;
  let pinballWindow = null;
  let ambientProcess = null;
  let ambientRestartTimer = null;
  let ambientStatus = { status: "starting", message: "Démarrage du widget transparent…" };
  let tasksPath = "";
  let settingsPath = "";
  let tasks = [];
  let settings = { side: "right", opacity: 0.82, motion: "measured", fieldEnabled: true, startWithWindows: false, panelBounds: null, widgetPosition: null };
  let siteSync = { subjects: [], tasks: [], visual: null, savedAt: 0 };
  let quitting = false;
  let appReady = false;
  let secondInstancePending = false;
  let tasksRecoveryNeeded = false;
  let tasksLoadedFromBackup = false;
  let taskWriteQueue = Promise.resolve();
  let settingsWriteQueue = Promise.resolve();
  let siteSyncPath = "";
  let downloadsPoll = null;
  let latestDownloadStamp = 0;
  const lastNotices = new Map();

  const safeText = (value, max) => String(value == null ? "" : value).trim().slice(0, max);
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function cleanTask(value) {
    const source = value && typeof value === "object" ? value : {};
    const category = categoryIds.has(source.category) ? source.category : null;
    const status = statuses.has(source.status) ? source.status : (category ? "todo" : "inbox");
    return {
      id: /^[a-zA-Z0-9_-]{1,80}$/.test(String(source.id || "")) ? String(source.id) : crypto.randomUUID(),
      title: safeText(source.title, 180),
      category,
      status,
      minutes: durations.has(Number(source.minutes)) ? Number(source.minutes) : 15,
      priority: [1, 2, 3].includes(Number(source.priority)) ? Number(source.priority) : 2,
      doneWhen: safeText(source.doneWhen, 300),
      source: safeText(source.source || "personnelle", 30)
    };
  }

  function cleanTaskList(input) {
    if (!Array.isArray(input) || input.length > MAX_TASKS) throw new Error("La liste est invalide ou dépasse 500 tâches.");
    const seen = new Set();
    return input.map(cleanTask).filter((task) => {
      if (!task.title) return false;
      if (seen.has(task.id)) task.id = crypto.randomUUID();
      seen.add(task.id);
      return true;
    });
  }

  function cleanSettings(input) {
    const next = input && typeof input === "object" ? input : {};
    const bounds = next.panelBounds && typeof next.panelBounds === "object" ? next.panelBounds : null;
    const validBounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      ? {
        x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.max(320, Math.min(900, Math.round(bounds.width))),
        height: Math.max(440, Math.min(1200, Math.round(bounds.height)))
      } : null;
    const position = next.widgetPosition && typeof next.widgetPosition === "object" ? next.widgetPosition : null;
    const widgetPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: Math.max(0.07, Math.min(0.93, Number(position.x))), y: Math.max(0.09, Math.min(0.91, Number(position.y))) } : null;
    const rawWidgetView = next.widgetView && typeof next.widgetView === "object" ? next.widgetView : null;
    const bounded = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
    const widgetView = rawWidgetView ? {
      viewYaw: ((bounded(rawWidgetView.viewYaw, 0, Math.PI * 2, 0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
      viewPitch: bounded(rawWidgetView.viewPitch, -1.15, 1.15, 0),
      zoom: bounded(rawWidgetView.zoom, 0.65, 6, 1),
      zoomPan: {
        x: bounded(rawWidgetView.zoomPan?.x, -2.5, 2.5, 0),
        y: bounded(rawWidgetView.zoomPan?.y, -2.5, 2.5, 0)
      },
      focusTaskId: /^[a-zA-Z0-9_-]{1,80}$/.test(String(rawWidgetView.focusTaskId || "")) ? String(rawWidgetView.focusTaskId) : null
    } : null;
    return {
      side: next.side === "left" ? "left" : "right",
      opacity: Math.max(0.25, Math.min(1, Number(next.opacity) || 0.82)),
      motion: next.motion === "reduced" ? "reduced" : "measured",
      fieldEnabled: next.fieldEnabled !== false,
      startWithWindows: Boolean(next.startWithWindows),
      panelBounds: validBounds,
      widgetPosition,
      widgetView
    };
  }

  async function atomicWrite(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  function queueSettingsWrite() {
    const snapshot = JSON.stringify(settings, null, 2);
    const write = settingsWriteQueue.then(() => atomicWrite(settingsPath, snapshot));
    settingsWriteQueue = write.catch(() => {});
    return write;
  }

  function savePanelBoundsSoon() {
    if (!panel || panel.isDestroyed()) return;
    settings.panelBounds = panel.getBounds();
    if (panelBoundsSaveTimer) clearTimeout(panelBoundsSaveTimer);
    panelBoundsSaveTimer = setTimeout(() => {
      panelBoundsSaveTimer = null;
      queueSettingsWrite().catch((error) => console.error("Panel bounds save failed:", error.message));
    }, 220);
    panelBoundsSaveTimer.unref?.();
  }

  function savePanelBoundsNow() {
    if (panelBoundsSaveTimer) clearTimeout(panelBoundsSaveTimer);
    panelBoundsSaveTimer = null;
    if (!panel || panel.isDestroyed()) return;
    settings.panelBounds = panel.getBounds();
    queueSettingsWrite().catch((error) => console.error("Panel bounds save failed:", error.message));
  }

  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if (error && error.code === "ENOENT") return fallback; throw error; }
  }

  function cleanSiteSync(value) {
    if (!value || value.format !== "cockpittakeover-widget-sync" || value.version !== 1 || !Array.isArray(value.subjects) || !Array.isArray(value.tasks) || value.subjects.length > 24 || value.tasks.length > 500) {
      throw new Error("Le fichier ne correspond pas à une synchronisation Cockpit Takeover valide.");
    }
    const legacyColors = {
      "#b18b5e": "#42dcff", "#98856c": "#ff4fc8", "#858b91": "#a8ff4f", "#9a6f64": "#ffc94a", "#a49b81": "#8b79ff", "#887968": "#4bffd7",
      "#9bb7ac": "#42dcff", "#b89e79": "#ffb348", "#9eafc1": "#7aa7ff", "#c08f8b": "#ff4fc8", "#b7aa83": "#c6ff55", "#aa9bb7": "#ad7bff"
    };
    const cleanColor = (value, fallback) => /^#[0-9a-fA-F]{6}$/.test(value) ? (legacyColors[value.toLowerCase()] || value.toLowerCase()) : fallback;
    const subjects = value.subjects.map((entry) => {
      const item = entry && typeof entry === "object" ? entry : {};
      const id = safeText(item.id, 60);
      if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id)) throw new Error("Un sujet contient un identifiant invalide.");
      return {
        id, name: safeText(item.name, 48) || "Sujet sans nom", description: safeText(item.description, 260),
        color: cleanColor(item.color, "#42dcff"),
        size: Math.max(0.55, Math.min(1.65, Number(item.size) || 1)),
        durationMinutes: Math.max(5, Math.min(1440, Number(item.durationMinutes) || 25))
      };
    });
    const subjectIds = new Set(subjects.map((item) => item.id));
    const subjectById = new Map(subjects.map((item) => [item.id, item]));
    const tasks = value.tasks.map((entry) => {
      const item = entry && typeof entry === "object" ? entry : {};
      const legacySubject = subjectById.get(item.subjectId);
      const id = /^[a-zA-Z0-9_-]{1,80}$/.test(String(item.id || "")) ? String(item.id) : crypto.randomUUID();
      const duration = Number(item.durationMinutes);
      const startedAt = Number(item.startedAt);
      const createdAt = Number(item.createdAt);
      const hasDeadlineField = Object.prototype.hasOwnProperty.call(item, "deadlineAt");
      const rawDeadline = item.deadlineAt;
      const parsedDeadline = Number(rawDeadline) || (rawDeadline ? Date.parse(rawDeadline) : null);
      const deadlineAt = Number.isFinite(parsedDeadline) && parsedDeadline > 0 ? parsedDeadline : (hasDeadlineField ? null : startedAt > 0 ? startedAt + (Number.isFinite(duration) ? Math.max(5, Math.min(1440, duration)) : 25) * 60_000 : null);
      return {
        id, title: safeText(item.title, 180), description: safeText(item.description, 700),
        subjectId: subjectIds.has(item.subjectId) ? item.subjectId : null,
        topicName: safeText(item.topicName || legacySubject?.name, 48),
        planetColor: cleanColor(item.planetColor || item.color, legacySubject?.color || "#42dcff"),
        planetSize: Number.isFinite(Number(item.planetSize)) ? Math.max(0.55, Math.min(1.65, Number(item.planetSize))) : (legacySubject?.size || 1),
        ringCount: Math.round(Math.max(0, Math.min(20, Number(item.ringCount ?? 1) || 0))),
        ringsGlow: item.ringsGlow !== false,
        ringsRocky: Boolean(item.ringsRocky),
        status: ["queued", "active", "done", "archived"].includes(item.status) ? item.status : "queued",
        durationMinutes: Number.isFinite(duration) ? Math.max(5, Math.min(1440, duration)) : 25,
        deadlineAt,
        priority: [1, 2, 3].includes(Number(item.priority)) ? Number(item.priority) : 2,
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
        startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
        completedAt: Number.isFinite(Number(item.completedAt)) && Number(item.completedAt) > 0 ? Number(item.completedAt) : null,
        reason: safeText(item.reason, 300)
      };
    }).filter((item) => item.title);
    const raw = value.visual && typeof value.visual === "object" ? value.visual : {};
    const center = raw.center && typeof raw.center === "object" ? raw.center : {};
    const bounded = (number, low, high, fallback) => Number.isFinite(Number(number)) ? Math.max(low, Math.min(high, Number(number))) : fallback;
    const visual = {
      planetCount: Math.round(bounded(raw.planetCount, 1, 16, 8)),
      planetScale: bounded(raw.planetScale, 0.55, 1.65, 1),
      speed: bounded(raw.speed, 0.2, 1.8, 0.72),
      stars: Math.round(bounded(raw.stars, 12, 64, 30)),
      showOrbits: raw.showOrbits !== false,
      viewYaw: bounded(raw.viewYaw, 0, Math.PI * 2, 0),
      viewPitch: bounded(raw.viewPitch, -1.15, 1.15, 0),
      zoom: bounded(raw.zoom, 0.65, 6, 1),
      zoomPan: {
        x: bounded(raw.zoomPan?.x, -2.5, 2.5, 0),
        y: bounded(raw.zoomPan?.y, -2.5, 2.5, 0)
      },
      focusTaskId: /^[a-zA-Z0-9_-]{1,80}$/.test(String(raw.focusTaskId || "")) ? String(raw.focusTaskId) : null,
      coreColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.coreColor || "")) ? String(raw.coreColor).toLowerCase() : "#42dcff",
      coreCraters: ["none", "few", "many", "everest"].includes(raw.coreCraters) ? raw.coreCraters : "few",
      center: { x: bounded(center.x, 0.08, 0.92, 0.5), y: bounded(center.y, 0.1, 0.9, 0.53) }
    };
    return { subjects, tasks, visual, savedAt: Number(value.savedAt) || Date.now() };
  }

  function ambientSnapshot() {
    return {
      subjects: siteSync.subjects,
      tasks: siteSync.tasks,
      settings: { ...settings, visual: settings.widgetView ? { ...siteSync.visual, ...settings.widgetView } : siteSync.visual, widgetPosition: settings.widgetPosition || siteSync.visual?.center || null }
    };
  }

  function siteSyncStatus() {
    return { savedAt: siteSync.savedAt || 0, taskCount: siteSync.tasks.length, subjectCount: siteSync.subjects.length };
  }

  function broadcastSiteSyncStatus() {
    if (panel && !panel.isDestroyed() && !panel.webContents.isLoading()) panel.webContents.send("qg:site:sync-status", siteSyncStatus());
  }

  async function applySiteSync(value, stamp = 0) {
    const cleaned = cleanSiteSync(value);
    siteSync = cleaned;
    latestDownloadStamp = Math.max(latestDownloadStamp, stamp);
    await atomicWrite(siteSyncPath, JSON.stringify(siteSync, null, 2));
    sendAmbient("snapshot", ambientSnapshot());
    broadcastSiteSyncStatus();
  }

  async function pollSiteSync() {
    try {
      const folder = app.getPath("downloads");
      const names = await fs.readdir(folder);
      const candidates = names.filter((name) => /^CockpitTakeover-widget(?: \(\d+\))?\.json$/i.test(name));
      let newest = null;
      for (const name of candidates) {
        const file = path.join(folder, name);
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile() || stat.size > 1_000_000 || stat.mtimeMs <= latestDownloadStamp) continue;
        if (!newest || stat.mtimeMs > newest.stamp) newest = { file, stamp: stat.mtimeMs };
      }
      if (!newest) return;
      const parsed = JSON.parse(await fs.readFile(newest.file, "utf8"));
      await applySiteSync(parsed, newest.stamp);
      showShellNotice("Les rappels et réglages de Cockpit Takeover sont synchronisés avec le widget.");
    } catch (error) {
      if (error && error.code !== "ENOENT") console.error("Site sync scan failed:", error.message);
    }
  }

  function startSiteSyncWatcher() {
    pollSiteSync().catch((error) => console.error("Initial site sync scan failed:", error.message));
    downloadsPoll = setInterval(() => pollSiteSync(), 1800);
    downloadsPoll.unref?.();
  }

  function setAmbientStatus(status, message) {
    ambientStatus = { status, message };
    if (panel && !panel.isDestroyed() && !panel.webContents.isLoading()) panel.webContents.send("qg:ambient:status", ambientStatus);
  }

  function sendAmbient(type, payload) {
    if (!ambientProcess || !ambientProcess.connected) return false;
    try { ambientProcess.send({ type, payload }); return true; }
    catch (error) { console.error("Ambient host message failed:", error.message); return false; }
  }

  function requestAmbientRebuild() {
    if (!sendAmbient("rebuild")) startAmbientHost();
  }

  function restartAmbientHost() {
    if (!settings.fieldEnabled) return false;
    if (!ambientProcess || !ambientProcess.connected) {
      startAmbientHost();
      return true;
    }
    setAmbientStatus("starting", "Le widget redémarre sur le bureau…");
    try { ambientProcess.send({ type: "shutdown" }); return true; }
    catch (_) { ambientProcess.kill(); return true; }
  }

  function startAmbientHost() {
    if (quitting || !settings.fieldEnabled || ambientRestartTimer) return;
    if (ambientProcess && ambientProcess.exitCode === null && !ambientProcess.killed) {
      if (ambientProcess.connected) return;
      ambientProcess.kill();
      ambientProcess = null;
    }
    setAmbientStatus("starting", "Démarrage du widget transparent…");
    const profile = path.join(app.getPath("userData"), "Cockpit-Profile");
    const args = app.isPackaged ? ["--qg-ambient-host"] : [path.resolve(__dirname, ".."), "--qg-ambient-host"];
    let child;
    try {
      child = spawn(process.execPath, args, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, QG_AMBIENT_PROFILE: profile }
      });
    } catch (error) {
      setAmbientStatus("unavailable", "Le widget n’a pas pu démarrer.");
      showShellNotice(`La couche de fond n’a pas démarré : ${error.message}`);
      return;
    }
    ambientProcess = child;
    child.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "status" && message.payload) setAmbientStatus(message.payload.status, message.payload.message);
      if (message.type === "widget-position" && message.payload && Number.isFinite(message.payload.x) && Number.isFinite(message.payload.y)) {
        settings = cleanSettings({ ...settings, widgetPosition: message.payload });
        queueSettingsWrite().catch((error) => console.error("Widget position save failed:", error.message));
        syncViews();
      }
      if (message.type === "widget-view" && message.payload && typeof message.payload === "object") {
        settings = cleanSettings({ ...settings, widgetView: message.payload });
        queueSettingsWrite().catch((error) => console.error("Widget view save failed:", error.message));
        syncViews();
      }
      if (message.type === "pinball") openPinballWindow();
      if (message.type === "shell-unavailable" || message.type === "attach-error" || message.type === "shell-error") {
        setAmbientStatus("unavailable", message.message || "La couche Windows reste masquée pour protéger vos icônes.");
        showShellNotice(message.message || "La couche de fond Windows reste masquée pour protéger vos icônes.");
      }
      if (message.type === "ready") sendAmbient("snapshot", ambientSnapshot());
    });
    child.on("error", (error) => { setAmbientStatus("unavailable", "Le widget transparent s’est arrêté."); showShellNotice(`La couche de fond s’est arrêtée : ${error.message}`); });
    child.on("close", () => {
      if (ambientProcess === child) ambientProcess = null;
      if (quitting || !settings.fieldEnabled) return;
      setAmbientStatus("starting", "Redémarrage du widget transparent…");
      showShellNotice("La couche de fond redémarre; le plan de travail reste disponible.");
      ambientRestartTimer = setTimeout(() => { ambientRestartTimer = null; startAmbientHost(); }, 2200);
      ambientRestartTimer.unref?.();
    });
    child.once("spawn", () => sendAmbient("snapshot", ambientSnapshot()));
  }

  function stopAmbientHost() {
    setAmbientStatus("hidden", "Le widget transparent est masqué.");
    if (!ambientProcess) return;
    const child = ambientProcess;
    ambientProcess = null;
    if (child.connected) {
      try { child.send({ type: "shutdown" }); child.disconnect(); }
      catch (_) { child.kill(); }
    } else child.kill();
  }

  function showShellNotice(body) {
    if (!tray) return;
    const now = Date.now();
    if (now - (lastNotices.get(body) || 0) < 900_000) return;
    lastNotices.set(body, now);
    tray.displayBalloon({ title: "DumbFuckCockpit Widget", content: body, iconType: "info" });
  }

  function publicTasks() {
    return tasks.map(({ id, title, category, status, minutes, priority, doneWhen }) => ({ id, title, category, status, minutes, priority, doneWhen }));
  }

  function taskSummary() {
    const active = tasks.filter((task) => task.status !== "done" && task.status !== "archived");
    return {
      total: active.length,
      inbox: active.filter((task) => !task.category || task.status === "inbox").length,
      doing: active.filter((task) => task.status === "doing").length,
      completed: tasks.filter((task) => task.status === "done").length
    };
  }

  function syncViews() {
    if (panel && !panel.isDestroyed()) panel.webContents.send("qg:tasks:snapshot", { tasks: publicTasks(), summary: taskSummary(), blocked: tasksRecoveryNeeded });
    sendAmbient("snapshot", ambientSnapshot());
  }

  function placePanel() {
    if (!panel || panel.isDestroyed()) return;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const saved = settings.panelBounds;
    const maxWidth = Math.max(240, area.width - 24);
    const maxHeight = Math.max(320, area.height - 24);
    const width = Math.max(Math.min(360, maxWidth), Math.min(saved?.width || 420, maxWidth));
    const height = Math.max(Math.min(480, maxHeight), Math.min(saved?.height || 740, maxHeight));
    let x = saved ? saved.x : (settings.side === "left" ? area.x + 16 : area.x + area.width - width - 16);
    let y = saved ? saved.y : area.y + Math.max(12, Math.round((area.height - height) / 2));
    x = Math.max(area.x + 8, Math.min(x, area.x + area.width - width - 8));
    y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8));
    panel.setBounds({ x, y, width, height });
  }

  function openPanel() {
    const showPreferences = arguments[0] === true;
    if (!panel || panel.isDestroyed()) createPanel();
    const target = panel;
    placePanel();
    target.show();
    target.focus();
    const sendPanelState = () => {
      if (!target || target.isDestroyed()) return;
      target.webContents.send("qg:tasks:snapshot", { tasks: publicTasks(), summary: taskSummary(), blocked: tasksRecoveryNeeded });
      target.webContents.send("qg:ambient:status", ambientStatus);
      target.webContents.send("qg:site:sync-status", siteSyncStatus());
      if (showPreferences) target.webContents.send("qg:settings:open");
    };
    if (target.webContents.isLoading()) target.webContents.once("did-finish-load", sendPanelState);
    else sendPanelState();
  }

  function createPanel() {
    panel = new BrowserWindow({
      width: 420, height: 740, show: false, frame: false, transparent: true,
      backgroundColor: "#00000000", resizable: false, movable: true, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: true,
      alwaysOnTop: true, icon: path.join(__dirname, "../assets/qg.ico"),
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"), contextIsolation: true,
        nodeIntegration: false, sandbox: true, backgroundThrottling: true
      }
    });
    panel.setAlwaysOnTop(true, "floating");
    panel.loadFile(path.join(__dirname, "panel.html"));
    panel.on("moved", () => {
      savePanelBoundsSoon();
    });
    panel.on("resize", () => {
      savePanelBoundsSoon();
    });
    panel.on("closed", () => { panel = null; });
  }

  async function persistTasks(next) {
    if (tasksRecoveryNeeded) throw new Error("Le fichier de tâches semble endommagé. Il reste intact; les modifications sont bloquées pour éviter de l’écraser.");
    const cleaned = cleanTaskList(next);
    const snapshot = JSON.stringify({ format: "qg-personal-tasks", version: 2, tasks: cleaned }, null, 2);
    const write = taskWriteQueue.then(async () => {
      if (!tasksLoadedFromBackup) {
        try { await atomicWrite(`${tasksPath}.previous`, await fs.readFile(tasksPath, "utf8")); }
        catch (error) { if (!error || error.code !== "ENOENT") throw error; }
      }
      await atomicWrite(tasksPath, snapshot);
      tasksLoadedFromBackup = false;
    });
    taskWriteQueue = write.catch(() => {});
    await write;
    tasks = cleaned;
    syncViews();
    return { ok: true, summary: taskSummary() };
  }

  async function configureIpc() {
    ipcMain.handle("qg:tasks:read", () => ({ tasks: publicTasks(), summary: taskSummary(), blocked: tasksRecoveryNeeded }));
    ipcMain.handle("qg:tasks:save", async (_event, next) => persistTasks(next));
    ipcMain.handle("qg:tasks:choose-import", async () => {
      const result = await dialog.showOpenDialog(panel, {
        title: "Importer une liste sans la réécrire",
        properties: ["openFile"],
        filters: [{ name: "Tâches DumbFuckCockpit", extensions: ["txt", "md", "markdown", "json"] }]
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const selected = result.filePaths[0];
      const stat = await fs.stat(selected);
      if (stat.size > 2_000_000) throw new Error("Le fichier dépasse la limite de 2 Mo.");
      return { name: path.basename(selected), text: await fs.readFile(selected, "utf8") };
    });
    ipcMain.handle("qg:tasks:export", async (_event, next) => {
      const safe = cleanTaskList(next);
      const result = await dialog.showSaveDialog(panel, {
        title: "Exporter une copie de vos tâches DumbFuckCockpit",
        defaultPath: "DumbFuckCockpit-taches.json",
        filters: [{ name: "Sauvegarde de tâches DumbFuckCockpit", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      await atomicWrite(result.filePath, JSON.stringify({ format: "qg-personal-tasks", version: 2, tasks: safe }, null, 2));
      return { ok: true, fileName: path.basename(result.filePath) };
    });
    ipcMain.handle("qg:settings:read", () => settings);
    ipcMain.handle("qg:ambient:status", () => ambientStatus);
    ipcMain.handle("qg:site:sync-status", () => siteSyncStatus());
    ipcMain.handle("qg:ambient:restart", () => ({ ok: restartAmbientHost(), enabled: settings.fieldEnabled }));
    ipcMain.handle("qg:settings:center-reset", async () => {
      settings = cleanSettings({
        ...settings,
        widgetPosition: { x: 0.5, y: 0.53 },
        widgetView: { viewYaw: 0, viewPitch: 0, zoom: 1, zoomPan: { x: 0, y: 0 }, focusTaskId: null }
      });
      await queueSettingsWrite();
      syncViews();
      return settings.widgetPosition;
    });
    ipcMain.handle("qg:settings:save", async (_event, next) => {
      const previous = settings;
      settings = cleanSettings({ ...settings, ...next });
      try { await queueSettingsWrite(); }
      catch (error) { settings = previous; throw error; }
      app.setLoginItemSettings({ openAtLogin: settings.startWithWindows });
      syncViews();
      if (settings.fieldEnabled) startAmbientHost(); else stopAmbientHost();
      return settings;
    });
    ipcMain.handle("qg:site:open", () => shell.openExternal("https://ceomelyxja.github.io/CockpitTakeover/"));
    ipcMain.handle("qg:panel:close", () => { if (panel && !panel.isDestroyed()) panel.hide(); });
    ipcMain.handle("qg:panel:bounds", () => panel && !panel.isDestroyed() ? panel.getBounds() : null);
    ipcMain.on("qg:panel:resize", (event, request) => {
      if (!panel || panel.isDestroyed() || event.sender !== panel.webContents || !request || !Number.isFinite(request.width) || !Number.isFinite(request.height)) return;
      const current = panel.getBounds();
      const area = screen.getDisplayMatching(current).workArea;
      const maxWidth = Math.max(240, area.width - 16);
      const maxHeight = Math.max(320, area.height - 16);
      const minWidth = Math.min(360, maxWidth);
      const minHeight = Math.min(480, maxHeight);
      const width = Math.round(Math.max(minWidth, Math.min(maxWidth, request.width)));
      const height = Math.round(Math.max(minHeight, Math.min(maxHeight, request.height)));
      const maxX = area.x + area.width - width - 8;
      const maxY = area.y + area.height - height - 8;
      const x = Math.max(area.x + 8, Math.min(current.x, maxX));
      const bottom = current.y + current.height;
      const y = Math.max(area.y + 8, Math.min(bottom - height, maxY));
      panel.setBounds({ x, y, width, height });
      settings.panelBounds = panel.getBounds();
      if (request.final) savePanelBoundsNow();
    });
  }

  function trayMenu() {
    const menu = Menu.buildFromTemplate([
      { label: "Réglages du widget DumbFuckCockpit", click: openPanel },
      { label: "Réglages du widget", click: () => openPanel(true) },
      { label: settings.fieldEnabled ? "Masquer le widget transparent" : "Afficher le widget transparent", click: toggleAmbientField },
      { label: "Recréer le widget du bureau", enabled: settings.fieldEnabled, click: requestAmbientRebuild },
      { type: "separator" },
      { label: "Ouvrir le cockpit web", click: () => shell.openExternal("https://ceomelyxja.github.io/CockpitTakeover/") },
      { type: "separator" },
      { label: "Quitter DumbFuckCockpit Widget", click: () => { quitting = true; app.quit(); } }
    ]);
    if (tray) tray.setContextMenu(menu);
  }

  async function toggleAmbientField() {
    const previous = settings.fieldEnabled;
    settings.fieldEnabled = !settings.fieldEnabled;
    try { await queueSettingsWrite(); }
    catch (error) {
      settings.fieldEnabled = previous;
      showShellNotice(`Les préférences n’ont pas pu être enregistrées : ${error.message}`);
      return;
    }
    trayMenu();
    syncViews();
    if (settings.fieldEnabled) startAmbientHost(); else stopAmbientHost();
  }

  function createTray() {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "../assets/tray.png")));
    tray.setToolTip("DumbFuckCockpit Widget · Ctrl+Alt+Espace");
    tray.on("double-click", openPanel);
    trayMenu();
  }

  function openPinballWindow() {
    if (pinballWindow && !pinballWindow.isDestroyed()) {
      pinballWindow.show(); pinballWindow.focus();
      return;
    }
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(390, area.width - 24);
    const height = Math.min(670, area.height - 24);
    pinballWindow = new BrowserWindow({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width, height, show: false, frame: false, transparent: true,
      backgroundColor: "#00000000", resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: true, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, "pinball-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    pinballWindow.setAlwaysOnTop(true, "floating");
    const entry = app.isPackaged ? path.join(process.resourcesPath, "widget", "pinball.html") : path.resolve(__dirname, "../../pinball.html");
    pinballWindow.loadFile(entry);
    pinballWindow.once("ready-to-show", () => { if (pinballWindow && !pinballWindow.isDestroyed()) { pinballWindow.show(); pinballWindow.focus(); } });
    pinballWindow.on("closed", () => { pinballWindow = null; });
  }

  ipcMain.on("qg:pinball-close", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && senderWindow === pinballWindow) senderWindow.close();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("ca.ceomelyxja.qgdesktop");
    const storeRoot = path.join(app.getPath("userData"), "qg");
    tasksPath = path.join(storeRoot, "tasks.json");
    settingsPath = path.join(storeRoot, "settings.json");
    siteSyncPath = path.join(storeRoot, "cockpit-takeover-sync.json");
    try {
      const raw = await readJson(tasksPath, { tasks: [] });
      if (!raw || !Array.isArray(raw.tasks)) throw new Error("Le format local de la liste n’est pas reconnu.");
      tasks = cleanTaskList(raw.tasks);
    } catch (error) {
      try {
        const previous = await readJson(`${tasksPath}.previous`, null);
        if (!previous || !Array.isArray(previous.tasks)) throw error;
        tasks = cleanTaskList(previous.tasks);
        tasksLoadedFromBackup = true;
        showShellNotice("Une copie locale précédente a été reprise; le fichier original reste conservé.");
      } catch (_) {
        tasksRecoveryNeeded = true;
        showShellNotice("Le fichier de tâches ne peut pas être lu. DumbFuckCockpit le conserve sans l’écraser.");
        tasks = [];
      }
    }
    try { settings = cleanSettings(await readJson(settingsPath, settings)); }
    catch (error) { showShellNotice(`Les préférences n’ont pas pu être lues : ${error.message}`); }
    try {
      const savedSync = await readJson(siteSyncPath, null);
      if (savedSync) siteSync = cleanSiteSync(savedSync);
    } catch (error) { showShellNotice(`La dernière synchronisation du site n’a pas pu être lue : ${error.message}`); }
    app.setLoginItemSettings({ openAtLogin: settings.startWithWindows });
    await configureIpc();
    createTray();
    startSiteSyncWatcher();
    if (settings.fieldEnabled) startAmbientHost(); else setAmbientStatus("hidden", "Widget transparent désactivé dans les préférences.");
    if (!globalShortcut.register("Control+Alt+Space", openPanel)) showShellNotice("Le raccourci Ctrl+Alt+Espace est déjà utilisé par une autre application.");
    globalShortcut.register("Control+Alt+Shift+Space", requestAmbientRebuild);
    app.on("activate", openPanel);
    appReady = true;
    // Start directly on the desktop layer. The settings panel is opened only
    // on demand from the tray or the keyboard shortcut.
    if (secondInstancePending) openPanel();
  });

  app.on("before-quit", () => {
    quitting = true;
    if (ambientRestartTimer) clearTimeout(ambientRestartTimer);
    if (ambientProcess && ambientProcess.connected) {
      try { ambientProcess.send({ type: "shutdown" }); ambientProcess.disconnect(); }
      catch (_) { ambientProcess.kill(); }
    }
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {});
  app.on("browser-window-created", (_event, window) => {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("file:")) event.preventDefault();
    });
  });
  }
}

