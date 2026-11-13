// Regression guard for DOCX export dependency and browser download lifecycle.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import "./test-docx-fallback.mjs";
const html = readFileSync(new URL("../easy-converter.html", import.meta.url), "utf8");
const enterprise = readFileSync(new URL("../easy-converter-enterprise.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../assets/js/easy-converter.js", import.meta.url), "utf8");
const enterpriseJs = readFileSync(new URL("../assets/js/easy-converter-enterprise.js", import.meta.url), "utf8");
assert.match(html, /https:\/\/cdn\.jsdelivr\.net\/npm\/docx@8\.5\.0\/build\/index\.umd\.js/);
assert.doesNotMatch(enterprise, /cdn\.jsdelivr\.net\/npm\/docx@/);
assert.doesNotMatch(enterprise, /cdnjs\.cloudflare\.com\/ajax\/libs\/docx\/8\.5\.0\/docx\.umd\.js/);
assert.doesNotMatch(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/docx\/8\.5\.0\/docx\.umd\.js/);
assert.match(html, /data-format="docx"/);
assert.match(js, /async function exportDocx\(\)/);
assert.match(js, /await Packer\.toBlob\(/);
assert.match(js, /else if\(format==="docx"\) await exportDocx\(\)/);
assert.match(js, /const edited = currentText\(\) !== state\.model\.text/);
assert.match(js, /tables: edited \? \[\] : state\.model\.tables/);
assert.match(js, /currentText\(\)===state\.model\.text/);
console.log("DOCX dependency and corrected-export wiring verified");

assert.match(html, /<script src="assets\\/js\\/easyfile-docx-fallback\\.js" defer><\\/script>/);
assert.match(enterprise, /<script src="assets\\/js\\/easyfile-docx-fallback\\.js\\?v=20261113-local" defer><\\/script>/);
assert.match(enterprise, /<script type="module" src="assets\\/js\\/easy-converter-enterprise\\.js\\?v=20261113-local"><\\/script>/);
assert.match(js, /EasyFileDocxFallback\\?\\.createDocument/);
assert.match(js, /EasyFileDocxFallback\\.createDocument\\(/);
assert.match(enterpriseJs, /EasyFileDocxFallback\\?\\.createDocument/);
assert.doesNotMatch(enterpriseJs, /window\\.docx|requireDocx\\(/);
assert.match(enterpriseJs, /downloadBlob\\(createDocument\\(\\{ blocks \\}\\)/);
