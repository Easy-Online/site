import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const required = [
  "easy-edit.html",
  "assets/js/easyfile-document-bus.js",
  "assets/js/easyfile-edit-handoff.js",
  "assets/js/easy-edit/engine.js",
  "assets/js/easy-edit/adapters.js",
  "assets/js/easy-edit/app.js",
  "docs/easy-edit-engine.md",
  "scripts/sync-nav.js"
];
for (const path of required) {
  if (!fs.existsSync(path)) throw new Error(`Missing Easy Edit engine file: ${path}`);
}

const html = read("easy-edit.html");
for (const src of [
  "assets/js/easyfile-document-bus.js",
  "assets/js/easy-edit/engine.js",
  "assets/js/easy-edit/adapters.js",
  "assets/js/easy-edit/app.js"
]) {
  if (!html.includes(src)) throw new Error(`easy-edit.html does not load ${src}`);
}
if (html.includes("function loadPdf()") || html.includes("function loadImage()")) {
  throw new Error("File-engine logic leaked back into easy-edit.html; keep the page as an engine client.");
}

const engine = read("assets/js/easy-edit/engine.js");
for (const token of ["registerAdapter", "openDocument", "execute(action", "undo()", "redo()", "saveRecovery", "restoreRecovery", "async export(format)"]) {
  if (!engine.includes(token)) throw new Error(`Engine contract missing: ${token}`);
}

const bus = read("assets/js/easyfile-document-bus.js");
for (const token of ["indexedDB", "async function handoff", "async function consume", "async function cleanup", "MAX_DOCUMENT_BYTES"]) {
  if (!bus.includes(token)) throw new Error(`Document bus capability missing: ${token}`);
}

const adapters = read("assets/js/easy-edit/adapters.js");
for (const id of ["pdf", "image", "html", "text", "docx", "workbook"]) {
  if (!adapters.includes(`id: "${id}"`)) throw new Error(`Built-in adapter missing: ${id}`);
}
if (!adapters.includes("convertToPdfPoint")) throw new Error("PDF overlays must use canonical PDF page coordinates.");
if (!adapters.includes("page.rotate + model.rotations") || !adapters.includes("overlayRotation")) throw new Error("PDF rendering/export must preserve intrinsic page rotation and overlay orientation.");

const handoff = read("assets/js/easyfile-edit-handoff.js");
if (!handoff.includes("EasyFileDocumentBus") || !handoff.includes("Edit in Easy Edit")) {
  throw new Error("Cross-module Easy Edit handoff helper is incomplete.");
}

const nav = read("scripts/sync-nav.js");
if (!nav.includes('href: "easy-edit.html"') || !nav.includes("easyfile-edit-handoff.js")) {
  throw new Error("Easy Edit must remain registered globally and auto-load the shared handoff helper on EasyFile modules.");
}

console.log("Easy Edit shared-engine validation passed.");
