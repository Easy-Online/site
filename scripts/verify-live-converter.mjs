// Production asset smoke test. Run after GitHub Pages deployment succeeds.
// Detect stale HTML/JavaScript and missing offline Word-export assets.
import assert from "node:assert/strict";
const origin = process.env.EASYFILE_SITE_URL || "https://www.easyfile.co.za";
const pages = [
  { path: "/easy-converter.html", js: "/assets/js/easy-converter.js" },
  { path: "/easy-converter-enterprise.html", js: "/assets/js/easy-converter-enterprise.js" }
];
const fallback = "/assets/js/easyfile-docx-fallback.js";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(path) {
  const url = new URL(path, origin);
  // Avoid cached, stale Pages/CDN responses when verifying release readiness.
  url.searchParams.set("release_smoke", Date.now().toString());
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: { "Cache-Control": "no-cache", "Accept": "text/html,application/javascript,*/*" }
  });
  assert.equal(response.status, 200, `${url}: expected HTTP 200, got ${response.status}`);
  return response.text();
}
async function assertDeployment() {
  const offline = await fetchText(fallback);
  assert.match(offline, /EasyFileDocxFallback\s*=\s*Object\.freeze/, "offline DOCX exporter not deployed");
  assert.match(offline, /function createDocument\(/, "offline DOCX export engine missing");
  for (const page of pages) {
    const html = await fetchText(page.path);
    assert.match(html, /easyfile-docx-fallback\.js/, `${page.path}: fallback script missing from public HTML`);
    const javascript = await fetchText(page.js);
    assert.match(javascript, /EasyFileDocxFallback\?\.createDocument/, `${page.js}: old exporter still published`);
    assert.match(javascript, /EasyFileDocxFallback\.createDocument\(/, `${page.js}: fallback generation absent`);
  }
  console.log("Production converter HTML, JS and offline DOCX engine are published");
}
let last;
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    await assertDeployment();
    process.exit(0);
  } catch (error) {
    last = error;
    console.error(`Production smoke attempt ${attempt}/12 failed: ${error.message}`);
    if (attempt < 12) await sleep(10000);
  }
}
throw last;
