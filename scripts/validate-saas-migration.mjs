import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const errors = [];

const nav = read("scripts/sync-nav.js");
const home = read("index.html");
const converter = read("easy-bank-statement-converter.html");
const analytics = read("assets/js/easyfile-product-analytics.js");

if (!nav.includes('const referralEnabledPage = current === "referrals.html";')) {
  errors.push("Referral scripts must remain scoped to the legacy dashboard.");
}
if (!home.includes("From bank activity to <strong>business-ready records.</strong>")) {
  errors.push("The homepage must retain the lead bank-to-records product promise.");
}
if (!home.includes("easy-bank-statement-converter.html?sample=1#converterWorkspace")) {
  errors.push("The homepage must provide a one-click sample activation path.");
}
if (!converter.includes('get("sample") !== "1"')) {
  errors.push("The converter must load sample data when requested from the homepage.");
}
for (const event of ["converter_viewed", "sample_loaded", "statement_selected", "conversion_started", "conversion_completed", "export_completed"]) {
  if (!analytics.includes(event)) errors.push(`Missing local activation event: ${event}`);
}
for (const document of ["saas-product-foundation.md", "saas-architecture.md", "saas-security-and-privacy.md", "saas-metrics.md", "customer-discovery.md", "pricing-experiment.md"]) {
  if (!fs.existsSync(path.join(root, "docs", document))) errors.push(`Missing SaaS foundation document: ${document}`);
}

if (errors.length) {
  console.error("SaaS migration validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("SaaS migration validation passed.");
