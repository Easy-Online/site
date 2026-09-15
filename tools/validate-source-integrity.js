"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".yml", ".yaml", ".xml", ".json"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".terraform"]);
const TRANSCRIPT_MARKERS = [
  /^Worked for \d+(?:m|s|h)/m,
  /^Reviewed current main at /m,
  /^I could not commit\/push or open /m,
  /^which path do i add these files to\?/mi,
  /^where ot i save these files/mi
];

const problems = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    const stat = fs.statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    const marker = TRANSCRIPT_MARKERS.find((pattern) => pattern.test(content));
    if (marker) {
      problems.push(`${path.relative(ROOT, fullPath)} contains pasted conversation/transcript content (${marker}).`);
    }
  }
}

walk(ROOT);

if (problems.length) {
  console.error("Source integrity validation failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log("Source integrity validation passed.");
