"use strict";

(() => {
  const STORAGE_KEY = "cockpit-takeover-v1";
  const SYNC_FORMAT = "cockpittakeover-widget-sync";
  const TAU = Math.PI * 2;
  const DESKTOP_WIDGET = new URLSearchParams(location.search).get("desktopWidget") === "1";
  const byId = (id) => document.getElementById(id);
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const makeId = () => window.crypto?.randomUUID ? crypto.randomUUID() : `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const now = () => Date.now();
  const LEGACY_COLORS = {
    "#b18b5e": "#42dcff", "#98856c": "#ff4fc8", "#858b91": "#a8ff4f", "#9a6f64": "#ffc94a", "#a49b81": "#8b79ff", "#887968": "#4bffd7",
    "#9bb7ac": "#42dcff", "#b89e79": "#ffb348", "#9eafc1": "#7aa7ff", "#c08f8b": "#ff4fc8", "#b7aa83": "#c6ff55", "#aa9bb7": "#ad7bff"
  };
  const NEON_COLORS = ["#42dcff", "#ff4fc8", "#a8ff4f", "#ffc94a", "#8b79ff", "#4bffd7", "#ff784f", "#4d8dff"];
  const DEFAULT_SUBJECTS = [
    { id: "work", name: "Travail", description: "", color: "#42dcff", size: 1, durationMinutes: 35 },
    { id: "home", name: "Maison", description: "", color: "#ffb348", size: 1, durationMinutes: 25 },
    { id: "care", name: "Bien-être", description: "", color: "#7aa7ff", size: 1, durationMinutes: 20 },
    { id: "create", name: "Création", description: "", color: "#ff4fc8", size: 1, durationMinutes: 40 },
    { id: "admin", name: "Administration", description: "", color: "#c6ff55", size: 1, durationMinutes: 20 },
    { id: "personal", name: "Personnel", description: "", color: "#ad7bff", size: 1, durationMinutes: 25 }
  ];
  const DEFAULT_VISUAL = { planetCount: 8, planetScale: 1, speed: 0.72, stars: 30, showOrbits: true, center: { x: 0.5, y: 0.53 }, viewYaw: 0, viewPitch: 0, zoom: 1, coreColor: "#42dcff", coreCraters: "few" };
  const DEFAULT_STATE = { version: 1, view: "tasks", taskFilter: "open", panelCollapsed: false, panelPosition: null, subjects: DEFAULT_SUBJECTS.map((item) => ({ ...item })), tasks: [], visual: structuredClone(DEFAULT_VISUAL), lastSync: 0 };

  function cleanSubject(value) {
    const input = value && typeof value === "object" ? value : {};
    return {
      id: /^[a-zA-Z0-9_-]{1,60}$/.test(String(input.id || "")) ? String(input.id) : makeId(),
      name: String(input.name || "Sujet sans nom").trim().slice(0, 48) || "Sujet sans nom",
      description: String(input.description || "").trim().slice(0, 260),
      color: /^#[0-9a-fA-F]{6}$/.test(input.color) ? (LEGACY_COLORS[input.color.toLowerCase()] || input.color) : "#42dcff",
      size: clamp(input.size ?? 1, 0.55, 1.65),
      durationMinutes: clamp(input.durationMinutes ?? 25, 5, 1440)
    };
  }

  function cleanTask(value, subjects) {
    const input = value && typeof value === "object" ? value : {};
    const legacySubject = subjects.find((subject) => subject.id === input.subjectId) || null;
    const validSubject = legacySubject ? legacySubject.id : null;
    const status = ["queued", "active", "done", "archived"].includes(input.status) ? input.status : "queued";
    const number = (item) => Number.isFinite(Number(item)) ? Number(item) : null;
    const createdAt = number(input.createdAt) || now();
    const startedAt = number(input.startedAt);
    const durationMinutes = clamp(input.durationMinutes ?? input.minutes ?? 25, 5, 1440);
    const rawDeadline = input.deadlineAt;
    const parsedDeadline = number(rawDeadline) || (rawDeadline ? Date.parse(rawDeadline) : null);
    const hasDeadlineField = Object.prototype.hasOwnProperty.call(input, "deadlineAt");
    const deadlineAt = Number.isFinite(parsedDeadline) && parsedDeadline > 0 ? parsedDeadline : (hasDeadlineField ? null : startedAt ? startedAt + durationMinutes * 60_000 : null);
    const rawColor = /^#[0-9a-fA-F]{6}$/.test(input.planetColor || input.color) ? String(input.planetColor || input.color).toLowerCase() : legacySubject?.color?.toLowerCase();
    return {
      id: /^[a-zA-Z0-9_-]{1,80}$/.test(String(input.id || "")) ? String(input.id) : makeId(),
      title: String(input.title || "").trim().slice(0, 180),
      description: String(input.description || input.doneWhen || "").trim().slice(0, 700),
      subjectId: validSubject,
      topicName: String(input.topicName || input.categoryName || legacySubject?.name || "").trim().slice(0, 48),
      planetColor: rawColor ? (LEGACY_COLORS[rawColor] || rawColor) : legacySubject?.color || "#42dcff",
      planetSize: clamp(input.planetSize ?? legacySubject?.size ?? 1, 0.55, 1.65),
      ringCount: Math.round(clamp(input.ringCount ?? 1, 0, 20)),
      ringsGlow: input.ringsGlow !== false,
      ringsRocky: Boolean(input.ringsRocky),
      status,
      durationMinutes,
      deadlineAt,
      priority: [1, 2, 3].includes(Number(input.priority)) ? Number(input.priority) : 2,
      createdAt,
      startedAt,
      completedAt: number(input.completedAt),
      reason: String(input.reason || "").trim().slice(0, 300)
    };
  }

  function cleanVisual(input) {
    const source = input && typeof input === "object" ? input : {};
    const center = source.center && typeof source.center === "object" ? source.center : {};
    return {
      planetCount: Math.round(clamp(source.planetCount ?? DEFAULT_VISUAL.planetCount, 1, 16)),
      planetScale: clamp(source.planetScale ?? DEFAULT_VISUAL.planetScale, 0.55, 1.65),
      speed: clamp(source.speed ?? DEFAULT_VISUAL.speed, 0.2, 1.8),
      stars: Math.round(clamp(source.stars ?? DEFAULT_VISUAL.stars, 12, 64)),
      showOrbits: source.showOrbits !== false,
      center: { x: clamp(center.x ?? 0.5, 0.08, 0.92), y: clamp(center.y ?? 0.53, 0.1, 0.9) },
      viewYaw: ((Number(source.viewYaw) || 0) % TAU + TAU) % TAU,
      viewPitch: clamp(source.viewPitch ?? 0, -1.15, 1.15),
      zoom: clamp(source.zoom ?? 1, 0.65, 2.25),
      coreColor: /^#[0-9a-fA-F]{6}$/.test(String(source.coreColor || "")) ? String(source.coreColor).toLowerCase() : DEFAULT_VISUAL.coreColor,
      coreCraters: ["none", "few", "many", "everest"].includes(source.coreCraters) ? source.coreCraters : DEFAULT_VISUAL.coreCraters
    };
  }

  function cleanPanelPosition(value) {
    if (!value || typeof value !== "object" || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
    return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || raw.version !== 1 || !Array.isArray(raw.subjects) || !Array.isArray(raw.tasks)) return structuredClone(DEFAULT_STATE);
      const subjects = raw.subjects.slice(0, 24).map(cleanSubject);
      const seen = new Set();
      const uniqueSubjects = subjects.filter((subject) => { if (seen.has(subject.id)) subject.id = makeId(); seen.add(subject.id); return true; });
      const tasks = raw.tasks.slice(0, 500).map((task) => cleanTask(task, uniqueSubjects)).filter((task) => task.title);
      return { ...structuredClone(DEFAULT_STATE), view: raw.view === "settings" ? "settings" : "tasks", taskFilter: ["open", "elapsed", "done", "all"].includes(raw.taskFilter) ? raw.taskFilter : "open", panelCollapsed: Boolean(raw.panelCollapsed), panelPosition: cleanPanelPosition(raw.panelPosition), subjects: uniqueSubjects, tasks, visual: cleanVisual(raw.visual), lastSync: Number(raw.lastSync) || 0 };
    } catch (_) { return structuredClone(DEFAULT_STATE); }
  }

  let data = loadState();
  let toastTimer = 0;
  let pendingImport = [];
  let importDialog = null;
  let inputCapture = false;
  let draggingCore = false;
  let dragPointerId = null;
  let viewDrag = null;
  let touchGesture = null;
  let coreCurrent = { ...data.visual.center };
  let coreTarget = { ...data.visual.center };
  let coreHit = { x: 0, y: 0, radius: 0 };
  let width = 1, height = 1, ratio = 1, lastDraw = 0, lastPositionSent = 0;
  let panelDrag = null;
  let currentTasksSnapshot = [];
  let motionPreference = "measured";
  const canvas = byId("universeCanvas");
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  let stars = [];
  let starLayer = null;
  let starAnchor = { x: 0, y: 0 };

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (_) { showToast("Le navigateur n’a pas pu enregistrer les réglages."); }
  }

  function showToast(message) {
    const element = byId("toast");
    if (!element || DESKTOP_WIDGET) return;
    element.textContent = message;
    element.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3000);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function subjectById(id) { return data.subjects.find((subject) => subject.id === id) || null; }
  function taskPhase(task, timestamp = now()) {
    if (task.status === "done") return "done";
    if (task.status === "archived") return "archived";
    const deadline = taskDeadline(task);
    if (deadline && timestamp >= deadline) return "elapsed";
    if (task.status !== "active" || !task.startedAt) return "queued";
    return "running";
  }
  function taskDeadline(task) { return Number(task.deadlineAt) > 0 ? Number(task.deadlineAt) : null; }
  function taskWindow(task) { const deadline = taskDeadline(task); return deadline ? Math.max(1, deadline - (task.startedAt || task.createdAt || now())) : Math.max(1, Number(task.durationMinutes || 25) * 60_000); }
  function taskProgress(task, timestamp = now()) { return taskDeadline(task) ? clamp((timestamp - (task.startedAt || task.createdAt || timestamp)) / taskWindow(task), 0, 1) : 0; }
  function formatClock(timestamp) { return new Intl.DateTimeFormat("fr-CA", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)); }
  function formatDueDate(timestamp) { return timestamp ? new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)) : "À définir"; }
  function toDateTimeLocal(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function formatRemaining(milliseconds) {
    const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60), remainder = minutes % 60;
    return remainder ? `${hours} h ${String(remainder).padStart(2, "0")}` : `${hours} h`;
  }
  function timeLabel(task, timestamp = now()) {
    const phase = taskPhase(task, timestamp);
    if (phase === "queued") return taskDeadline(task) ? "En attente" : "Sans échéance";
    if (phase === "done") return "Terminée";
    if (phase === "archived") return "Archivée";
    if (phase === "elapsed") return "Échéance dépassée";
    if (!taskDeadline(task)) return "Sans échéance";
    return `Dans ${formatRemaining(taskDeadline(task) - timestamp)}`;
  }
  function sortedOpenTasks() {
    return data.tasks.filter((task) => !["done", "archived"].includes(task.status)).sort((a, b) => {
      const phaseA = taskPhase(a), phaseB = taskPhase(b);
      if (phaseA !== phaseB) return phaseA === "elapsed" ? 1 : phaseB === "elapsed" ? -1 : 0;
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return (b.priority || 0) - (a.priority || 0) || a.createdAt - b.createdAt;
    });
  }

  function render() {
    if (DESKTOP_WIDGET) return;
    const isSettings = data.view === "settings";
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === data.view));
    byId("controlPanel").classList.toggle("is-collapsed", data.panelCollapsed);
    byId("panelClose").textContent = data.panelCollapsed ? "⌄" : "⌃";
    byId("panelClose").setAttribute("aria-label", data.panelCollapsed ? "Rouvrir le panneau" : "Réduire le panneau");
    byId("panelKicker").textContent = isSettings ? "PERSONNALISATION" : "ESPACE ORBITAL";
    byId("panelTitle").textContent = isSettings ? "Réglages de la carte" : "Mes planètes";
    byId("panelContent").innerHTML = isSettings ? renderSettingsView() : renderTasksView();
    applyPanelPosition();
    updateHeader();
  }

  function applyPanelPosition() {
    const panel = byId("controlPanel");
    if (!panel) return;
    const viewportWidth = Math.max(1, window.innerWidth), viewportHeight = Math.max(1, window.innerHeight);
    const insetX = Math.min(0.48, (panel.offsetWidth / 2 + 10) / viewportWidth);
    const insetY = Math.min(0.48, (panel.offsetHeight / 2 + 10) / viewportHeight);
    const desired = cleanPanelPosition(data.panelPosition) || { x: 0.5, y: 0.5 };
    const position = { x: clamp(desired.x, insetX, 1 - insetX), y: clamp(desired.y, insetY, 1 - insetY) };
    panel.style.setProperty("--panel-center-x", `${position.x * 100}%`);
    panel.style.setProperty("--panel-center-y", `${position.y * 100}%`);
  }

  function movePanel(event) {
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    const panel = byId("controlPanel");
    const x = panelDrag.x + (event.clientX - panelDrag.pointerX) / Math.max(1, window.innerWidth);
    const y = panelDrag.y + (event.clientY - panelDrag.pointerY) / Math.max(1, window.innerHeight);
    data.panelPosition = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    applyPanelPosition();
    event.preventDefault();
  }

  function finishPanelDrag(event) {
    if (!panelDrag || (event && event.pointerId !== panelDrag.pointerId)) return;
    panelDrag = null;
    save();
  }

  function renderTasksView() {
    const filter = data.taskFilter;
    const filtered = data.tasks.filter((task) => {
      const phase = taskPhase(task);
      if (filter === "open") return !["done", "archived"].includes(task.status);
      if (filter === "elapsed") return phase === "elapsed";
      if (filter === "done") return task.status === "done";
      return true;
    }).sort((a, b) => (taskDeadline(a) || Infinity) - (taskDeadline(b) || Infinity));
    const defaultDeadline = toDateTimeLocal(now() + 60 * 60_000);
    const newColor = NEON_COLORS[data.tasks.length % NEON_COLORS.length];
    const orbitCount = Math.min(data.visual.planetCount, data.tasks.filter((task) => !["done", "archived"].includes(task.status) && taskPhase(task) !== "elapsed").length);
    return `<section class="panel-section new-planet-section"><div class="section-heading-row"><h3 class="section-title">Nouvelle planète</h3><span class="section-count">${orbitCount} en orbite</span></div><form id="taskForm" class="form-grid"><label class="field wide">Qu’est-ce que vous voulez garder en vue ?<input name="title" maxlength="180" required placeholder="Appeler Alex, remettre un projet, faire une commission…"></label><label class="field wide">Contexte, prochaine étape ou résultat souhaité<textarea name="description" maxlength="700" placeholder="Une personne, une activité, une idée, un rendez-vous, un problème à régler…"></textarea></label><label class="field">Repère facultatif<input name="topicName" maxlength="48" placeholder="Projet, personne, lieu…"></label><label class="field">Échéance — date et heure<input name="deadlineAt" type="datetime-local" value="${defaultDeadline}" required></label><label class="field planet-color-field">Couleur<input name="planetColor" type="color" value="${newColor}"></label><label class="field planet-size-field">Taille <span class="field-value" data-new-size-output>100%</span><input name="planetSize" type="range" min="0.55" max="1.65" step="0.05" value="1"></label><details class="visual-options wide"><summary>Anneaux et effet électroluminescent</summary><div class="form-grid visual-option-fields"><label class="field">Nombre d’anneaux<input name="ringCount" type="number" min="0" max="20" value="1"></label><label class="field inline-choice"><span>Anneaux lumineux</span><input name="ringsGlow" type="checkbox" checked></label><label class="field inline-choice"><span>Anneaux rocheux</span><input name="ringsRocky" type="checkbox"></label></div></details><label class="field wide start-option"><span class="inline-row"><input name="startNow" type="checkbox" checked><span>Démarrer le décompte dès son ajout</span></span></label><button class="primary-button wide" type="submit">＋ Ajouter à ma carte</button></form><button class="file-label import-button" type="button" data-action="import-file">Importer une liste .txt, .md ou .json</button></section><section class="panel-section planet-list-section"><div class="list-heading"><h3 class="section-title">Planètes <small>${data.tasks.length}</small></h3><label class="filter-select-label">Afficher<select data-task-filter><option value="open" ${filter === "open" ? "selected" : ""}>À traiter</option><option value="elapsed" ${filter === "elapsed" ? "selected" : ""}>Échéance dépassée</option><option value="done" ${filter === "done" ? "selected" : ""}>Terminées</option><option value="all" ${filter === "all" ? "selected" : ""}>Toutes</option></select></label></div>${filtered.map(taskCard).join("") || `<div class="empty-card"><b>Votre carte est prête</b>Ajoutez-y une idée, un rendez-vous, un appel, un projet ou toute autre chose que vous voulez garder en vue.</div>`}</section>`;
  }

  function taskCard(task) {
    const legacy = subjectById(task.subjectId);
    const phase = taskPhase(task);
    const elapsed = phase === "elapsed";
    const done = phase === "done" || phase === "archived";
    const color = task.planetColor || legacy?.color || "#42dcff";
    const note = elapsed ? `Cette échéance est passée (${formatDueDate(taskDeadline(task))}). Le rappel demeure ouvert.` : task.description;
    const action = elapsed ? `<button class="small-button primary" data-action="restart-task" data-id="${escapeHtml(task.id)}">Replanifier</button>` : task.status === "queued" ? `<button class="small-button primary" data-action="start-task" data-id="${escapeHtml(task.id)}">Démarrer</button>` : task.status === "active" ? `<button class="small-button" data-action="complete-task" data-id="${escapeHtml(task.id)}">Terminer</button>` : `<button class="small-button" data-action="restore-task" data-id="${escapeHtml(task.id)}">Rouvrir</button>`;
    const deadline = taskDeadline(task);
    return `<article class="planet-card ${elapsed ? "is-elapsed" : ""} ${done ? "is-done" : ""}" data-planet-card="${escapeHtml(task.id)}"><div class="planet-card-head"><span class="planet-swatch" style="--planet-color:${color}"></span><div class="planet-card-name"><h4>${escapeHtml(task.title)}</h4><span>${escapeHtml(task.topicName || "Planète")}</span></div><span class="planet-timer">${escapeHtml(timeLabel(task))}</span></div><div class="planet-card-meta"><span class="deadline-label">${deadline ? `Échéance · ${escapeHtml(formatDueDate(deadline))}` : "Échéance à définir"}</span></div>${note ? `<p class="planet-note">${escapeHtml(note)}</p>` : ""}${elapsed ? `<label class="field planet-reason-field">Note pour reprendre plus facilement<textarea data-task-field="reason" data-id="${escapeHtml(task.id)}" maxlength="300" placeholder="Qu’est-ce qui reste à faire ?">${escapeHtml(task.reason)}</textarea></label>` : ""}<div class="planet-actions">${action}<button class="small-button archive-button" data-action="archive-task" data-id="${escapeHtml(task.id)}">Archiver</button></div><details class="planet-editor"><summary>Modifier cette planète</summary><div class="form-grid planet-editor-fields"><label class="field wide">Nom<input data-task-field="title" data-id="${escapeHtml(task.id)}" maxlength="180" value="${escapeHtml(task.title)}"></label><label class="field">Repère facultatif<input data-task-field="topicName" data-id="${escapeHtml(task.id)}" maxlength="48" value="${escapeHtml(task.topicName || "")}" placeholder="Projet, personne, lieu…"></label><label class="field">Échéance — date et heure<input data-task-field="deadlineAt" data-id="${escapeHtml(task.id)}" type="datetime-local" value="${deadline ? toDateTimeLocal(deadline) : ""}"></label><label class="field planet-color-field">Couleur<input data-task-field="planetColor" data-id="${escapeHtml(task.id)}" type="color" value="${color}"></label><label class="field planet-size-field">Taille<input data-task-field="planetSize" data-id="${escapeHtml(task.id)}" type="range" min="0.55" max="1.65" step="0.05" value="${task.planetSize || legacy?.size || 1}"></label><label class="field wide">Contexte ou détail<textarea data-task-field="description" data-id="${escapeHtml(task.id)}" maxlength="700">${escapeHtml(task.description)}</textarea></label><label class="field wide">Note<textarea data-task-field="reason" data-id="${escapeHtml(task.id)}" maxlength="300">${escapeHtml(task.reason)}</textarea></label><details class="visual-options wide"><summary>Anneaux et matière</summary><div class="form-grid visual-option-fields"><label class="field">Nombre d’anneaux<input data-task-field="ringCount" data-id="${escapeHtml(task.id)}" type="number" min="0" max="20" value="${task.ringCount}"></label><label class="field inline-choice"><span>Anneaux lumineux</span><input data-task-field="ringsGlow" data-id="${escapeHtml(task.id)}" type="checkbox" ${task.ringsGlow ? "checked" : ""}></label><label class="field inline-choice"><span>Anneaux rocheux</span><input data-task-field="ringsRocky" data-id="${escapeHtml(task.id)}" type="checkbox" ${task.ringsRocky ? "checked" : ""}></label></div></details></div></details></article>`;
  }
  function renderSettingsView() {
    const v = data.visual;
    return `<section class="panel-section settings-section"><h3 class="section-title">Noyau central</h3><label class="view-row"><span>Couleur du noyau<small>La sphère centrale et son halo.</small></span><input data-visual="coreColor" type="color" value="${v.coreColor}"></label><label class="view-row"><span>Relief et cratères<small>Choisissez une surface de la lune géante.</small></span><select data-visual="coreCraters"><option value="none" ${v.coreCraters === "none" ? "selected" : ""}>Aucun</option><option value="few" ${v.coreCraters === "few" ? "selected" : ""}>Quelques cratères</option><option value="many" ${v.coreCraters === "many" ? "selected" : ""}>Beaucoup de cratères</option><option value="everest" ${v.coreCraters === "everest" ? "selected" : ""}>Mont Everest — grand relief</option></select></label></section><section class="panel-section settings-section"><h3 class="section-title">Mouvement et densité</h3><label class="view-row"><span>Planètes visibles<small>Combien peuvent tourner en même temps.</small></span><input data-visual="planetCount" type="range" min="1" max="16" step="1" value="${v.planetCount}"><output data-output="planetCount">${v.planetCount}</output></label><label class="view-row"><span>Taille générale<small>La taille de chaque planète s’ajoute à ce réglage.</small></span><input data-visual="planetScale" type="range" min="0.55" max="1.65" step="0.05" value="${v.planetScale}"><output data-output="planetScale">${Math.round(v.planetScale * 100)}%</output></label><label class="view-row"><span>Vitesse orbitale<small>Le mouvement continue en arrière-plan.</small></span><input data-visual="speed" type="range" min="0.2" max="1.8" step="0.05" value="${v.speed}"><output data-output="speed">${v.speed.toFixed(2)}×</output></label><label class="view-row"><span>Orbites magnétiques</span><input class="switch" data-visual="showOrbits" type="checkbox" ${v.showOrbits ? "checked" : ""}></label><label class="view-row"><span>Petites étoiles</span><select data-visual="stars"><option value="18" ${v.stars === 18 ? "selected" : ""}>Peu</option><option value="30" ${v.stars === 30 ? "selected" : ""}>Discrètes</option><option value="46" ${v.stars === 46 ? "selected" : ""}>Plus nombreuses</option><option value="64" ${v.stars === 64 ? "selected" : ""}>Denses</option></select></label></section><section class="panel-section settings-section"><h3 class="section-title">Position du noyau</h3><p class="subtle">Sur le bureau, maintenez le clic droit sur le noyau et faites-le glisser. Toute la carte suit avec lui.</p><button class="secondary-button full-button" data-action="center-reset">Recentrer la carte</button></section><section class="panel-section settings-section sync-settings"><h3 class="section-title">Widget Windows</h3><p class="subtle">Après vos changements, créez une copie. Si le widget est ouvert, elle se met à jour automatiquement.</p><button class="primary-button full-button" data-action="sync-widget">Créer la copie du widget</button></section>`;
  }
  function updateHeader() {
    const badge = byId("syncBadge");
    if (badge) {
      badge.textContent = data.lastSync ? `Copie prête · ${formatClock(data.lastSync)}` : "Widget à synchroniser";
      badge.title = data.lastSync ? `Dernière copie créée à ${formatClock(data.lastSync)}` : "Créez une copie après avoir modifié la carte";
    }
  }

  function setView(view) {
    if (!["tasks", "settings"].includes(view)) return;
    data.view = view; save(); render();
  }

  function syncWidget() {
    const payload = {
      format: SYNC_FORMAT,
      version: 1,
      savedAt: now(),
      subjects: data.subjects.map((subject) => ({ ...subject })),
      tasks: data.tasks.map((task) => ({ ...task })),
      visual: { ...data.visual, center: { ...data.visual.center } }
    };
    const file = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url; link.download = "CockpitTakeover-widget.json"; link.style.display = "none";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    data.lastSync = payload.savedAt; save(); updateHeader();
    showToast("Copie locale créée. Le widget la chargera depuis Téléchargements.");
  }

  function openFocusDialog() {
    let dialog = byId("focusDialog");
    if (!dialog) {
      dialog = document.createElement("dialog"); dialog.id = "focusDialog";
      document.body.appendChild(dialog);
      dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    }
    const open = sortedOpenTasks();
    const running = open.filter((task) => task.status === "active" && taskPhase(task) === "running");
    const elapsed = open.filter((task) => taskPhase(task) === "elapsed");
    const queued = open.filter((task) => task.status === "queued");
    const completed = data.tasks.filter((task) => task.status === "done").slice(0, 6);
    const group = (title, tasks, emptyText = "") => `<h3 class="modal-group-title">${title}</h3>${tasks.length ? tasks.map((task) => {
      const deadline = taskDeadline(task);
      let statusText;
      if (taskPhase(task) === "running") statusText = deadline ? `Échéance : ${formatDueDate(deadline)} · ${timeLabel(task)}` : "En mouvement · sans échéance";
      else if (taskPhase(task) === "elapsed") statusText = `Échéance passée à ${formatDueDate(deadline)} · toujours ouverte`;
      else if (task.status === "done") statusText = task.completedAt ? `Terminée à ${formatClock(task.completedAt)}` : "Terminée";
      else statusText = "En attente de démarrage";
      return `<article class="modal-task"><strong><span style="color:${task.planetColor || "#42dcff"}">●</span> ${escapeHtml(task.title)}</strong><small>${escapeHtml(task.topicName || "Sans repère")}</small><small>${escapeHtml(statusText)}</small><p>${escapeHtml(task.description || "Aucun détail ajouté.")}${task.reason ? `<br><b>Note :</b> ${escapeHtml(task.reason)}` : ""}</p></article>`;
    }).join("") : `<p class="modal-empty">${emptyText}</p>`}`;
    dialog.innerHTML = `<header class="dialog-head"><div><p class="eyebrow">VUE D’ENSEMBLE</p><h2>État des planètes</h2><p>Une échéance passée ne termine jamais un élément à votre place.</p></div><button class="dialog-close" type="button" data-action="close-focus" aria-label="Fermer">×</button></header><div class="dialog-body">${group("En orbite", running, "Aucune planète active.")}${elapsed.length ? group("Échéance passée — toujours ouverte", elapsed) : ""}${queued.length ? group("En attente", queued) : ""}${completed.length ? group("Terminées récemment", completed) : ""}</div>`;
    dialog.showModal();
  }

  function startTask(id, restart = false) {
    const task = data.tasks.find((item) => item.id === id); if (!task) return;
    const timestamp = now();
    const deadline = taskDeadline(task);
    const previousWindow = deadline ? Math.max(5 * 60_000, deadline - (task.startedAt || task.createdAt || timestamp)) : null;
    if (restart || (deadline && deadline <= timestamp)) task.deadlineAt = previousWindow ? timestamp + previousWindow : timestamp + Math.max(5, task.durationMinutes || 25) * 60_000;
    task.status = "active"; task.startedAt = timestamp; task.completedAt = null;
    if (restart) task.reason = "";
    save(); render();
  }

  function completeTask(id) {
    const task = data.tasks.find((item) => item.id === id); if (!task) return;
    task.status = "done"; task.completedAt = now(); save(); render();
  }

  function handleAction(button) {
    const id = button.dataset.id;
    switch (button.dataset.action) {
      case "new-task": setView("tasks"); setTimeout(() => byId("panelContent")?.querySelector('[name="title"]')?.focus(), 0); break;
      case "start-task": startTask(id); break;
      case "restart-task": startTask(id, true); break;
      case "complete-task": completeTask(id); break;
      case "restore-task": { const task = data.tasks.find((item) => item.id === id); if (task) { task.status = "queued"; task.startedAt = null; task.completedAt = null; save(); render(); } break; }
      case "archive-task": { const task = data.tasks.find((item) => item.id === id); if (task) { task.status = "archived"; save(); render(); } break; }
      case "filter": data.taskFilter = button.dataset.filter; save(); render(); break;
      case "center-reset": data.visual.center = { x: 0.5, y: 0.53 }; coreTarget = { ...data.visual.center }; save(); if (DESKTOP_WIDGET) window.qgScene?.saveWidgetPosition?.(data.visual.center); else showToast("La carte est recentrée."); break;
      case "sync-widget": syncWidget(); break;
      case "import-file": byId("taskImport").click(); break;
      case "close-focus": byId("focusDialog")?.close(); break;
    }
  }

  function handleInput(event) {
    const input = event.target;
    if (input.matches("[data-visual]")) {
      const key = input.dataset.visual;
      data.visual[key] = input.type === "checkbox" ? input.checked : input.type === "color" || key === "coreCraters" ? input.value : Number(input.value);
      if (key === "stars") createStars();
      const output = document.querySelector(`[data-output="${key}"]`);
      if (output) output.textContent = key === "planetScale" ? `${Math.round(data.visual[key] * 100)}%` : key === "speed" ? `${data.visual[key].toFixed(2)}×` : String(data.visual[key]);
      save();
      return;
    }
    if (input.matches("[data-task-field]")) {
      const task = data.tasks.find((item) => item.id === input.dataset.id);
      if (!task) return;
      const key = input.dataset.taskField;
      if (key === "planetSize") task[key] = clamp(input.value, 0.55, 1.65);
      else if (key === "ringCount") task[key] = Math.round(clamp(input.value, 0, 20));
      else if (key === "ringsGlow" || key === "ringsRocky") task[key] = input.checked;
      else if (key === "deadlineAt") task.deadlineAt = input.value ? new Date(input.value).getTime() : null;
      else task[key] = input.value;
      if (key === "topicName") task.subjectId = null;
      const card = input.closest("[data-planet-card]");
      if (key === "planetColor") card?.querySelector(".planet-swatch")?.style.setProperty("--planet-color", task.planetColor);
      if (key === "deadlineAt") {
        const label = card?.querySelector(".deadline-label");
        if (label) label.textContent = task.deadlineAt ? `Échéance · ${formatDueDate(task.deadlineAt)}` : "Échéance à définir";
      }
      if (key === "planetSize") {
        const output = input.closest(".field")?.querySelector(".field-value");
        if (output) output.textContent = `${Math.round(task.planetSize * 100)}%`;
      }
      save();
      return;
    }
    if (input.name === "planetSize") {
      const output = input.closest(".field")?.querySelector("[data-new-size-output]");
      if (output) output.textContent = `${Math.round(Number(input.value) * 100)}%`;
    }
  }

  function handleChange(event) {
    const input = event.target;
    if (input.matches("[data-visual]")) { data.visual = cleanVisual(data.visual); save(); return; }
    if (input.matches("[data-task-filter]")) { data.taskFilter = input.value; save(); render(); return; }
    if (input.matches("[data-task-field]")) {
      const task = data.tasks.find((item) => item.id === input.dataset.id);
      if (!task) return;
      const card = input.closest("[data-planet-card]");
      if (input.dataset.taskField === "title") { const title = card?.querySelector(".planet-card-name h4"); if (title) title.textContent = task.title || "Planète sans nom"; }
      if (input.dataset.taskField === "topicName") { const topic = card?.querySelector(".planet-card-name span"); if (topic) topic.textContent = task.topicName || "Planète"; }
      save();
    }
  }

  function handleSubmit(event) {
    if (event.target.id !== "taskForm") return;
    event.preventDefault();
    const formData = new FormData(event.target);
    const task = cleanTask({
      id: makeId(), title: formData.get("title"), description: formData.get("description"),
      topicName: formData.get("topicName"), planetColor: formData.get("planetColor"), planetSize: formData.get("planetSize"),
      deadlineAt: formData.get("deadlineAt") ? new Date(formData.get("deadlineAt")).getTime() : null,
      ringCount: formData.get("ringCount"), ringsGlow: formData.get("ringsGlow") === "on", ringsRocky: formData.get("ringsRocky") === "on",
      priority: 2, status: formData.get("startNow") ? "active" : "queued", startedAt: formData.get("startNow") ? now() : null, createdAt: now()
    }, data.subjects);
    if (!task.title) return;
    data.tasks.unshift(task); save(); render(); showToast("Planète ajoutée à votre carte.");
  }
  function createImportDialog() {
    importDialog = document.createElement("dialog"); importDialog.id = "importDialog";
    importDialog.innerHTML = `<header class="dialog-head"><div><p class="eyebrow">IMPORTATION AVANT AJOUT</p><h2>Aperçu de votre fichier</h2><p>Chaque ligne devient une planète. Les listes existantes restent intactes; les échéances et détails restent modifiables.</p></div><button class="dialog-close" type="button" data-action="close-import" aria-label="Fermer">×</button></header><div class="dialog-body"><p id="importSummary" class="subtle"></p><div class="import-preview"><ul id="importRows"></ul></div><div class="empty-actions"><button class="primary-button" type="button" data-action="apply-import">Ajouter ces planètes</button><button class="secondary-button" type="button" data-action="close-import">Annuler</button></div></div>`;
    document.body.appendChild(importDialog);
    importDialog.addEventListener("click", (event) => { if (event.target === importDialog) importDialog.close(); });
  }

  function parseImportText(text, fileName) {
    let raw;
    try { raw = JSON.parse(text); } catch (_) { raw = null; }
    if (raw && Array.isArray(raw.tasks)) {
      return raw.tasks.slice(0, 500).map((item, index) => {
        const input = item || {};
        const subject = data.subjects.find((s) => s.id === input.subjectId) || data.subjects.find((s) => normalize(s.name) === normalize(input.categoryName || ""));
        return cleanTask({ ...input, title: input.title, description: input.description || input.doneWhen || "", subjectId: subject?.id || null, topicName: input.topicName || input.categoryName || subject?.name || "", planetColor: input.planetColor || input.color || NEON_COLORS[(data.tasks.length + index) % NEON_COLORS.length], planetSize: input.planetSize ?? subject?.size, durationMinutes: input.durationMinutes || input.minutes || subject?.durationMinutes || 25, reason: input.reason || "", status: ["queued", "active", "done", "archived"].includes(input.status) ? input.status : "queued", createdAt: input.createdAt || now() }, data.subjects);
      }).filter((task) => task.title);
    }
    let currentSubject = null;
    let currentTopicName = "";
    const result = [];
    for (const sourceLine of String(text).split(/\r?\n/)) {
      let line = sourceLine.trim(); if (!line) continue;
      const heading = line.match(/^#{1,4}\s+(.+?)\s*#*$/) || line.match(/^\[([^\]]+)\]$/);
      if (heading) {
        const wanted = normalize(heading[1]);
        currentSubject = data.subjects.find((subject) => normalize(subject.name) === wanted) || null;
        currentTopicName = currentSubject?.name || heading[1].trim();
        continue;
      }
      const bullet = line.match(/^(?:[-*+•]\s*|\d+[.)]\s*)(.*)$/);
      if (bullet) line = bullet[1].trim();
      const done = /^\[[xX]\]\s*/.test(line); line = line.replace(/^\[[ xX]\]\s*/, "").trim();
      if (!line || line.length > 180) continue;
      result.push(cleanTask({ title: line, subjectId: currentSubject?.id || null, topicName: currentTopicName, planetColor: NEON_COLORS[result.length % NEON_COLORS.length], durationMinutes: 25, status: done ? "done" : "queued", createdAt: now(), source: fileName }, data.subjects));
      if (result.length >= 500) break;
    }
    return result;
  }

  function showImportPreview(tasks, fileName) {
    if (!importDialog) createImportDialog();
    pendingImport = tasks.filter((task) => task.title);
    byId("importSummary").textContent = `${pendingImport.length} élément${pendingImport.length === 1 ? "" : "s"} trouvé${pendingImport.length === 1 ? "" : "s"} dans « ${fileName} ». Vous pourrez modifier chaque échéance après l’importation.`;
    byId("importRows").innerHTML = pendingImport.slice(0, 24).map((task) => `<li>${escapeHtml(task.title)}${task.topicName ? ` <span class="subtle">· ${escapeHtml(task.topicName)}</span>` : ""}</li>`).join("") + (pendingImport.length > 24 ? `<li>… et ${pendingImport.length - 24} autres</li>` : "");
    importDialog.showModal();
  }

  async function readImportFile(file) {
    if (!file) return;
    if (file.size > 2_000_000) return showToast("Le fichier dépasse la limite de 2 Mo.");
    const text = await file.text();
    const tasks = parseImportText(text, file.name);
    if (!tasks.length) return showToast("Aucune tâche lisible n’a été trouvée.");
    showImportPreview(tasks, file.name);
  }

  function applyImport() {
    if (!pendingImport.length) return;
    const seen = new Set(data.tasks.map((task) => normalize(task.title)));
    let added = 0;
    for (const item of pendingImport) {
      const key = normalize(item.title); if (!key || seen.has(key)) continue;
      seen.add(key); data.tasks.push(cleanTask(item, data.subjects)); added++;
    }
    pendingImport = []; save(); importDialog.close(); render(); showToast(`${added} planète${added === 1 ? " ajoutée" : "s ajoutées"}; les doublons ont été ignorés.`);
  }

  function createStars() {
    const baseCount = Math.round(clamp(data.visual.stars, 12, 64));
    const total = baseCount * 50;
    starAnchor = { x: width * coreCurrent.x, y: height * coreCurrent.y };
    starLayer = document.createElement("canvas");
    const starRatio = Math.min(ratio, 1);
    starLayer.width = Math.max(1, Math.round(width * starRatio));
    starLayer.height = Math.max(1, Math.round(height * starRatio));
    const layerCtx = starLayer.getContext("2d", { alpha: true });
    layerCtx.setTransform(starRatio, 0, 0, starRatio, 0, 0);
    const span = Math.min(width, height);
    for (let index = 0; index < total; index++) {
      const angle = Math.random() * TAU;
      const distance = Math.random() < 0.14 ? span * (0.12 + Math.random() * 0.72) : span * (0.025 + Math.pow(Math.random(), 1.8) * 0.64);
      const x = starAnchor.x + Math.cos(angle) * distance;
      const y = starAnchor.y + Math.sin(angle) * distance * (0.62 + Math.random() * 0.2);
      const size = 0.28 + Math.random() * 0.62;
      layerCtx.globalAlpha = 0.13 + Math.random() * 0.32;
      layerCtx.fillStyle = "#f7fbff";
      layerCtx.beginPath(); layerCtx.arc(x, y, size, 0, TAU); layerCtx.fill();
    }
    layerCtx.globalAlpha = 1;
    const movingCount = Math.min(150, Math.max(48, Math.round(baseCount * 2.2)));
    stars = Array.from({ length: movingCount }, (_, index) => ({ orbit: span * (0.04 + Math.pow(Math.random(), 1.55) * 0.55), phase: Math.random() * TAU, size: 0.38 + Math.random() * 0.7, alpha: 0.12 + Math.random() * 0.25, speed: (0.000009 + Math.random() * 0.000015) * (index % 3 ? 1 : -1), squash: 0.62 + Math.random() * 0.2 }));
  }

  function resizeCanvas() {
    ratio = Math.min(window.devicePixelRatio || 1, DESKTOP_WIDGET ? 1.8 : 2);
    width = Math.max(1, canvas.clientWidth || window.innerWidth);
    height = Math.max(1, canvas.clientHeight || window.innerHeight);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    createStars();
    if (DESKTOP_WIDGET) updateHitArea();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawStars(timestamp) {
    const coreX = width * coreCurrent.x, coreY = height * coreCurrent.y;
    if (starLayer) {
      ctx.save(); ctx.translate(coreX, coreY); ctx.scale(data.visual.zoom, data.visual.zoom);
      ctx.drawImage(starLayer, -starAnchor.x, -starAnchor.y, width, height); ctx.restore();
    }
    stars.forEach((star) => {
      const angle = timestamp * star.speed * data.visual.speed + star.phase + data.visual.viewYaw * 0.12;
      const x = coreX + Math.cos(angle) * star.orbit * data.visual.zoom;
      const y = coreY + Math.sin(angle) * star.orbit * star.squash * data.visual.zoom;
      const twinkle = 0.65 + 0.35 * Math.sin(timestamp * 0.0007 + star.phase);
      ctx.globalAlpha = star.alpha * twinkle; ctx.fillStyle = "#f7fbff";
      ctx.beginPath(); ctx.arc(x, y, star.size, 0, TAU); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function coreGeometry() {
    const center = coreCurrent;
    const radius = clamp(Math.min(width, height) * 0.046, 30, 62) * data.visual.planetScale * data.visual.zoom;
    return { x: width * center.x, y: height * center.y, radius };
  }

  function projectScenePoint(cx, cy, x, y, z, timestamp) {
    const yaw = 0.14 * Math.sin(timestamp * 0.000035) + data.visual.viewYaw;
    const pitch = 0.48 + 0.035 * Math.sin(timestamp * 0.000021) + data.visual.viewPitch;
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
    const rotatedX = x * cosYaw + z * sinYaw;
    const rotatedZ = -x * sinYaw + z * cosYaw;
    const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
    const rotatedY = y * cosPitch - rotatedZ * sinPitch;
    const depth = y * sinPitch + rotatedZ * cosPitch;
    const focal = Math.max(420, Math.min(width, height) * 1.55);
    const perspective = clamp(focal / (focal + depth), 0.62, 1.58);
    return { x: cx + rotatedX * perspective, y: cy + rotatedY * perspective, scale: perspective, depth };
  }

  function orbitPoint(core, angle, radius, inclination, nodeAngle, timestamp) {
    const planeX = Math.cos(angle) * radius;
    const planeY = Math.sin(angle) * radius;
    const cosNode = Math.cos(nodeAngle), sinNode = Math.sin(nodeAngle);
    const cosInclination = Math.cos(inclination), sinInclination = Math.sin(inclination);
    const x = planeX * cosNode - planeY * cosInclination * sinNode;
    const y = planeX * sinNode + planeY * cosInclination * cosNode;
    const z = planeY * sinInclination;
    return projectScenePoint(core.x, core.y, x, y, z, timestamp);
  }

  function drawProjectedOrbit(core, radius, inclination, nodeAngle, color, alpha, timestamp, dashed = true) {
    const segments = 88;
    ctx.save(); ctx.beginPath();
    for (let segment = 0; segment <= segments; segment++) {
      const point = orbitPoint(core, segment / segments * TAU, radius, inclination, nodeAngle, timestamp);
      if (segment === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 0.8;
    if (dashed) { ctx.setLineDash([1.5, 8]); ctx.lineDashOffset = -timestamp * 0.008; }
    ctx.stroke(); ctx.restore();
  }

  function drawDistantOrbitals(core, timestamp) {
    const span = Math.min(width, height);
    const colors = ["#a8baff", "#90f4e6", "#f0a7e7"];
    for (let index = 0; index < 3; index++) {
      const radius = span * (0.43 + index * 0.13) * data.visual.zoom;
      const inclination = [0.82, 1.12, 0.48][index];
      const nodeAngle = index * 1.17 - 0.34;
      drawProjectedOrbit(core, radius, inclination, nodeAngle, colors[index], 0.052 - index * 0.008, timestamp);
      const angle = timestamp * (index % 2 ? -0.000038 : 0.000031) + index * 2.13;
      const mote = orbitPoint(core, angle, radius, inclination, nodeAngle, timestamp);
      const size = (1.05 + index * 0.18) * mote.scale;
      const glow = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, size * 6);
      glow.addColorStop(0, `${colors[index]}55`); glow.addColorStop(1, `${colors[index]}00`);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(mote.x, mote.y, size * 6, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.22 - index * 0.04; ctx.fillStyle = colors[index];
      ctx.beginPath(); ctx.arc(mote.x, mote.y, size, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  function drawCore(core, timestamp, urgency) {
    const reduced = motionPreference === "reduced";
    const pulseRate = (urgency > 0.72 ? 1.1 : 0.42) * (reduced ? 0.45 : 1);
    const pulseAmount = (urgency > 0.72 ? 0.022 : 0.008) * (reduced ? 0.5 : 1);
    const radius = core.radius * (1 + pulseAmount * Math.sin(timestamp * 0.001 * TAU * pulseRate));
    const coreColor = data.visual.coreColor;
    const halo = ctx.createRadialGradient(core.x, core.y, radius * .28, core.x, core.y, radius * 2.75);
    halo.addColorStop(0, colorWithAlpha(coreColor, .2)); halo.addColorStop(.28, "rgba(139,121,255,.105)"); halo.addColorStop(.65, "rgba(255,79,200,.035)"); halo.addColorStop(1, colorWithAlpha(coreColor, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(core.x, core.y, radius * 2.75, 0, TAU); ctx.fill();

    const pulse = 1 + .016 * Math.sin(timestamp * .0017);
    ctx.save(); ctx.translate(core.x, core.y); ctx.rotate(timestamp * .000045);
    [[1.3, .58, "rgba(66,220,255,.19)"], [1.62, .47, "rgba(139,121,255,.12)"], [1.9, .66, "rgba(255,79,200,.085)"]].forEach(([scale, squash, color], index) => {
      ctx.beginPath(); ctx.ellipse(0, 0, radius * scale * pulse, radius * scale * squash, index % 2 ? .32 : -.22, 0, TAU);
      ctx.strokeStyle = color; ctx.lineWidth = index === 0 ? 1.1 : .7; ctx.setLineDash(index === 1 ? [2, 8] : []); ctx.stroke();
    });
    ctx.setLineDash([]); ctx.restore();

    const baselineCore = coreColor === "#42dcff";
    const surface = ctx.createRadialGradient(core.x - radius * .34, core.y - radius * .42, radius * .04, core.x + radius * .24, core.y + radius * .24, radius * 1.18);
    surface.addColorStop(0, "#f2ffff"); surface.addColorStop(.09, baselineCore ? "#b8fbff" : tintColor(coreColor, .62)); surface.addColorStop(.26, coreColor); surface.addColorStop(.58, baselineCore ? "#2679a8" : tintColor(coreColor, -.32)); surface.addColorStop(.84, baselineCore ? "#18304f" : tintColor(coreColor, -.65)); surface.addColorStop(1, "#09101f");
    ctx.save(); ctx.shadowColor = colorWithAlpha(coreColor, .48); ctx.shadowBlur = radius * .48;
    ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(core.x, core.y, radius, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); ctx.beginPath(); ctx.arc(core.x, core.y, radius * .99, 0, TAU); ctx.clip();
    const plasma = ctx.createLinearGradient(core.x - radius, core.y + radius * .25, core.x + radius, core.y - radius * .2);
    plasma.addColorStop(0, "rgba(255,79,200,0)"); plasma.addColorStop(.48, "rgba(255,255,255,.16)"); plasma.addColorStop(1, "rgba(139,121,255,.2)");
    ctx.fillStyle = plasma; ctx.fillRect(core.x - radius, core.y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = .2; ctx.strokeStyle = "#e7ffff"; ctx.lineWidth = Math.max(.7, radius * .025);
    [-.42, -.17, .12, .39].forEach((offset, index) => { ctx.beginPath(); ctx.ellipse(core.x, core.y + radius * offset, radius * .92, radius * (.12 + index * .012), -.08, .08, Math.PI * .92); ctx.stroke(); });
    drawCoreCraters(core, radius, data.visual.coreCraters, coreColor);
    ctx.restore();
    ctx.strokeStyle = "rgba(200,250,255,.72)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(core.x, core.y, radius, -.92, 1.78); ctx.stroke();
    ctx.restore();
    coreHit = { x: core.x, y: core.y, radius: radius * 1.18 };
  }

  function rgbFromHex(hex) {
    const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "42dcff";
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  }

  function colorWithAlpha(hex, alpha) {
    const [red, green, blue] = rgbFromHex(hex);
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  function tintColor(hex, amount) {
    const [red, green, blue] = rgbFromHex(hex);
    const target = amount >= 0 ? 255 : 8;
    const strength = Math.abs(amount);
    return `#${[red, green, blue].map((channel) => Math.round(channel + (target - channel) * strength).toString(16).padStart(2, "0")).join("")}`;
  }

  function drawCoreCraters(core, radius, style, color) {
    if (style === "none") return;
    const craters = [
      [-.56,-.28,.071],[-.29,-.51,.058],[.06,-.58,.069],[.4,-.43,.082],[.57,-.11,.054],[-.48,.12,.09],[-.16,-.05,.062],[.19,-.19,.067],[.48,.19,.073],[-.35,.43,.061],[-.02,.48,.075],[.28,.47,.05],[-.64,.04,.044],[.02,.2,.051],[.63,.04,.052],[-.02,-.37,.046],[.35,-.05,.051],[-.5,-.49,.045],[.57,-.32,.044],[-.23,.28,.052],[.12,.57,.043],[-.52,.35,.042],[.43,.39,.041],[-.32,-.2,.039]
    ];
    const count = style === "few" ? 6 : style === "many" ? 24 : 9;
    ctx.save();
    for (const [nx, ny, scale] of craters.slice(0, count)) {
      const x = core.x + nx * radius, y = core.y + ny * radius, size = scale * radius;
      const rotation = (nx - ny) * 0.75;
      ctx.globalAlpha = .43;
      ctx.fillStyle = "rgba(4,9,20,.46)";
      ctx.beginPath(); ctx.ellipse(x, y, size * 1.25, size * .78, rotation, 0, TAU); ctx.fill();
      ctx.globalAlpha = .43; ctx.strokeStyle = colorWithAlpha(color, .48); ctx.lineWidth = Math.max(.65, radius * .012);
      ctx.beginPath(); ctx.ellipse(x - size * .08, y - size * .07, size * 1.1, size * .7, rotation, Math.PI * 1.04, Math.PI * 1.92); ctx.stroke();
      ctx.globalAlpha = .36; ctx.strokeStyle = "rgba(3,7,15,.7)";
      ctx.beginPath(); ctx.ellipse(x + size * .06, y + size * .05, size * .78, size * .48, rotation, -.1, Math.PI * .92); ctx.stroke();
    }
    if (style === "everest") {
      const x = core.x - radius * .16, y = core.y - radius * .11, basin = radius * .29;
      ctx.globalAlpha = .5; ctx.fillStyle = "rgba(4,8,18,.58)";
      ctx.beginPath(); ctx.ellipse(x, y, basin * 1.2, basin * .78, -.24, 0, TAU); ctx.fill();
      ctx.globalAlpha = .72; ctx.strokeStyle = colorWithAlpha(color, .8); ctx.lineWidth = Math.max(1, radius * .022);
      ctx.beginPath(); ctx.ellipse(x, y - basin * .035, basin, basin * .62, -.24, Math.PI * 1.04, Math.PI * 1.92); ctx.stroke();
      ctx.globalAlpha = .8;
      const peak = ctx.createLinearGradient(x, y - basin * .75, x, y + basin * .48);
      peak.addColorStop(0, "#f5ffff"); peak.addColorStop(.32, tintColor(color, .58)); peak.addColorStop(1, tintColor(color, -.45));
      ctx.fillStyle = peak; ctx.strokeStyle = "rgba(245,252,255,.72)"; ctx.lineWidth = Math.max(.7, radius * .012);
      ctx.beginPath(); ctx.moveTo(x - basin * .54, y + basin * .43); ctx.lineTo(x - basin * .3, y - basin * .16); ctx.lineTo(x - basin * .08, y + basin * .02); ctx.lineTo(x + basin * .14, y - basin * .72); ctx.lineTo(x + basin * .26, y - basin * .24); ctx.lineTo(x + basin * .5, y + basin * .43); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }

  function drawPlanetRings(x, y, radius, color, count, glowing, rocky, rotation, fade, timestamp) {
    if (!count) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation * .22 + data.visual.viewYaw * .4);
    const rockStep = Math.max(1, Math.ceil(count / 7));
    for (let ring = 0; ring < count; ring++) {
      const rx = radius * (1.52 + ring * .056);
      const ry = radius * (.39 + ring * .011);
      const shade = ring % 3 === 0 ? 1 : ring % 3 === 1 ? .72 : .48;
      ctx.globalAlpha = fade * (glowing ? .34 : .2) * shade;
      ctx.strokeStyle = glowing ? color : "#dceaff";
      ctx.lineWidth = Math.max(.38, radius * .009);
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, Math.sin(rotation + ring * .08) * .025, 0, TAU); ctx.stroke();
      if (rocky && ring % rockStep === 0) {
        const angle = ring * 2.399 + rotation;
        ctx.fillStyle = color; ctx.globalAlpha = fade * .35;
        ctx.beginPath(); ctx.arc(Math.cos(angle) * rx, Math.sin(angle) * ry, Math.max(.45, radius * .018), 0, TAU); ctx.fill();
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }

  function drawTaskPlanet(task, index, core, timestamp, wallTime) {
    const subject = subjectById(task.subjectId);
    const color = task.planetColor || subject?.color || NEON_COLORS[index % NEON_COLORS.length];
    const phase = taskPhase(task, wallTime);
    const progress = phase === "running" ? taskProgress(task, wallTime) : phase === "elapsed" ? 1 : 0;
    const orbitIndex = index + 1;
    const outer = Math.min(Math.min(width, height) * .44 * data.visual.zoom, core.radius + (84 + (orbitIndex % 4) * 34) * data.visual.zoom);
    const orbit = core.radius + 22 * data.visual.zoom + (outer - core.radius - 22 * data.visual.zoom) * (1 - Math.pow(progress, 1.38));
    const direction = index % 2 ? -1 : 1;
    const speed = .00013 * data.visual.speed * (motionPreference === "reduced" ? 0.45 : 1) * (1 + index * .055) * direction;
    const angle = (index * 2.399963) + (task.startedAt || task.createdAt) * .000002 + timestamp * speed;
    const inclination = [0.38, 0.68, 0.94, 1.18, 0.52, 1.36][index % 6];
    const nodeAngle = index * 1.73 + 0.26 * Math.sin(timestamp * .000018 + index);
    const position = orbitPoint(core, angle, orbit, inclination, nodeAngle, timestamp);
    const { x, y } = position;
    const urgency = phase === "running" && taskDeadline(task) ? progress : phase === "elapsed" ? 1 : 0;
    const heartbeatScale = motionPreference === "reduced" ? 0.5 : 1;
    const heartbeat = urgency > .72 ? 1 + .055 * heartbeatScale * Math.sin(timestamp * .0085) : 1 + .018 * heartbeatScale * Math.sin(timestamp * .0022 + index);
    const subjectSize = task.planetSize || subject?.size || 1;
    const radius = clamp((10 + Math.min(5, subjectSize * 3)) * data.visual.planetScale * subjectSize, 7, 27) * heartbeat * position.scale * data.visual.zoom;
    const ageAfter = taskDeadline(task) ? wallTime - taskDeadline(task) : 0;
    const absorbing = phase === "elapsed" && ageAfter >= 0 && ageAfter < 1750;
    const fade = absorbing ? 1 - ageAfter / 1750 : phase === "elapsed" ? 0 : 1;
    if (fade <= 0) return;
    ctx.save(); ctx.globalAlpha = fade;
    if (data.visual.showOrbits) {
      drawProjectedOrbit(core, outer, inclination, nodeAngle, color, .13 * fade, timestamp);
      drawProjectedOrbit(core, orbit, inclination, nodeAngle, color, .26 * fade, timestamp);
    }
    if (absorbing) {
      const sink = ageAfter / 1750; const sx = x + (core.x - x) * sink; const sy = y + (core.y - y) * sink; const sr = radius * (1 - sink * .62);
      const trail = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.7); trail.addColorStop(0, `${color}66`); trail.addColorStop(1, `${color}00`); ctx.fillStyle = trail; ctx.beginPath(); ctx.arc(sx, sy, sr * 2.7, 0, TAU); ctx.fill();
      ctx.restore(); return;
    }
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.35); glow.addColorStop(0, `${color}66`); glow.addColorStop(.32, `${color}30`); glow.addColorStop(1, `${color}00`); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 3.35, 0, TAU); ctx.fill();
    drawPlanetRings(x, y, radius, color, Math.round(clamp(task.ringCount ?? 1, 0, 20)), task.ringsGlow !== false, Boolean(task.ringsRocky), angle * .16 + timestamp * .00008, fade, timestamp);
    ctx.shadowColor = `${color}dd`; ctx.shadowBlur = 11 * data.visual.planetScale;
    const spin = timestamp * .00019 + index * 1.7;
    const highlightX = Math.cos(spin) * radius * .12;
    const highlightY = Math.sin(spin) * radius * .11;
    const surface = ctx.createRadialGradient(x - radius * .38 + highlightX, y - radius * .44 + highlightY, .5, x + radius * .17, y + radius * .16, radius * 1.3);
    surface.addColorStop(0, "#ffffff"); surface.addColorStop(.11, color); surface.addColorStop(.53, color); surface.addColorStop(.84, "#263347"); surface.addColorStop(1, "#0a1020");
    ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius * .98, 0, TAU); ctx.clip();
    ctx.globalAlpha = .16; ctx.strokeStyle = "#f4ffff"; ctx.lineWidth = Math.max(.4, radius * .035);
    ctx.beginPath(); ctx.ellipse(x + highlightX * 1.8, y + highlightY * 1.8, radius * .38, radius * .94, -.36 + Math.sin(spin) * .12, -.95, 1.15); ctx.stroke();
    ctx.globalAlpha = .15; ctx.strokeStyle = `${color}dd`; ctx.beginPath(); ctx.ellipse(x, y + radius * .13, radius * .95, radius * .23, -.12 + Math.cos(spin) * .08, .12, 2.8); ctx.stroke();
    ctx.globalAlpha = .1; ctx.strokeStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(x, y - radius * .18, radius * .9, radius * .13, Math.sin(spin) * .09, .2, 2.75); ctx.stroke(); ctx.restore();
    if (phase === "running" && data.visual.showOrbits) {
      ctx.strokeStyle = `${color}a8`; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(x, y, radius + 3, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(.025, progress)); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFrame(timestamp) {
    if (!DESKTOP_WIDGET && timestamp - lastDraw < 15) { requestAnimationFrame(drawFrame); return; }
    const dt = lastDraw ? Math.min(64, timestamp - lastDraw) : 16;
    lastDraw = timestamp;
    const wallTime = now();
    coreCurrent.x += (coreTarget.x - coreCurrent.x) * Math.min(1, dt * .012);
    coreCurrent.y += (coreTarget.y - coreCurrent.y) * Math.min(1, dt * .012);
    ctx.clearRect(0, 0, width, height);
    drawStars(timestamp);
    const openTasks = (DESKTOP_WIDGET ? currentTasksSnapshot : data.tasks).filter((task) => !["done", "archived"].includes(task.status));
    const running = openTasks.filter((task) => taskPhase(task, wallTime) === "running").sort((a, b) => (taskDeadline(a) || Infinity) - (taskDeadline(b) || Infinity));
    const queued = openTasks.filter((task) => taskPhase(task, wallTime) === "queued").sort((a, b) => (taskDeadline(a) || Infinity) - (taskDeadline(b) || Infinity));
    const visible = running.concat(queued).slice(0, data.visual.planetCount);
    const absorbing = openTasks.filter((task) => taskPhase(task, wallTime) === "elapsed" && wallTime - taskDeadline(task) < 1750);
    const active = visible.concat(absorbing);
    const core = coreGeometry();
    let urgency = 0;
    if (active.length) urgency = Math.max(...active.map((task) => taskProgress(task, wallTime)));
    drawDistantOrbitals(core, timestamp);
    if (data.visual.showOrbits) {
      [1.42, 1.92, 2.5].forEach((factor, index) => drawProjectedOrbit(core, core.radius * factor + 34, .48 + index * .21, -.17 + index * .72, index % 2 ? "#8b79ff" : "#42dcff", .11, timestamp));
    }
    const ordered = active.map((task, index) => ({ task, index, phase: taskPhase(task, wallTime), progress: taskPhase(task, wallTime) === "running" ? taskProgress(task, wallTime) : 0 }))
      .sort((a, b) => Number(b.phase === "elapsed") - Number(a.phase === "elapsed") || (a.progress - b.progress));
    const rear = ordered.filter(({ task, index, phase }) => {
      const progress = phase === "running" ? taskProgress(task, wallTime) : phase === "elapsed" ? 1 : 0;
      const outer = Math.min(Math.min(width, height) * .44 * data.visual.zoom, core.radius + (84 + ((index + 1) % 4) * 34) * data.visual.zoom);
      const orbit = core.radius + 22 * data.visual.zoom + (outer - core.radius - 22 * data.visual.zoom) * (1 - Math.pow(progress, 1.38));
      const direction = index % 2 ? -1 : 1;
      const speed = .00013 * data.visual.speed * (motionPreference === "reduced" ? 0.45 : 1) * (1 + index * .055) * direction;
      const angle = index * 2.399963 + (task.startedAt || task.createdAt) * .000002 + timestamp * speed;
      const inclination = [0.38, 0.68, 0.94, 1.18, 0.52, 1.36][index % 6];
      const nodeAngle = index * 1.73 + 0.26 * Math.sin(timestamp * .000018 + index);
      return orbitPoint(core, angle, orbit, inclination, nodeAngle, timestamp).depth > 0;
    });
    const front = ordered.filter((item) => !rear.includes(item));
    rear.forEach(({ task, index }) => drawTaskPlanet(task, index, core, timestamp, wallTime));
    drawCore(core, timestamp, urgency);
    front.forEach(({ task, index }) => drawTaskPlanet(task, index, core, timestamp, wallTime));
    if (DESKTOP_WIDGET && timestamp - lastPositionSent > 70) updateHitArea();
    requestAnimationFrame(drawFrame);
  }

  function updateHitArea() {
    if (!DESKTOP_WIDGET || !window.qgScene?.setInputEnabled) return;
    const core = coreGeometry(); coreHit = { x: core.x, y: core.y, radius: core.radius * 1.18 };
  }

  function setWidgetInput(enabled) {
    if (!DESKTOP_WIDGET || inputCapture === enabled) return;
    inputCapture = enabled;
    window.qgScene?.setInputEnabled?.(enabled);
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nearCore(point, padding = 9) { return Math.hypot(point.x - coreHit.x, point.y - coreHit.y) <= coreHit.radius + padding; }

  function setCenterFromPoint(point) {
    coreTarget = { x: clamp(point.x / width, 0.07, 0.93), y: clamp(point.y / height, 0.09, 0.91) };
    data.visual.center = { ...coreTarget };
    if (!DESKTOP_WIDGET) save();
    lastPositionSent = now();
  }

  function setCenterFromPointer(event) { setCenterFromPoint(pointerPoint(event)); }

  function finishDrag() {
    if (!draggingCore) return;
    draggingCore = false;
    if (DESKTOP_WIDGET) {
      window.qgScene?.saveWidgetPosition?.({ ...data.visual.center });
      setWidgetInput(false);
    } else save();
    dragPointerId = null;
  }

  function wrapAngle(value) { return ((value % TAU) + TAU) % TAU; }

  function saveViewGesture() {
    if (DESKTOP_WIDGET) {
      window.qgScene?.saveWidgetView?.({ viewYaw: data.visual.viewYaw, viewPitch: data.visual.viewPitch, zoom: data.visual.zoom });
      window.qgScene?.saveWidgetPosition?.({ ...data.visual.center });
    } else save();
  }

  function applyViewDrag(start, point) {
    const dx = point.x - start.x, dy = point.y - start.y;
    if (Math.hypot(dx, dy) > 4) start.moved = true;
    if (!start.moved) return;
    data.visual.viewYaw = wrapAngle(start.viewYaw + dx / Math.max(1, width) * TAU);
    data.visual.viewPitch = clamp(start.viewPitch - dy / Math.max(1, height) * 1.5, -1.15, 1.15);
  }

  function pointFromTouch(touch) {
    const rect = canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  function beginTouchGesture(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button,input,select,textarea,a,summary,[data-action],[data-panel-drag]")) return;
    if (event.touches.length >= 2) {
      const [first, second] = [event.touches[0], event.touches[1]].map(pointFromTouch);
      touchGesture = {
        mode: "pinch", identifiers: [event.touches[0].identifier, event.touches[1].identifier],
        center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
        distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
        startCenter: { ...data.visual.center }, startZoom: data.visual.zoom, moved: false
      };
      event.preventDefault();
      return;
    }
    if (event.touches.length === 1 && (event.target === canvas || DESKTOP_WIDGET)) {
      const touch = event.touches[0], point = pointFromTouch(touch);
      touchGesture = {
        mode: "rotate", identifier: touch.identifier, x: point.x, y: point.y,
        viewYaw: data.visual.viewYaw, viewPitch: data.visual.viewPitch,
        startOnCore: nearCore(point, 3), moved: false
      };
    }
  }

  function moveTouchGesture(event) {
    const gesture = touchGesture;
    if (!gesture) return;
    if (gesture.mode === "pinch") {
      const firstTouch = [...event.touches].find((touch) => touch.identifier === gesture.identifiers[0]);
      const secondTouch = [...event.touches].find((touch) => touch.identifier === gesture.identifiers[1]);
      if (!firstTouch || !secondTouch) return;
      const first = pointFromTouch(firstTouch), second = pointFromTouch(secondTouch);
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      const dx = center.x - gesture.center.x, dy = center.y - gesture.center.y;
      if (Math.abs(distance - gesture.distance) > 4 || Math.hypot(dx, dy) > 4) gesture.moved = true;
      if (gesture.moved) {
        data.visual.zoom = clamp(gesture.startZoom * distance / gesture.distance, 0.65, 2.25);
        data.visual.center = {
          x: clamp(gesture.startCenter.x + dx / Math.max(1, width), 0.07, 0.93),
          y: clamp(gesture.startCenter.y + dy / Math.max(1, height), 0.09, 0.91)
        };
        coreTarget = { ...data.visual.center };
      }
      event.preventDefault();
      return;
    }
    const touch = [...event.touches].find((item) => item.identifier === gesture.identifier);
    if (touch) {
      applyViewDrag(gesture, pointFromTouch(touch));
      event.preventDefault();
    }
  }

  function finishTouchGesture(event) {
    if (!touchGesture) return;
    if (event.touches.length > 0) {
      if (touchGesture.mode === "pinch" && touchGesture.moved) saveViewGesture();
      touchGesture = null;
      return;
    }
    const finished = touchGesture;
    touchGesture = null;
    if (finished.moved) saveViewGesture();
    else if (finished.mode === "rotate" && finished.startOnCore && !DESKTOP_WIDGET) openFocusDialog();
    if (DESKTOP_WIDGET) setWidgetInput(false);
  }

  function finishViewDrag(pointerId) {
    if (!viewDrag || viewDrag.pointerId !== pointerId) return;
    const finished = viewDrag;
    viewDrag = null;
    if (finished.moved) saveViewGesture();
    else if (finished.startOnCore && !DESKTOP_WIDGET) openFocusDialog();
    if (DESKTOP_WIDGET) setWidgetInput(false);
  }

  canvas.addEventListener("pointermove", (event) => {
    const point = pointerPoint(event);
    if (event.pointerType === "touch") return;
    if (viewDrag && event.pointerId === viewDrag.pointerId) { applyViewDrag(viewDrag, point); return; }
    if (!draggingCore) {
      if (DESKTOP_WIDGET) setWidgetInput(nearCore(point, 13));
      return;
    }
    if (event.pointerId !== dragPointerId) return;
    setCenterFromPointer(event);
  });
  canvas.addEventListener("pointerdown", (event) => {
    const point = pointerPoint(event);
    if (event.pointerType === "touch") return;
    if (nearCore(point, 3) && event.button === 2) {
      draggingCore = true; dragPointerId = event.pointerId;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault(); event.stopPropagation();
      if (DESKTOP_WIDGET) setWidgetInput(true);
      return;
    }
    if (event.button === 0 && (!DESKTOP_WIDGET || nearCore(point, 13))) {
      viewDrag = { pointerId: event.pointerId, x: point.x, y: point.y, viewYaw: data.visual.viewYaw, viewPitch: data.visual.viewPitch, startOnCore: nearCore(point, 3), moved: false };
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      if (DESKTOP_WIDGET) setWidgetInput(true);
      event.preventDefault();
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") return;
    if (event.pointerId === dragPointerId) finishDrag();
    finishViewDrag(event.pointerId);
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "touch") return;
    if (event.pointerId === dragPointerId) finishDrag();
    finishViewDrag(event.pointerId);
  });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (event.pointerType === "touch") return;
    if (event.pointerId === dragPointerId) finishDrag();
    finishViewDrag(event.pointerId);
  });
  canvas.addEventListener("contextmenu", (event) => { if (nearCore(pointerPoint(event), 5)) event.preventDefault(); });
  canvas.addEventListener("pointerleave", () => { if (!draggingCore && !viewDrag && !touchGesture && DESKTOP_WIDGET) setWidgetInput(false); });
  document.addEventListener("touchstart", beginTouchGesture, { passive: false, capture: true });
  document.addEventListener("touchmove", moveTouchGesture, { passive: false, capture: true });
  document.addEventListener("touchend", finishTouchGesture, { passive: false, capture: true });
  document.addEventListener("touchcancel", finishTouchGesture, { passive: false, capture: true });

  byId("panelContent").addEventListener("click", (event) => { const button = event.target.closest("[data-action]"); if (button) handleAction(button); });
  byId("panelContent").addEventListener("input", handleInput);
  byId("panelContent").addEventListener("change", handleChange);
  byId("panelContent").addEventListener("submit", handleSubmit);
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  byId("syncWidget").addEventListener("click", syncWidget);
  byId("panelClose").addEventListener("click", () => {
    const panel = byId("controlPanel");
    const collapsed = panel.classList.toggle("is-collapsed");
    data.panelCollapsed = collapsed; save();
    byId("panelClose").textContent = collapsed ? "⌄" : "⌃";
    byId("panelClose").setAttribute("aria-label", collapsed ? "Rouvrir le panneau" : "Réduire le panneau");
  });
  const panelHeader = byId("panelHeader");
  panelHeader.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = byId("controlPanel").getBoundingClientRect();
    panelDrag = { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, x: (rect.left + rect.width / 2) / Math.max(1, window.innerWidth), y: (rect.top + rect.height / 2) / Math.max(1, window.innerHeight) };
    try { panelHeader.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  });
  panelHeader.addEventListener("pointermove", movePanel);
  panelHeader.addEventListener("pointerup", finishPanelDrag);
  panelHeader.addEventListener("pointercancel", finishPanelDrag);
  panelHeader.addEventListener("lostpointercapture", finishPanelDrag);
  byId("taskImport").addEventListener("change", (event) => { readImportFile(event.target.files?.[0]).catch(() => showToast("Le fichier n’a pas pu être lu.")); event.target.value = ""; });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (action === "close-focus") handleAction(button);
    if (action === "apply-import") applyImport();
    if (action === "close-import") importDialog?.close();
  });
  window.addEventListener("resize", () => { resizeCanvas(); applyPanelPosition(); }, { passive: true });

  if (window.qgScene) {
    window.qgScene.onSceneState((snapshot) => {
      if (!snapshot) return;
      if (Array.isArray(snapshot.subjects) && snapshot.subjects.length) data.subjects = snapshot.subjects.map(cleanSubject);
      else if (Array.isArray(snapshot.categories) && snapshot.categories.length) data.subjects = snapshot.categories.map((item) => Array.isArray(item) ? cleanSubject({ id: item[0], name: item[1], color: item[3] }) : cleanSubject(item));
      currentTasksSnapshot = Array.isArray(snapshot.tasks) ? snapshot.tasks.map((task) => cleanTask(task, data.subjects)) : [];
      const settings = snapshot.settings || {};
      motionPreference = settings.motion === "reduced" ? "reduced" : "measured";
      if (settings.visual) data.visual = cleanVisual({ ...data.visual, ...settings.visual });
      if (settings.widgetPosition && Number.isFinite(settings.widgetPosition.x)) data.visual.center = cleanVisual({ ...data.visual, center: settings.widgetPosition }).center;
      if (Number.isFinite(settings.opacity)) document.documentElement.style.setProperty("--desktop-widget-opacity", clamp(settings.opacity, .25, 1));
      coreCurrent = { ...data.visual.center }; coreTarget = { ...data.visual.center }; resizeCanvas();
    });
    if (DESKTOP_WIDGET) document.documentElement.classList.add("desktop-widget");
  }

  resizeCanvas(); render();
  if (!DESKTOP_WIDGET) setInterval(() => {
    updateHeader();
    document.querySelectorAll("[data-planet-card]").forEach((card) => {
      const task = data.tasks.find((item) => item.id === card.dataset.planetCard);
      if (!task) return;
      const timer = card.querySelector(".planet-timer");
      if (timer) timer.textContent = timeLabel(task);
      card.classList.toggle("is-elapsed", taskPhase(task) === "elapsed");
      card.classList.toggle("is-done", ["done", "archived"].includes(task.status));
    });
  }, 1000);
  requestAnimationFrame(drawFrame);
})();
