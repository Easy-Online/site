#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const NAV_FILE = path.join(ROOT, "scripts", "sync-nav.js");
const MODULE_FILE_RE = /^easy-[a-z0-9-]+\.html$/i;
const NAV_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*["'](?:\.\/)?scripts\/sync-nav\.js["'][^>]*>\s*<\/script>/i;

function fail(messages) {
  console.error("\n❌ GLOBAL MODULE MENU VERIFICATION FAILED\n");
  messages.forEach((message) => console.error(`- ${message}`));
  console.error("\nEvery EasyFile module must be registered in scripts/sync-nav.js and load scripts/sync-nav.js.\n");
  process.exit(2);
}

if (!fs.existsSync(NAV_FILE)) fail(["Missing scripts/sync-nav.js."]);

const navSource = fs.readFileSync(NAV_FILE, "utf8");
const registeredModules = new Set(
  Array.from(navSource.matchAll(/\bhref\s*:\s*["'](easy-[^"']+\.html)["']/gi), (match) => match[1].toLowerCase())
);

const moduleFiles = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isFile() && MODULE_FILE_RE.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

const errors = [];

for (const file of moduleFiles) {
  const key = file.toLowerCase();
  if (!registeredModules.has(key)) {
    errors.push(`${file}: missing from the global MODULES registry.`);
  }

  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (!NAV_SCRIPT_RE.test(html)) {
    errors.push(`${file}: does not load scripts/sync-nav.js.`);
  }
}

for (const href of registeredModules) {
  if (!fs.existsSync(path.join(ROOT, href))) {
    errors.push(`scripts/sync-nav.js: registered module does not exist: ${href}.`);
  }
}

if (errors.length) fail(errors);

console.log(`✅ GLOBAL MODULE MENU VERIFIED: ${moduleFiles.length} EasyFile modules are registered and load the shared navigation.`);
