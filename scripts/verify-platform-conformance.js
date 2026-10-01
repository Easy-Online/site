#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODULE_RE = /^easy-[a-z0-9-]+\.html$/i;
const SYNC_NAV_PATH = path.join(ROOT, "scripts", "sync-nav.js");
const INDEX_PATH = path.join(ROOT, "index.html");
const SITEMAP_PATH = path.join(ROOT, "sitemap.xml");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function fail(errors) {
  console.error("\n❌ EASYFILE PLATFORM CONFORMANCE FAILED\n");
  errors.forEach((error) => console.error(`- ${error}`));
  console.error("\nThe module registry, homepage, sitemap, navigation mounts and module routes must stay synchronized.\n");
  process.exit(2);
}

const errors = [];
const moduleFiles = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isFile() && MODULE_RE.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (!fs.existsSync(SYNC_NAV_PATH)) errors.push("Missing scripts/sync-nav.js.");
if (!fs.existsSync(INDEX_PATH)) errors.push("Missing index.html.");
if (!fs.existsSync(SITEMAP_PATH)) errors.push("Missing sitemap.xml.");

const navSource = fs.existsSync(SYNC_NAV_PATH) ? fs.readFileSync(SYNC_NAV_PATH, "utf8") : "";
const registeredModules = Array.from(
  navSource.matchAll(/\bhref\s*:\s*["'](easy-[^"']+\.html)["']/gi),
  (match) => match[1].toLowerCase()
);
const registeredSet = new Set(registeredModules);

for (const file of moduleFiles) {
  if (!registeredSet.has(file.toLowerCase())) {
    errors.push(`${file}: not present in the canonical MODULES registry.`);
  }
}
for (const href of registeredSet) {
  if (!fs.existsSync(path.join(ROOT, href))) {
    errors.push(`scripts/sync-nav.js: registry points to missing module ${href}.`);
  }
}
if (registeredModules.length !== registeredSet.size) {
  errors.push("scripts/sync-nav.js: duplicate module href entries exist in the canonical registry.");
}

const indexSource = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, "utf8") : "";
if (!indexSource.includes("window.EasyFileModules")) {
  errors.push("index.html: homepage does not consume window.EasyFileModules.");
}
if (!indexSource.includes("easyfile:modules-ready")) {
  errors.push("index.html: homepage is not listening for the canonical module-ready event.");
}
if (/const\s+MODULES\s*=\s*Object\.freeze\s*\(/.test(indexSource)) {
  errors.push("index.html: independent MODULES registry detected; homepage must use the canonical registry.");
}

const sitemap = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, "utf8") : "";
for (const file of moduleFiles) {
  const url = `https://www.easyfile.co.za/${file}`;
  if (!sitemap.includes(`<loc>${url}</loc>`)) {
    errors.push(`sitemap.xml: missing ${file}.`);
  }
}

function countCanonicalNavs(html) {
  return Array.from(html.matchAll(/<div\b[^>]*class=["'][^"']*\beasyfile-nav\b[^"']*["'][^>]*>/gi)).length;
}

function duplicateIds(html) {
  const seen = new Set();
  const duplicates = new Set();
  for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    const id = match[1];
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return Array.from(duplicates);
}

for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;
  const html = read(entry.name);
  const navCount = countCanonicalNavs(html);
  if (navCount !== 1) {
    errors.push(`${entry.name}: expected exactly one .easyfile-nav mount after injection, found ${navCount}.`);
  }

  const duplicates = duplicateIds(html);
  if (duplicates.length) {
    errors.push(`${entry.name}: duplicate HTML id(s): ${duplicates.join(", ")}.`);
  }

  if (/src=["'](?:\.\/)?sync-nav\.js["']/i.test(html)) {
    errors.push(`${entry.name}: obsolete root sync-nav.js reference detected.`);
  }

  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1].split("#")[0].split("?")[0];
    if (!MODULE_RE.test(href)) continue;
    if (!fs.existsSync(path.join(ROOT, href))) {
      errors.push(`${entry.name}: links to missing module ${href}.`);
    }
  }
}

for (const asset of ["logo-b.png", "logo-w.png", "laptop.png"]) {
  if (!fs.existsSync(path.join(ROOT, asset))) {
    errors.push(`Missing required root asset ${asset}.`);
  }
}

if (errors.length) fail(errors);

console.log(
  `✅ EASYFILE PLATFORM CONFORMANCE VERIFIED: ${moduleFiles.length} modules are synchronized across registry, homepage, sitemap and generated navigation.`
);
