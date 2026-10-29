"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repository = path.resolve(__dirname, "../../");
const output = path.join(__dirname, "..", "widget");
const appFiles = ["index.html", "cockpit.js", "cockpit.css", "pinball.html", "pinball.js", "pinball.css", "manifest.webmanifest", "service-worker.js", "icon.svg"];

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`La modification du widget Windows ne correspond plus à ${label}.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

fs.mkdirSync(output, { recursive: true });
for (const file of appFiles) {
  fs.copyFileSync(path.join(repository, file), path.join(output, file));
}

const widgetScriptPath = path.join(output, "cockpit.js");
let widgetScript = fs.readFileSync(widgetScriptPath, "utf8").replace(/\r\n?/g, "\n");
widgetScript = replaceOnce(widgetScript,
  '    const core = coreGeometry(); coreHit = { x: core.x, y: core.y, radius: core.radius * 1.18 };',
  '    const core = coreGeometry(); coreHit = { x: core.x, y: core.y, radius: core.radius * 1.18 };\n    window.qgScene?.setCoreDragArea?.({ x: core.x, y: core.y, radius: coreHit.radius });',
  "la zone de déplacement du noyau");
widgetScript = replaceOnce(widgetScript,
  '  if (window.qgScene) {\n    window.qgScene.onSceneState((snapshot) => {',
  '  if (window.qgScene) {\n    if (DESKTOP_WIDGET) window.qgScene.onCoreDrag((drag) => {\n      if (!drag || !Number.isFinite(drag.x) || !Number.isFinite(drag.y)) return;\n      data.visual.center = { x: drag.x, y: drag.y };\n      data.visual.zoomPan = { x: 0, y: 0 };\n      coreTarget = { ...data.visual.center };\n      if (drag.phase === "end") {\n        window.qgScene.saveWidgetPosition?.({ ...data.visual.center });\n        saveViewGesture();\n      }\n    });\n    window.qgScene.onSceneState((snapshot) => {',
  "la réception du glissement natif");
fs.writeFileSync(widgetScriptPath, widgetScript, "utf8");

