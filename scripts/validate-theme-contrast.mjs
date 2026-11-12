// Static colour-contract regression guard for EasyFile's shared light and dark themes.
// Contrast ratios use WCAG 2.2 relative luminance. Runtime visual checks remain necessary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const load = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokens = load("../assets/css/easyfile-brand-tokens.css");
const site = load("../assets/css/easyfile-site.css");
const converter = load("../assets/css/easy-converter-enterprise.css");
const nav = load("../assets/css/easyfile-navigation.css");
const theme = load("../scripts/sync-nav.js");

function cssScope(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `CSS scope not found: ${selector}`);
  const brace = source.indexOf("{", start);
  return source.slice(brace + 1, source.indexOf("}", brace));
}
function variable(scope, name) {
  const match = scope.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(match, `Missing fixed colour token: ${name}`);
  return match[1];
}
function luminance(hex) {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function aa(label, fg, bg) {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= 4.5, `${label}: contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1`);
  console.log(`${label}: ${ratio.toFixed(2)}:1 PASS`);
}
const light = cssScope(tokens, ":root {");
const dark = cssScope(tokens, '[data-theme="dark"] {');
for (const [label, scope] of [["light", light], ["dark", dark]]) {
  const get = (name) => variable(scope, name);
  aa(`${label} primary CTA`, get("easyfile-action-primary-text"), get("easyfile-action-primary-bg"));
  aa(`${label} primary CTA hover`, get("easyfile-action-primary-text"), get("easyfile-action-primary-hover"));
  aa(`${label} success CTA`, get("easyfile-action-success-text"), get("easyfile-action-success-bg"));
  aa(`${label} success CTA hover`, get("easyfile-action-success-text"), get("easyfile-action-success-hover"));
  aa(`${label} regular text`, get("easyfile-text"), get("easyfile-surface"));
  aa(`${label} muted text`, get("easyfile-muted"), get("easyfile-surface"));
}
aa("navigation text", "#ffffff", "#061a4d");
assert.match(site, /\.easyfile-nav\s*\{[^}]*background:\s*#061a4d/s);
assert.match(site, /\.easyfile-action-primary\s*\{[^}]*background:\s*var\(--easyfile-action-primary-bg/s);
assert.match(site, /\.easyfile-action-success\s*\{[^}]*background:\s*var\(--easyfile-action-success-bg/s);
assert.match(converter, /\.converter-btn-primary\s*\{[^}]*background:\s*var\(--easyfile-action-primary-bg/s);
assert.match(converter, /html\[data-theme="dark"\] \.converter-inline-alert\.show/);
assert.match(nav, /html\[data-theme="dark"\] \.easyfile-search-results/);
assert.match(theme, /systemTheme\?\.addEventListener\?\.\("change"/);
assert.match(theme, /sessionThemePreference = next/);
console.log("EasyFile light/dark contrast contracts verified");
