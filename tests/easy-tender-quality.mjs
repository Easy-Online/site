import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const html = fs.readFileSync("easy-tender.html","utf8");
for (const id of ["fileInput","reqRows","taskList","questionList","riskList","gateList","vaultList","qualificationGates","documentRegister"]) {
  assert.match(html,new RegExp("id=[\\\"']"+id+"[\\\"']"),"Missing required UI id: "+id);
}
assert.match(html,/multiple accept=/,"Tender pack upload must accept multiple files");
assert.match(html,/Submission Gate/,"Submission gate UI missing");
assert.match(html,/Evidence Vault/,"Evidence Vault UI missing");
assert.match(html,/Bid \/ No-Bid qualification/,"Qualification UI missing");

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join("\n");
assert.ok(inline.length>1000,"Main inline script not found");

const nodes = new Map();
function node(id=""){
  if(!nodes.has(id)) nodes.set(id,{
    id, textContent:"", innerHTML:"", value:"", checked:false, style:{}, className:"",
    classList:{add(){},remove(){},toggle(){}},
    dataset:{}, addEventListener(){}, setAttribute(){}, click(){}, appendChild(){},
    querySelectorAll(){return[]}
  });
  return nodes.get(id);
}
const sandbox={
  console,
  Date,
  Math,
  JSON,
  String,
  Array,
  Set,
  RegExp,
  Promise,
  Uint8Array,
  localStorage:{getItem(){return null},setItem(){},removeItem(){}},
  document:{
    getElementById:id=>node(id),
    querySelectorAll(){return[]},
    createElement:()=>node("created")
  },
  window:{},
  navigator:{clipboard:{writeText(){return Promise.resolve()}}},
  confirm(){return true},
  prompt(_q,d=""){return d},
  alert(){},
  setTimeout(){return 0},
  clearTimeout(){},
  Blob: class {},
  URL:{createObjectURL(){return "blob:test"},revokeObjectURL(){}},
  FileReader: class {},
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(inline,sandbox,{filename:"easy-tender-inline.js"});

vm.runInContext("seedDemo()",sandbox);
const demoReq=vm.runInContext("state.requirements.length",sandbox);
const demoMandatory=vm.runInContext("state.requirements.filter(r=>r.mandatory).length",sandbox);
assert.ok(demoReq>=8,"Seed demo extracted too few requirements: "+demoReq);
assert.ok(demoMandatory>=5,"Seed demo extracted too few mandatory requirements: "+demoMandatory);
assert.equal(vm.runInContext("gateChecks().some(c=>!c.ok)",sandbox),true,"Fresh demo should have submission blockers");

const lines=[];
for(let i=1;i<=1200;i++){
  lines.push("Requirement "+i+": The bidder must provide mandatory supporting evidence, assign an owner, and include a signed response schedule for item "+i+".");
}
const synthetic="REQUEST FOR PROPOSAL RFP LOAD-2026-001\nClosing date: 31 December 2026 at 11:00 SAST\nProposals must be uploaded through the online portal.\n"+lines.join("\n");
sandbox.synthetic=synthetic;
const start=performance.now();
vm.runInContext("analyseText(synthetic,'Synthetic Load Tender')",sandbox);
const elapsed=performance.now()-start;
const capped=vm.runInContext("state.requirements.length",sandbox);
assert.equal(capped,180,"Requirement safety cap should remain 180");
assert.ok(elapsed<2500,"Synthetic 1,200-line tender analysis exceeded 2.5s: "+elapsed.toFixed(1)+"ms");

const XSS='<img src=x onerror=alert(1)>';
sandbox.XSS=XSS;
const escaped=vm.runInContext("esc(XSS)",sandbox);
assert.ok(!escaped.includes("<img"),"HTML escape regression detected");

console.log(JSON.stringify({
  status:"PASS",
  demoRequirements:demoReq,
  demoMandatory,
  loadInputLines:1200,
  extractedRequirementCap:capped,
  analysisMs:Number(elapsed.toFixed(1)),
  checks:["UI contract","seed workflow","submission gate","load analysis","HTML escaping"]
},null,2));
