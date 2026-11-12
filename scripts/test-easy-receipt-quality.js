const fs = require("fs");
const vm = require("vm");

function fail(message){ console.error("FAIL:", message); process.exitCode = 1; }
function pass(message){ console.log("PASS:", message); }

const receipt = fs.readFileSync("easy-receipt.html","utf8");
const capture = fs.readFileSync("easy-capture.html","utf8");

const requiredIds = [
  "btnScanCapture","btnSave","btnPrint","receiptHistory","receiptNumber",
  "receiptDate","receivedFrom","itemsBody","cookieBanner"
];
for(const id of requiredIds){
  if(!receipt.includes(`id="${id}"`)) fail(`missing required receipt control #${id}`);
  else pass(`receipt control #${id}`);
}

const ids = [...receipt.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const duplicates = [...new Set(ids.filter((id,i,a)=>a.indexOf(id)!==i))];
if(duplicates.length) fail("duplicate IDs: "+duplicates.join(", "));
else pass("no duplicate IDs");

if(!receipt.includes('name="viewport"') || !receipt.includes("viewport-fit=cover")) fail("mobile viewport not configured");
else pass("mobile viewport configured");

if(!receipt.includes('rel="canonical" href="https://www.easyfile.co.za/easy-receipt.html"')) fail("canonical URL missing");
else pass("canonical URL");

if(!receipt.includes('"SoftwareApplication"')) fail("SoftwareApplication schema missing");
else pass("structured data");

if(!receipt.includes('easy-capture.html?return=receipt')) fail("Easy Capture launch handoff missing");
else pass("receipt -> capture launch");

if(!capture.includes('id="btnSendReceipt"')) fail("Easy Capture return button missing");
else pass("capture return button");

if(!capture.includes('easy.receipt.capture-handoff.v1')) fail("capture handoff storage key missing");
else pass("capture handoff payload");

const inlineScripts = [...receipt.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m=>m[1]).filter(s=>s.trim());
inlineScripts.forEach((src,i)=>{
  try { new vm.Script(src); pass(`inline script ${i+1} syntax`); }
  catch(err){ fail(`inline script ${i+1} syntax: ${err.message}`); }
});

if(!receipt.includes("min-height:44px")) fail("touch-target minimum missing");
else pass("mobile touch-target rule");

if(!receipt.includes("analytics_consent_granted") || !receipt.includes("easyfile:analytics")) fail("analytics instrumentation missing");
else pass("consent-aware analytics instrumentation");

if(process.exitCode) process.exit(process.exitCode);
console.log("Easy Receipt quality gate passed.");
