"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const state = {
    settings: { opacity: 0.82, motion: "measured", fieldEnabled: true, startWithWindows: false },
    toastTimer: 0
  };

  function toast(message) {
    const element = byId("toast");
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.remove("visible"), 2600);
  }

  function renderSettings() {
    byId("settingOpacity").value = String(Math.round((state.settings.opacity || 0.82) * 100));
    byId("settingMotion").value = state.settings.motion || "measured";
    byId("settingFieldEnabled").checked = state.settings.fieldEnabled !== false;
    byId("settingStartup").checked = Boolean(state.settings.startWithWindows);
  }

  function renderSiteSync(snapshot) {
    const status = byId("siteSyncStatus");
    if (!status) return;
    if (!snapshot || !snapshot.savedAt) {
      status.textContent = "Aucun rappel synchronisé pour le moment.";
      return;
    }
    const date = new Intl.DateTimeFormat("fr-CA", { dateStyle: "short", timeStyle: "short" }).format(new Date(snapshot.savedAt));
    status.textContent = `Synchronisé le ${date} · ${snapshot.taskCount} rappel${snapshot.taskCount === 1 ? "" : "s"}`;
  }

  function renderAmbientStatus(snapshot) {
    const status = snapshot && snapshot.status || "starting";
    const labels = {
      visible: "WIDGET · ACTIF DERRIÈRE LES ICÔNES",
      starting: "WIDGET · DÉMARRAGE EN COURS",
      hidden: "WIDGET · MASQUÉ",
      unavailable: "WIDGET · NON DISPONIBLE"
    };
    const label = byId("desktopState");
    const dot = document.querySelector(".live-dot");
    label.textContent = labels[status] || labels.starting;
    label.title = snapshot && snapshot.message || "";
    if (dot) {
      dot.classList.remove("is-visible", "is-starting", "is-hidden", "is-unavailable");
      dot.classList.add(`is-${labels[status] ? status : "starting"}`);
      dot.title = label.title;
    }
  }

  async function persistSettings() {
    try {
      state.settings = await window.qgDesktop.saveSettings({
        opacity: Number(byId("settingOpacity").value) / 100,
        motion: byId("settingMotion").value,
        fieldEnabled: byId("settingFieldEnabled").checked,
        startWithWindows: byId("settingStartup").checked
      });
      toast("Réglages enregistrés.");
    } catch (error) {
      state.settings = await window.qgDesktop.getSettings().catch(() => state.settings);
      renderSettings();
      toast(`Réglages impossibles à enregistrer : ${error.message}`);
    }
  }

  byId("panelClose").addEventListener("click", () => window.qgDesktop.closePanel());
  byId("openWeb").addEventListener("click", () => window.qgDesktop.openSite());
  byId("repairWidget").addEventListener("click", async () => {
    try {
      const result = await window.qgDesktop.restartAmbient();
      toast(result.enabled ? "Le widget redémarre sur le bureau…" : "Activez d’abord « Afficher sur le bureau ». ");
    } catch (error) { toast(`Le widget n’a pas pu redémarrer : ${error.message}`); }
  });
  byId("centerReset").addEventListener("click", async () => {
    try { await window.qgDesktop.resetWidgetPosition(); toast("La planète principale est recentrée."); }
    catch (error) { toast(`Position impossible à réinitialiser : ${error.message}`); }
  });
  ["settingOpacity", "settingMotion", "settingFieldEnabled", "settingStartup"]
    .forEach((id) => byId(id).addEventListener("change", persistSettings));
  window.qgDesktop.onAmbientStatus(renderAmbientStatus);
  window.qgDesktop.onSiteSyncStatus(renderSiteSync);
  window.qgDesktop.getAmbientStatus().then(renderAmbientStatus);
  window.qgDesktop.getSiteSyncStatus().then(renderSiteSync);
  window.qgDesktop.getSettings().then((settings) => { state.settings = { ...state.settings, ...settings }; renderSettings(); });
})();
