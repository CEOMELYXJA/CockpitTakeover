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
  '      center: { x: clamp(center.x ?? 0.5, 0.08, 0.92), y: clamp(center.y ?? 0.53, 0.1, 0.9) },',
  '      center: { x: clamp(center.x ?? 0.5, DESKTOP_WIDGET ? -4 : 0.08, DESKTOP_WIDGET ? 4 : 0.92), y: clamp(center.y ?? 0.53, DESKTOP_WIDGET ? -4 : 0.1, DESKTOP_WIDGET ? 4 : 0.9) },',
  "la position du noyau à travers plusieurs écrans");
widgetScript = replaceOnce(widgetScript,
  '    const core = coreGeometry(); coreHit = { x: core.x, y: core.y, radius: core.radius * 1.18 };',
  '    const core = coreGeometry(); coreHit = { x: core.x, y: core.y, radius: core.radius * 1.18 };\n    window.qgScene?.setCoreDragArea?.({ x: core.x, y: core.y, radius: coreHit.radius });\n    const mascot = planetHits.find((hit) => hit.kind === "mascot");\n    window.qgScene?.setMascotClickArea?.({ x: mascot?.x || 0, y: mascot?.y || 0, radius: mascot?.radius || 0, active: Boolean(mascot && mascot.depth <= 0) });',
  "la zone de déplacement du noyau");
fs.writeFileSync(widgetScriptPath, widgetScript, "utf8");
