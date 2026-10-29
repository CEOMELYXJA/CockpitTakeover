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
  const DEFAULT_SUBJECTS = [
    { id: "work", name: "Travail", description: "Projets, clients et tâches professionnelles.", color: "#b18b5e", size: 1, durationMinutes: 35 },
    { id: "home", name: "Maison", description: "Entretien, organisation et vie quotidienne.", color: "#98856c", size: 1, durationMinutes: 25 },
    { id: "care", name: "Bien-être", description: "Repos, santé et soins personnels.", color: "#858b91", size: 1, durationMinutes: 20 },
    { id: "create", name: "Création", description: "Idées, fabrication et expression visuelle.", color: "#9a6f64", size: 1, durationMinutes: 40 },
    { id: "admin", name: "Administration", description: "Messages, formulaires et démarches.", color: "#a49b81", size: 1, durationMinutes: 20 },
    { id: "personal", name: "Personnel", description: "Le reste de votre vie, à votre façon.", color: "#887968", size: 1, durationMinutes: 25 }
  ];
  const DEFAULT_VISUAL = { planetCount: 8, planetScale: 1, speed: 0.72, stars: 30, showOrbits: true, center: { x: 0.5, y: 0.53 } };
  const DEFAULT_STATE = { version: 1, view: "tasks", taskFilter: "open", subjects: DEFAULT_SUBJECTS.map((item) => ({ ...item })), tasks: [], visual: structuredClone(DEFAULT_VISUAL), lastSync: 0 };

  function cleanSubject(value) {
    const input = value && typeof value === "object" ? value : {};
    return {
      id: /^[a-zA-Z0-9_-]{1,60}$/.test(String(input.id || "")) ? String(input.id) : makeId(),
      name: String(input.name || "Sujet sans nom").trim().slice(0, 48) || "Sujet sans nom",
      description: String(input.description || "").trim().slice(0, 260),
      color: /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : "#b18b5e",
      size: clamp(input.size ?? 1, 0.55, 1.65),
      durationMinutes: clamp(input.durationMinutes ?? 25, 5, 1440)
    };
  }

  function cleanTask(value, subjects) {
    const input = value && typeof value === "object" ? value : {};
    const legacySubject = subjects.find((subject) => subject.id === input.subjectId) || null;
    const defaultSubject = legacySubject && DEFAULT_SUBJECTS.find((subject) => subject.id === legacySubject.id);
    const oldDefaultColors = { work: "#9bb7ac", home: "#b89e79", care: "#9eafc1", create: "#c08f8b", admin: "#b7aa83", personal: "#aa9bb7" };
    const migratedColor = legacySubject && defaultSubject && legacySubject.color.toLowerCase() === oldDefaultColors[legacySubject.id] ? defaultSubject.color : legacySubject?.color;
    const validSubject = legacySubject ? legacySubject.id : null;
    const status = ["queued", "active", "done", "archived"].includes(input.status) ? input.status : "queued";
    const number = (item) => Number.isFinite(Number(item)) ? Number(item) : null;
    return {
      id: /^[a-zA-Z0-9_-]{1,80}$/.test(String(input.id || "")) ? String(input.id) : makeId(),
      title: String(input.title || "").trim().slice(0, 180),
      description: String(input.description || input.doneWhen || "").trim().slice(0, 700),
      subjectId: validSubject,
      topicName: String(input.topicName || input.categoryName || legacySubject?.name || "").trim().slice(0, 48),
      planetColor: /^#[0-9a-fA-F]{6}$/.test(input.planetColor || input.color) ? (input.planetColor || input.color) : migratedColor || "#b18b5e",
      planetSize: clamp(input.planetSize ?? legacySubject?.size ?? 1, 0.55, 1.65),
      status,
      durationMinutes: clamp(input.durationMinutes ?? input.minutes ?? 25, 5, 1440),
      priority: [1, 2, 3].includes(Number(input.priority)) ? Number(input.priority) : 2,
      createdAt: number(input.createdAt) || now(),
      startedAt: number(input.startedAt),
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
      center: { x: clamp(center.x ?? 0.5, 0.08, 0.92), y: clamp(center.y ?? 0.53, 0.1, 0.9) }
    };
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || raw.version !== 1 || !Array.isArray(raw.subjects) || !Array.isArray(raw.tasks)) return structuredClone(DEFAULT_STATE);
      const subjects = raw.subjects.slice(0, 24).map(cleanSubject);
      const seen = new Set();
      const uniqueSubjects = subjects.filter((subject) => { if (seen.has(subject.id)) subject.id = makeId(); seen.add(subject.id); return true; });
      const tasks = raw.tasks.slice(0, 500).map((task) => cleanTask(task, uniqueSubjects)).filter((task) => task.title);
      return { ...structuredClone(DEFAULT_STATE), view: "tasks", taskFilter: ["open", "elapsed", "done", "all"].includes(raw.taskFilter) ? raw.taskFilter : "open", subjects: uniqueSubjects, tasks, visual: cleanVisual(raw.visual), lastSync: Number(raw.lastSync) || 0 };
    } catch (_) { return structuredClone(DEFAULT_STATE); }
  }

  let data = loadState();
  let toastTimer = 0;
  let pendingImport = [];
  let importDialog = null;
  let taskDialog = null;
  let inputCapture = false;
  let draggingCore = false;
  let dragPointerId = null;
  let coreCurrent = { ...data.visual.center };
  let coreTarget = { ...data.visual.center };
  let coreHit = { x: 0, y: 0, radius: 0 };
  let width = 1, height = 1, ratio = 1, lastDraw = 0, lastPositionSent = 0;
  let currentTasksSnapshot = [];
  let motionPreference = "measured";
  const canvas = byId("universeCanvas");
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  let stars = [];

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
    if (task.status !== "active" || !task.startedAt) return "queued";
    return timestamp >= task.startedAt + task.durationMinutes * 60_000 ? "elapsed" : "running";
  }
  function taskDeadline(task) { return task.startedAt ? task.startedAt + task.durationMinutes * 60_000 : null; }
  function formatClock(timestamp) { return new Intl.DateTimeFormat("fr-CA", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)); }
  function formatRemaining(milliseconds) {
    const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60), remainder = minutes % 60;
    return remainder ? `${hours} h ${String(remainder).padStart(2, "0")}` : `${hours} h`;
  }
  function timeLabel(task, timestamp = now()) {
    const phase = taskPhase(task, timestamp);
    if (phase === "queued") return "En attente";
    if (phase === "done") return "Terminée";
    if (phase === "archived") return "Archivée";
    if (phase === "elapsed") return `Écoulé · ${formatClock(taskDeadline(task))}`;
    return `${formatRemaining(taskDeadline(task) - timestamp)} restantes`;
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
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "tasks"));
    byId("panelKicker").textContent = "VOTRE CARTE PERSONNELLE";
    byId("panelTitle").textContent = "Mes planètes";
    byId("panelContent").innerHTML = renderTasksView();
    updateHeader();
  }

  function renderTasksView() {
    const filter = data.taskFilter;
    const filtered = data.tasks.filter((task) => {
      const phase = taskPhase(task);
      if (filter === "open") return !["done", "archived"].includes(task.status);
      if (filter === "elapsed") return phase === "elapsed";
      if (filter === "done") return task.status === "done";
      return true;
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return `<p class="section-intro">Chaque rappel est sa propre planète. Son sujet, sa couleur, sa taille et son temps se règlent ensemble, sur sa fiche.</p><section class="panel-section new-planet-section"><h3 class="section-title">Ajouter une planète</h3><form id="taskForm" class="form-grid"><label class="field wide">Action ou tâche<input name="title" maxlength="180" required placeholder="Ex. Confirmer la date avec la cliente"></label><label class="field wide">Détail utile<textarea name="description" maxlength="700" placeholder="Première étape, contexte ou résultat attendu"></textarea></label><label class="field">Sujet (facultatif)<input name="topicName" maxlength="48" placeholder="Ex. Boutique, santé, maison"></label><label class="field">Temps accordé en minutes<input name="durationMinutes" type="number" min="5" max="1440" value="25" required></label><label class="field planet-color-field">Couleur<input name="planetColor" type="color" value="#b18b5e"></label><label class="field planet-size-field">Taille <span class="field-value" data-new-size-output>100%</span><input name="planetSize" type="range" min="0.55" max="1.65" step="0.05" value="1"></label><label class="field wide"><span class="inline-row"><input name="startNow" type="checkbox" checked><span>La démarrer maintenant et la faire tourner sur la carte</span></span></label><button class="primary-button wide" type="submit">＋ Ajouter à ma carte</button></form><button class="file-label import-button" type="button" data-action="import-file">Importer un fichier .txt, .md ou .json</button></section><section class="panel-section planet-list-section"><div class="list-heading"><h3 class="section-title">Ma liste <small>${data.tasks.length} planète${data.tasks.length === 1 ? "" : "s"}</small></h3><label class="filter-select-label">Afficher<select data-task-filter><option value="open" ${filter === "open" ? "selected" : ""}>À traiter</option><option value="elapsed" ${filter === "elapsed" ? "selected" : ""}>Temps écoulé</option><option value="done" ${filter === "done" ? "selected" : ""}>Terminées</option><option value="all" ${filter === "all" ? "selected" : ""}>Toutes</option></select></label></div>${filtered.map(taskCard).join("") || `<div class="empty-card"><b>Aucune planète dans cette vue</b>Ajoutez une tâche ici ou importez votre liste. Les catégories importées deviennent des sujets modifiables sur chaque planète.</div>`}</section><details class="settings-disclosure"><summary>Réglages de la carte</summary><div class="settings-body">${renderAppearanceView()}</div></details><p class="sync-note">Après vos changements, cliquez sur <b>Synchroniser le widget</b> en haut. Votre copie locale est enregistrée dans Téléchargements.</p>`;
  }

  function taskCard(task) {
    const legacy = subjectById(task.subjectId);
    const phase = taskPhase(task);
    const elapsed = phase === "elapsed";
    const done = phase === "done" || phase === "archived";
    const color = task.planetColor || legacy?.color || "#b18b5e";
    const note = elapsed ? `Le délai s’est écoulé à ${formatClock(taskDeadline(task))}. La tâche reste ouverte.` : task.description;
    const action = task.status === "queued" ? `<button class="small-button primary" data-action="start-task" data-id="${escapeHtml(task.id)}">Démarrer</button>` : elapsed ? `<button class="small-button primary" data-action="restart-task" data-id="${escapeHtml(task.id)}">Reprendre ${task.durationMinutes} min</button>` : task.status === "active" ? `<button class="small-button" data-action="complete-task" data-id="${escapeHtml(task.id)}">Terminer</button>` : `<button class="small-button" data-action="restore-task" data-id="${escapeHtml(task.id)}">Rouvrir</button>`;
    return `<article class="planet-card ${elapsed ? "is-elapsed" : ""} ${done ? "is-done" : ""}" data-planet-card="${escapeHtml(task.id)}"><div class="planet-card-head"><span class="planet-swatch" style="--planet-color:${color}"></span><div class="planet-card-name"><h4>${escapeHtml(task.title)}</h4><span>${escapeHtml(task.topicName || legacy?.name || "Sans sujet")}</span></div><span class="planet-timer">${escapeHtml(timeLabel(task))}</span></div><div class="planet-card-meta"><span>${task.durationMinutes} min prévues</span>${task.startedAt ? `<span>Démarrée ${formatClock(task.startedAt)}</span>` : ""}</div>${note ? `<p class="planet-note">${escapeHtml(note)}</p>` : ""}${elapsed ? `<label class="field planet-reason-field">Qu’est-ce qui bloque ou reste à faire ?<textarea data-task-field="reason" data-id="${escapeHtml(task.id)}" maxlength="300" placeholder="Une note pour reprendre plus facilement">${escapeHtml(task.reason)}</textarea></label>` : task.reason ? `<p class="planet-note"><b>Note :</b> ${escapeHtml(task.reason)}</p>` : ""}<div class="planet-actions">${action}<button class="small-button archive-button" data-action="archive-task" data-id="${escapeHtml(task.id)}">Archiver</button></div><details class="planet-editor"><summary>Modifier cette planète</summary><div class="form-grid planet-editor-fields"><label class="field wide">Action ou tâche<input data-task-field="title" data-id="${escapeHtml(task.id)}" maxlength="180" value="${escapeHtml(task.title)}"></label><label class="field">Sujet (facultatif)<input data-task-field="topicName" data-id="${escapeHtml(task.id)}" maxlength="48" value="${escapeHtml(task.topicName || legacy?.name || "")}" placeholder="Ex. Boutique, santé, maison"></label><label class="field">Temps accordé en minutes<input data-task-field="durationMinutes" data-id="${escapeHtml(task.id)}" type="number" min="5" max="1440" value="${task.durationMinutes}"></label><label class="field planet-color-field">Couleur<input data-task-field="planetColor" data-id="${escapeHtml(task.id)}" type="color" value="${color}"></label><label class="field planet-size-field">Taille<input data-task-field="planetSize" data-id="${escapeHtml(task.id)}" type="range" min="0.55" max="1.65" step="0.05" value="${task.planetSize || legacy?.size || 1}"></label><label class="field wide">Détail ou résultat attendu<textarea data-task-field="description" data-id="${escapeHtml(task.id)}" maxlength="700">${escapeHtml(task.description)}</textarea></label><label class="field wide">Note pour reprendre plus tard<textarea data-task-field="reason" data-id="${escapeHtml(task.id)}" maxlength="300">${escapeHtml(task.reason)}</textarea></label></div></details></article>`;
  }
  function renderSubjectsView() {
    const cards = data.subjects.map((subject) => {
      const assigned = data.tasks.filter((task) => task.subjectId === subject.id).length;
      return `<article class="subject-card" data-subject-card="${escapeHtml(subject.id)}"><div class="subject-card-head"><input data-subject-field="color" data-id="${escapeHtml(subject.id)}" type="color" value="${subject.color}" aria-label="Couleur de ${escapeHtml(subject.name)}"><input data-subject-field="name" data-id="${escapeHtml(subject.id)}" type="text" maxlength="48" value="${escapeHtml(subject.name)}" aria-label="Nom du sujet"><button class="icon-action" data-action="delete-subject" data-id="${escapeHtml(subject.id)}" aria-label="Supprimer le sujet ${escapeHtml(subject.name)}" title="Supprimer">×</button></div><label class="field">Description — pour vous rappeler ce que cette couleur signifie<textarea data-subject-field="description" data-id="${escapeHtml(subject.id)}" maxlength="260" placeholder="Ce que ce sujet comprend">${escapeHtml(subject.description)}</textarea></label><div class="form-grid" style="margin-top:8px"><label class="field">Taille de ses planètes<input data-subject-field="size" data-id="${escapeHtml(subject.id)}" type="range" min="0.55" max="1.65" step="0.05" value="${subject.size}"></label><label class="field">Durée proposée<input data-subject-field="durationMinutes" data-id="${escapeHtml(subject.id)}" type="number" min="5" max="1440" value="${subject.durationMinutes}"></label></div><p class="subtle">${assigned} rappel${assigned === 1 ? "" : "s"} lié${assigned === 1 ? "" : "s"}. Supprimer ce sujet remet ces rappels dans « À classer ».</p></article>`;
    }).join("");
    return `<p class="section-intro">Vous choisissez ce que chaque couleur représente. Les sujets ne sont jamais assignés automatiquement; les rappels incertains restent à classer.</p>${cards}<button class="secondary-button full-button" data-action="add-subject">＋ Ajouter un sujet</button>`;
  }

  function renderAppearanceView() {
    const v = data.visual;
    return `<section class="panel-section"><h3 class="section-title">Mouvement et densité</h3><label class="view-row"><span>Planètes visibles<small>Nombre de rappels qui tournent en même temps.</small></span><input data-visual="planetCount" type="range" min="1" max="16" step="1" value="${v.planetCount}"><output data-output="planetCount">${v.planetCount}</output></label><label class="view-row"><span>Taille générale<small>S’ajoute à la taille définie sur chaque planète.</small></span><input data-visual="planetScale" type="range" min="0.55" max="1.65" step="0.05" value="${v.planetScale}"><output data-output="planetScale">${Math.round(v.planetScale * 100)}%</output></label><label class="view-row"><span>Vitesse orbitale<small>Elle reste la même quand le widget passe en arrière-plan.</small></span><input data-visual="speed" type="range" min="0.2" max="1.8" step="0.05" value="${v.speed}"><output data-output="speed">${v.speed.toFixed(2)}×</output></label><label class="view-row"><span>Tracés orbitaux<small>Lignes fines inspirées des cartes stellaires anciennes.</small></span><input class="switch" data-visual="showOrbits" type="checkbox" ${v.showOrbits ? "checked" : ""}></label><label class="view-row"><span>Mini étoiles blanches<small>Petits points discrets sur le fond noir.</small></span><select data-visual="stars"><option value="18" ${v.stars === 18 ? "selected" : ""}>Très peu</option><option value="30" ${v.stars === 30 ? "selected" : ""}>Discret</option><option value="46" ${v.stars === 46 ? "selected" : ""}>Un peu plus</option><option value="64" ${v.stars === 64 ? "selected" : ""}>Dense</option></select></label></section><section class="panel-section"><h3 class="section-title">Placement du centre</h3><p class="subtle">Maintenez le clic droit sur la planète centrale et faites-la glisser. Toute la carte la suit en douceur. Le widget Windows ne capte pas les clics en dehors de cette planète.</p><button class="secondary-button full-button" data-action="center-reset">Recentrer la carte</button></section>`;
  }
  function updateHeader() {
    const active = data.tasks.filter((task) => task.status === "active");
    const running = active.filter((task) => taskPhase(task) === "running").length;
    const elapsed = active.length - running;
    byId("activeCount").textContent = String(running);
    byId("sceneStatus").textContent = running ? `${running} RAPPEL${running === 1 ? "" : "S"} EN MOUVEMENT${elapsed ? ` · ${elapsed} ÉCOULÉ${elapsed === 1 ? "" : "S"}` : ""}` : "SYSTÈME CALME · EN ATTENTE DE VOS RAPPELS";
    byId("sceneHeading").textContent = running ? "Votre attention en mouvement" : "La carte de votre journée";
    byId("sceneSubheading").textContent = running ? "À mesure que le temps passe, chaque planète se rapproche du centre." : "Chaque rappel prend sa place. Rien n’est classé sans vous.";
    const badge = byId("syncBadge");
    badge.textContent = data.lastSync ? `Copie locale · ${formatClock(data.lastSync)}` : "Widget non synchronisé";
    badge.title = data.lastSync ? `Fichier créé à ${formatClock(data.lastSync)} dans Téléchargements` : "Synchronisez une fois pour transmettre rappels et apparence au widget";
  }

  function setView(view) {
    if (view !== "tasks") return;
    data.view = "tasks"; save(); render();
    document.querySelector(".main-nav")?.classList.remove("is-open");
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

  function openTaskDialog(taskId = null) {
    if (!taskDialog) createTaskDialog();
    const task = data.tasks.find((item) => item.id === taskId) || null;
    taskDialog.dataset.taskId = task?.id || "";
    byId("editTaskTitle").value = task?.title || "";
    byId("editTaskDescription").value = task?.description || "";
    byId("editTaskSubject").innerHTML = `<option value="">À classer</option>${data.subjects.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("")}`;
    byId("editTaskSubject").value = task?.subjectId || "";
    byId("editTaskDuration").value = String(task?.durationMinutes || 25);
    byId("editTaskReason").value = task?.reason || "";
    byId("editTaskReasonWrap").hidden = !task || taskPhase(task) !== "elapsed";
    byId("editTaskDialogTitle").textContent = task ? "Détail du rappel" : "Nouveau rappel";
    taskDialog.showModal();
  }

  function createTaskDialog() {
    taskDialog = document.createElement("dialog");
    taskDialog.id = "taskDialog";
    taskDialog.innerHTML = `<form id="editTaskForm" method="dialog"><header class="dialog-head"><div><h2 id="editTaskDialogTitle">Détail du rappel</h2><p>Clarifiez l’action, son sujet et le temps que vous voulez lui consacrer.</p></div><button class="dialog-close" type="button" data-action="close-task-dialog" aria-label="Fermer">×</button></header><div class="dialog-body form-grid"><label class="field wide">Action<input id="editTaskTitle" maxlength="180" required></label><label class="field wide">Détail / résultat attendu<textarea id="editTaskDescription" maxlength="700"></textarea></label><label class="field">Sujet<select id="editTaskSubject"></select></label><label class="field">Temps de rappel en minutes<input id="editTaskDuration" type="number" min="5" max="1440" value="25" required></label><label id="editTaskReasonWrap" class="field wide" hidden>Pourquoi le temps s’est écoulé ? (facultatif)<textarea id="editTaskReason" maxlength="300"></textarea></label><div class="inline-row wide"><button class="primary-button" type="submit">Enregistrer</button><button class="secondary-button" type="button" data-action="close-task-dialog">Annuler</button></div></div></form>`;
    document.body.appendChild(taskDialog);
    taskDialog.addEventListener("click", (event) => { if (event.target === taskDialog) taskDialog.close(); });
    byId("editTaskForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const id = taskDialog.dataset.taskId;
      const task = data.tasks.find((item) => item.id === id);
      const patch = { title: byId("editTaskTitle").value, description: byId("editTaskDescription").value, subjectId: byId("editTaskSubject").value || null, durationMinutes: clamp(byId("editTaskDuration").value, 5, 1440), reason: byId("editTaskReason").value };
      if (task) Object.assign(task, patch);
      else data.tasks.unshift(cleanTask({ ...patch, status: "queued" }, data.subjects));
      save(); taskDialog.close(); render();
    });
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
      if (taskPhase(task) === "running") statusText = `Échéance du rappel : ${formatClock(deadline)} · ${timeLabel(task)}`;
      else if (taskPhase(task) === "elapsed") statusText = `Temps écoulé à ${formatClock(deadline)} · tâche toujours ouverte`;
      else if (task.status === "done") statusText = task.completedAt ? `Terminée à ${formatClock(task.completedAt)}` : "Terminée";
      else statusText = "En attente de démarrage";
      return `<article class="modal-task"><strong><span style="color:${task.planetColor || "#b18b5e"}">●</span> ${escapeHtml(task.title)}</strong><small>${escapeHtml(task.topicName || "Sans sujet")}</small><small>${escapeHtml(statusText)}</small><p>${escapeHtml(task.description || "Aucun détail ajouté.")}${task.reason ? `<br><b>Note :</b> ${escapeHtml(task.reason)}` : ""}</p></article>`;
    }).join("") : `<p class="modal-empty">${emptyText}</p>`}`;
    dialog.innerHTML = `<header class="dialog-head"><div><p class="eyebrow">LE CENTRE DE VOTRE CARTE</p><h2>État des rappels</h2><p>Un délai écoulé ne termine jamais la tâche à votre place.</p></div><button class="dialog-close" type="button" data-action="close-focus" aria-label="Fermer">×</button></header><div class="dialog-body">${group("En orbite", running, "Aucun rappel actif.")}${elapsed.length ? group("Temps écoulé — toujours à traiter", elapsed) : ""}${queued.length ? group("En attente", queued) : ""}${completed.length ? group("Terminées récemment", completed) : ""}</div>`;
    dialog.showModal();
  }

  function addSubject() {
    if (data.subjects.length >= 24) return showToast("Vous pouvez définir jusqu’à 24 sujets.");
    const subject = cleanSubject({ id: makeId(), name: "Nouveau sujet", description: "", color: "#b18b5e", durationMinutes: 25 });
    data.subjects.push(subject); save(); render();
    const input = document.querySelector(`[data-subject-field="name"][data-id="${CSS.escape(subject.id)}"]`);
    input?.focus(); input?.select();
  }

  function removeSubject(id) {
    const subject = subjectById(id); if (!subject) return;
    const affected = data.tasks.filter((task) => task.subjectId === id).length;
    const message = affected ? `Supprimer « ${subject.name} » ? Ses ${affected} rappel${affected === 1 ? "" : "s"} resteront dans la liste, classés « À classer ».` : `Supprimer « ${subject.name} » ?`;
    if (!window.confirm(message)) return;
    data.subjects = data.subjects.filter((item) => item.id !== id);
    data.tasks.forEach((task) => { if (task.subjectId === id) task.subjectId = null; });
    save(); render();
  }

  function startTask(id, restart = false) {
    const task = data.tasks.find((item) => item.id === id); if (!task) return;
    task.status = "active"; task.startedAt = now(); task.completedAt = null;
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
      case "edit-task": openTaskDialog(id); break;
      case "filter": data.taskFilter = button.dataset.filter; save(); render(); break;
      case "add-subject": addSubject(); break;
      case "delete-subject": removeSubject(id); break;
      case "center-reset": data.visual.center = { x: 0.5, y: 0.53 }; coreTarget = { ...data.visual.center }; save(); if (DESKTOP_WIDGET) window.qgScene?.saveWidgetPosition?.(data.visual.center); else showToast("La carte est recentrée."); break;
      case "sync-widget": syncWidget(); break;
      case "import-file": byId("taskImport").click(); break;
      case "close-task-dialog": taskDialog?.close(); break;
      case "close-focus": byId("focusDialog")?.close(); break;
    }
  }

  function handleInput(event) {
    const input = event.target;
    if (input.matches("[data-visual]")) {
      const key = input.dataset.visual;
      data.visual[key] = input.type === "checkbox" ? input.checked : Number(input.value);
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
      if (key === "durationMinutes") task[key] = clamp(input.value, 5, 1440);
      else if (key === "planetSize") task[key] = clamp(input.value, 0.55, 1.65);
      else task[key] = input.value;
      if (key === "topicName") task.subjectId = null;
      const card = input.closest("[data-planet-card]");
      if (key === "planetColor") card?.querySelector(".planet-swatch")?.style.setProperty("--planet-color", task.planetColor);
      if (key === "planetSize") {
        const output = input.closest(".field")?.querySelector(".field-value");
        if (output) output.textContent = `${Math.round(task.planetSize * 100)}%`;
      }
      if (input.name === "planetSize") {
        const output = input.closest(".field")?.querySelector(".field-value");
        if (output) output.textContent = `${Math.round(Number(input.value) * 100)}%`;
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
      if (input.dataset.taskField === "topicName") { const topic = card?.querySelector(".planet-card-name span"); if (topic) topic.textContent = task.topicName || "Sans sujet"; }
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
      durationMinutes: formData.get("durationMinutes"), priority: 2,
      status: formData.get("startNow") ? "active" : "queued", startedAt: formData.get("startNow") ? now() : null, createdAt: now()
    }, data.subjects);
    if (!task.title) return;
    data.tasks.unshift(task); save(); render(); showToast("Planète ajoutée à votre carte.");
  }
  function createImportDialog() {
    importDialog = document.createElement("dialog"); importDialog.id = "importDialog";
    importDialog.innerHTML = `<header class="dialog-head"><div><p class="eyebrow">IMPORTATION AVANT AJOUT</p><h2>Aperçu de votre fichier</h2><p>Les titres de section deviennent le sujet de chaque planète. Les tâches existantes ne sont pas remplacées.</p></div><button class="dialog-close" type="button" data-action="close-import" aria-label="Fermer">×</button></header><div class="dialog-body"><p id="importSummary" class="subtle"></p><div class="import-preview"><ul id="importRows"></ul></div><div class="empty-actions"><button class="primary-button" type="button" data-action="apply-import">Ajouter ces rappels</button><button class="secondary-button" type="button" data-action="close-import">Annuler</button></div></div>`;
    document.body.appendChild(importDialog);
    importDialog.addEventListener("click", (event) => { if (event.target === importDialog) importDialog.close(); });
  }

  function parseImportText(text, fileName) {
    let raw;
    try { raw = JSON.parse(text); } catch (_) { raw = null; }
    if (raw && Array.isArray(raw.tasks)) {
      return raw.tasks.slice(0, 500).map((item) => {
        const input = item || {};
        const subject = data.subjects.find((s) => s.id === input.subjectId) || data.subjects.find((s) => normalize(s.name) === normalize(input.categoryName || ""));
        return cleanTask({ title: input.title, description: input.description || input.doneWhen || "", subjectId: subject?.id || null, topicName: input.topicName || input.categoryName || subject?.name || "", planetColor: input.planetColor || input.color, planetSize: input.planetSize ?? subject?.size, durationMinutes: input.durationMinutes || input.minutes || subject?.durationMinutes || 25, reason: input.reason || "", status: input.status === "done" ? "done" : "queued", priority: input.priority, createdAt: now() }, data.subjects);
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
      result.push(cleanTask({ title: line, subjectId: currentSubject?.id || null, topicName: currentTopicName, durationMinutes: currentSubject?.durationMinutes || 25, status: done ? "done" : "queued", createdAt: now(), source: fileName }, data.subjects));
      if (result.length >= 500) break;
    }
    return result;
  }

  function showImportPreview(tasks, fileName) {
    if (!importDialog) createImportDialog();
    pendingImport = tasks.filter((task) => task.title);
    byId("importSummary").textContent = `${pendingImport.length} rappel${pendingImport.length === 1 ? "" : "s"} trouvé${pendingImport.length === 1 ? "" : "s"} dans « ${fileName} ». Chaque sujet importé reste modifiable sur sa planète.`;
    byId("importRows").innerHTML = pendingImport.slice(0, 24).map((task) => `<li>${escapeHtml(task.title)} <span class="subtle">· ${escapeHtml(task.topicName || "Sans sujet")}</span></li>`).join("") + (pendingImport.length > 24 ? `<li>… et ${pendingImport.length - 24} autres</li>` : "");
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
    pendingImport = []; save(); importDialog.close(); render(); showToast(`${added} rappel${added === 1 ? " ajouté" : "s ajoutés"}; les doublons ont été ignorés.`);
  }

  function createStars() {
    const total = Math.round(clamp(data.visual.stars, 12, 64));
    stars = Array.from({ length: total }, (_, index) => ({ x: Math.random(), y: Math.random(), size: 0.38 + Math.random() * 0.85, phase: Math.random() * TAU, alpha: 0.18 + Math.random() * 0.4, slow: 0.5 + Math.random() * 1.1, index }));
  }

  function resizeCanvas() {
    ratio = Math.min(window.devicePixelRatio || 1, DESKTOP_WIDGET ? 1.8 : 2);
    width = Math.max(1, canvas.clientWidth || window.innerWidth);
    height = Math.max(1, canvas.clientHeight || window.innerHeight);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (DESKTOP_WIDGET) updateHitArea();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawStars(timestamp) {
    stars.forEach((star) => {
      const twinkle = 0.57 + 0.43 * Math.sin(timestamp * 0.00055 * star.slow + star.phase);
      const x = star.x * width, y = star.y * height, radius = star.size * (0.8 + 0.2 * twinkle);
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = "#f5f5ef"; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function coreGeometry() {
    const center = coreCurrent;
    const radius = clamp(Math.min(width, height) * 0.055, 35, 71) * data.visual.planetScale;
    return { x: width * center.x, y: height * center.y, radius };
  }

  function drawOrbit(cx, cy, radiusX, radiusY, phase, color, alpha) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(phase);
    ctx.beginPath(); ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, TAU);
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 0.75; ctx.setLineDash([1, 4]); ctx.lineDashOffset = -lastDraw * 0.003; ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
  }

  function drawCore(core, timestamp, urgency) {
    const reduced = motionPreference === "reduced";
    const pulseRate = (urgency > 0.72 ? 1.2 : 0.46) * (reduced ? 0.45 : 1);
    const pulseAmount = (urgency > 0.72 ? 0.026 : 0.009) * (reduced ? 0.5 : 1);
    const radius = core.radius * (1 + pulseAmount * Math.sin(timestamp * 0.001 * TAU * pulseRate));
    const halo = ctx.createRadialGradient(core.x, core.y, radius * 0.35, core.x, core.y, radius * 2.45);
    halo.addColorStop(0, "rgba(177,139,94,.12)"); halo.addColorStop(.5, "rgba(133,111,84,.035)"); halo.addColorStop(1, "rgba(133,111,84,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(core.x, core.y, radius * 2.45, 0, TAU); ctx.fill();

    const surface = ctx.createRadialGradient(core.x - radius * .38, core.y - radius * .42, radius * .04, core.x + radius * .24, core.y + radius * .22, radius * 1.28);
    surface.addColorStop(0, "#887966"); surface.addColorStop(.42, "#62594c"); surface.addColorStop(.78, "#37332e"); surface.addColorStop(1, "#1a1917");
    ctx.save(); ctx.shadowColor = "rgba(148,118,82,.16)"; ctx.shadowBlur = radius * .18;
    ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(core.x, core.y, radius, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); ctx.beginPath(); ctx.arc(core.x, core.y, radius * .99, 0, TAU); ctx.clip();
    ctx.globalAlpha = .13; ctx.fillStyle = "#c3ad8a";
    [[-.34,-.28,.16], [.27,-.47,.075], [.42,.12,.11], [-.2,.37,.09], [-.53,.17,.05]].forEach(([dx,dy,size]) => {
      const x = core.x + radius * dx, y = core.y + radius * dy, r = radius * size;
      ctx.beginPath(); ctx.arc(x - r * .12, y - r * .14, r, Math.PI * 1.08, Math.PI * 1.94); ctx.strokeStyle = "rgba(224,207,174,.22)"; ctx.lineWidth = Math.max(.7, radius * .018); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = "rgba(20,19,17,.2)"; ctx.fill();
      ctx.beginPath(); ctx.arc(x - r * .12, y - r * .18, r * .72, 0, TAU); ctx.fillStyle = "rgba(191,169,132,.055)"; ctx.fill();
    });
    ctx.globalAlpha = .09; ctx.fillStyle = "#171614";
    [[-.1,-.08,.24], [.35,.38,.16], [-.42,.45,.13], [.15,-.02,.1]].forEach(([dx,dy,size]) => { ctx.beginPath(); ctx.arc(core.x + radius * dx, core.y + radius * dy, radius * size, 0, TAU); ctx.fill(); });
    ctx.restore();
    ctx.strokeStyle = "rgba(199,176,140,.24)"; ctx.lineWidth = .9; ctx.beginPath(); ctx.arc(core.x, core.y, radius, -.9, 1.8); ctx.stroke();
    ctx.restore();
    coreHit = { x: core.x, y: core.y, radius: radius * 1.18 };
  }
  function drawTaskPlanet(task, index, activeTasks, core, timestamp, wallTime) {
    const subject = subjectById(task.subjectId);
    const color = task.planetColor || subject?.color || "#b18b5e";
    const phase = taskPhase(task, wallTime);
    const duration = Math.max(1, task.durationMinutes * 60_000);
    const progress = phase === "elapsed" ? 1 : clamp((wallTime - (task.startedAt || wallTime)) / duration, 0, 1);
    const orbitIndex = index + 1;
    const outer = Math.min(Math.min(width, height) * .44, core.radius + 84 + (orbitIndex % 4) * 34);
    const orbit = core.radius + 22 + (outer - core.radius - 22) * (1 - Math.pow(progress, 1.38));
    const direction = index % 2 ? -1 : 1;
    const speed = .00013 * data.visual.speed * (motionPreference === "reduced" ? 0.45 : 1) * (1 + index * .055) * direction;
    const angle = (index * 2.399963) + (task.startedAt || task.createdAt) * .000002 + timestamp * speed;
    const squash = .58 + (index % 3) * .08;
    const x = core.x + Math.cos(angle) * orbit;
    const y = core.y + Math.sin(angle) * orbit * squash + Math.sin(timestamp * .0004 + index) * 3;
    const distanceToDeadline = taskDeadline(task) ? Math.max(0, taskDeadline(task) - wallTime) : 0;
    const urgency = phase === "running" ? 1 - distanceToDeadline / duration : phase === "elapsed" ? 1 : 0;
    const heartbeatScale = motionPreference === "reduced" ? 0.5 : 1;
    const heartbeat = urgency > .72 ? 1 + .055 * heartbeatScale * Math.sin(timestamp * .0085) : 1 + .018 * heartbeatScale * Math.sin(timestamp * .0022 + index);
    const subjectSize = task.planetSize || subject?.size || 1;
    const radius = clamp((10 + Math.min(5, subjectSize * 3)) * data.visual.planetScale * subjectSize, 7, 27) * heartbeat;
    const ageAfter = taskDeadline(task) ? wallTime - taskDeadline(task) : 0;
    const absorbing = phase === "elapsed" && ageAfter >= 0 && ageAfter < 1750;
    const fade = absorbing ? 1 - ageAfter / 1750 : phase === "elapsed" ? 0 : 1;
    if (fade <= 0) return;
    ctx.save(); ctx.globalAlpha = fade;
    if (data.visual.showOrbits) {
      drawOrbit(core.x, core.y, outer, outer * squash, -.13 + index * .1, color, .17);
      ctx.beginPath(); ctx.ellipse(core.x, core.y, orbit, orbit * squash, -.13 + index * .1, 0, TAU); ctx.strokeStyle = color; ctx.globalAlpha = .18 * fade; ctx.lineWidth = .65; ctx.setLineDash([1, 7]); ctx.lineDashOffset = -timestamp * .008; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = fade;
    }
    if (absorbing) {
      const sink = ageAfter / 1750; const sx = x + (core.x - x) * sink; const sy = y + (core.y - y) * sink; const sr = radius * (1 - sink * .62);
      const trail = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.7); trail.addColorStop(0, `${color}66`); trail.addColorStop(1, `${color}00`); ctx.fillStyle = trail; ctx.beginPath(); ctx.arc(sx, sy, sr * 2.7, 0, TAU); ctx.fill();
      ctx.restore(); return;
    }
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.2); glow.addColorStop(0, `${color}45`); glow.addColorStop(.35, `${color}20`); glow.addColorStop(1, `${color}00`); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 3.2, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle * .16); ctx.beginPath(); ctx.ellipse(0, 0, radius * 1.85, radius * .59, 0, 0, TAU); ctx.strokeStyle = `${color}60`; ctx.lineWidth = Math.max(.55, radius * .07); ctx.stroke(); ctx.restore();
    ctx.shadowColor = `${color}88`; ctx.shadowBlur = 7 * data.visual.planetScale;
    const surface = ctx.createRadialGradient(x - radius * .38, y - radius * .44, .5, x + radius * .17, y + radius * .16, radius * 1.3);
    surface.addColorStop(0, "#f1ebdd"); surface.addColorStop(.1, color); surface.addColorStop(.58, color); surface.addColorStop(1, "#171c1f");
    ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius * .98, 0, TAU); ctx.clip(); ctx.globalAlpha = .17; ctx.strokeStyle = "#fff8e8"; ctx.lineWidth = Math.max(.4, radius * .035); ctx.beginPath(); ctx.ellipse(x - radius * .12, y, radius * .42, radius * .95, -.36, -.95, 1.15); ctx.stroke(); ctx.globalAlpha = .1; ctx.beginPath(); ctx.ellipse(x, y + radius * .13, radius * .95, radius * .23, -.12, .12, 2.8); ctx.stroke(); ctx.restore();
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
    const tasks = (DESKTOP_WIDGET ? currentTasksSnapshot : data.tasks).filter((task) => task.status === "active" && task.startedAt && (taskPhase(task, wallTime) !== "elapsed" || wallTime - taskDeadline(task) < 1750));
    const running = tasks.filter((task) => taskPhase(task, wallTime) === "running").sort((a, b) => taskDeadline(a) - taskDeadline(b));
    const visible = running.slice(0, data.visual.planetCount);
    const active = visible.concat(tasks.filter((task) => taskPhase(task, wallTime) === "elapsed" && wallTime - taskDeadline(task) < 1750));
    const core = coreGeometry();
    let urgency = 0;
    if (active.length) urgency = Math.max(...active.map((task) => Math.min(1, Math.max(0, (wallTime - task.startedAt) / Math.max(1, task.durationMinutes * 60_000)))));
    if (data.visual.showOrbits) {
      [1.55, 2.15, 2.8].forEach((factor, index) => drawOrbit(core.x, core.y, core.radius * factor + 35, (core.radius * factor + 35) * .57, -.17 + index * .16, index % 2 ? "rgba(167,157,139,.42)" : "rgba(184,161,125,.42)", .11));
    }
    active.forEach((task, index) => drawTaskPlanet(task, index, active, core, timestamp, wallTime));
    drawCore(core, timestamp, urgency);
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

  function setCenterFromPointer(event) {
    const point = pointerPoint(event);
    coreTarget = { x: clamp(point.x / width, 0.07, 0.93), y: clamp(point.y / height, 0.09, 0.91) };
    data.visual.center = { ...coreTarget };
    if (!DESKTOP_WIDGET) save();
    lastPositionSent = now();
  }

  function finishDrag() {
    if (!draggingCore) return;
    draggingCore = false;
    if (DESKTOP_WIDGET) {
      window.qgScene?.saveWidgetPosition?.({ ...data.visual.center });
      setWidgetInput(false);
    } else save();
    dragPointerId = null;
  }

  canvas.addEventListener("pointermove", (event) => {
    const point = pointerPoint(event);
    if (!draggingCore) {
      if (DESKTOP_WIDGET) setWidgetInput(nearCore(point, 13));
      return;
    }
    if (event.pointerId !== dragPointerId) return;
    setCenterFromPointer(event);
  });
  canvas.addEventListener("pointerdown", (event) => {
    const point = pointerPoint(event);
    if (nearCore(point, 3) && event.button === 2) {
      draggingCore = true; dragPointerId = event.pointerId;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault(); event.stopPropagation();
      if (DESKTOP_WIDGET) setWidgetInput(true);
      return;
    }
    if (!DESKTOP_WIDGET && event.button === 0 && nearCore(point, 3)) { openFocusDialog(); event.preventDefault(); }
  });
  canvas.addEventListener("pointerup", (event) => { if (event.pointerId === dragPointerId) finishDrag(); });
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("lostpointercapture", finishDrag);
  canvas.addEventListener("contextmenu", (event) => { if (nearCore(pointerPoint(event), 5)) event.preventDefault(); });
  canvas.addEventListener("pointerleave", () => { if (!draggingCore && DESKTOP_WIDGET) setWidgetInput(false); });

  byId("panelContent").addEventListener("click", (event) => { const button = event.target.closest("[data-action]"); if (button) handleAction(button); });
  byId("panelContent").addEventListener("input", handleInput);
  byId("panelContent").addEventListener("change", handleChange);
  byId("panelContent").addEventListener("submit", handleSubmit);
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  byId("syncWidget").addEventListener("click", syncWidget);
  byId("coreInfo").addEventListener("click", openFocusDialog);
  byId("panelClose").addEventListener("click", () => {
    const panel = byId("controlPanel");
    const collapsed = panel.classList.toggle("is-collapsed");
    byId("panelClose").textContent = collapsed ? "⌄" : "⌃";
    byId("panelClose").setAttribute("aria-label", collapsed ? "Rouvrir le panneau" : "Réduire le panneau");
  });
  byId("mobileMenu").addEventListener("click", () => document.querySelector(".main-nav").classList.toggle("is-open"));
  byId("taskImport").addEventListener("change", (event) => { readImportFile(event.target.files?.[0]).catch(() => showToast("Le fichier n’a pas pu être lu.")); event.target.value = ""; });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (["close-task-dialog", "close-focus"].includes(action)) handleAction(button);
    if (action === "apply-import") applyImport();
    if (action === "close-import") importDialog?.close();
  });
  window.addEventListener("resize", resizeCanvas, { passive: true });

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
      coreCurrent = { ...data.visual.center }; coreTarget = { ...data.visual.center }; createStars(); resizeCanvas();
    });
    if (DESKTOP_WIDGET) document.documentElement.classList.add("desktop-widget");
  }

  createStars(); resizeCanvas(); render();
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
