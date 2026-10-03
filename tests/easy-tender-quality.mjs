import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const html = fs.readFileSync("easy-tender.html","utf8");
for (const id of ["fileInput","submissionPack","reqRows","reqCards","taskList","questionList","riskList","gateList","vaultList","qualificationGates","documentRegister"]) {
  assert.match(html,new RegExp("id=[\\\"']"+id+"[\\\"']"),"Missing required UI id: "+id);
}
assert.match(html,/multiple accept=/,"Tender pack upload must accept multiple files");
assert.match(html,/Submission Gate/,"Submission gate UI missing");
assert.match(html,/Submission pack builder/,"Submission pack builder UI missing");
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
const demoDocs=vm.runInContext("state.submissionItems.length",sandbox);
const demoMandatory=vm.runInContext("state.requirements.filter(r=>r.mandatory).length",sandbox);
assert.ok(demoReq>=3,"Seed demo extracted too few compliance conditions: "+demoReq);
assert.ok(demoDocs>=5,"Seed demo extracted too few submission items: "+demoDocs);
assert.ok(demoMandatory>=3,"Seed demo extracted too few mandatory requirements: "+demoMandatory);
assert.equal(vm.runInContext("gateChecks().some(c=>!c.ok)",sandbox),true,"Fresh demo should have submission blockers");

const lines=[];
for(let i=1;i<=1200;i++){
  lines.push("Requirement "+i+": The bidder must provide mandatory supporting evidence, assign an owner, and include a signed response schedule for item "+i+".");
}
const synthetic="REQUEST FOR PROPOSAL RFP LOAD-2026-001\nClosing date: 31 December 2026 at 11:00 SAST\nProposals must be uploaded through the online portal.\nAppendix A Technical Bid Response Sheet is compulsory.\nAppendix B Pricing Schedule is compulsory.\nAn OEM reseller authorisation letter must be submitted.\nThe bidder must provide at least one (1) contactable reference of similar work.\n"+lines.join("\n");
sandbox.synthetic=synthetic;
const start=performance.now();
vm.runInContext("analyseText(synthetic,'Synthetic Load Tender')",sandbox);
const elapsed=performance.now()-start;
const capped=vm.runInContext("state.requirements.length",sandbox);
assert.equal(capped,180,"Compliance-condition safety cap should remain 180");
const loadDocs=vm.runInContext("state.submissionItems.length",sandbox);
assert.ok(loadDocs>=5,"Synthetic tender did not extract submission pack items");
assert.ok(elapsed<2500,"Synthetic 1,200-line tender analysis exceeded 2.5s: "+elapsed.toFixed(1)+"ms");


const fortinet=`Electoral Commission
Bid Specifications
Auction 0010577632
Fortinet Fortigate Software Licenses Renewals
Suppliers must place a bid on the Votaquotes e-Procurement system and provide all required documentation.
5.2 Bidders must complete and submit Appendix A: Technical Bid Response Sheet.
5.4 An OEM letter of proof of the reseller agreement/authorization must accompany the written documentation.
5.5 If reseller authorization is from a distributor, proof from the OEM authorizing the distributor must be submitted.
5.7 The bidder must provide at least one (1) contactable reference of past services of a similar nature (Fortinet licences).
8.2 The total bid price must be broken down as detailed in Appendix B – Pricing Schedule and submitted as part of the bid.
13.1 Summary of Submission Requirements
Submit bid and bid price online on the Votaquotes portal.
Pricing information by completing and submitting Appendix B.
Detailed technical specifications – Appendix A.
A letter of proof of the reseller agreement either from the OEM or an authorized distributor.
At least 1 reference of similar work.
18.1 The Bidder's Disclosure form SBD4 is attached for all entities who participate in the bid process.
Bidder is registered on the National Treasury Central Supplier Database (CSD).
Bidder is tax compliant.
B-BBEE Status Level of Contributor.
Bidders are NOT expected to complete and submit this evaluation section.
The Electoral Commission CEO must inform National Treasury of any action taken.`;
sandbox.fortinet=fortinet;
vm.runInContext("analyseText(fortinet,'Fortinet Tender')",sandbox);
const titles=vm.runInContext("state.submissionItems.map(x=>x.title)",sandbox);
for(const expected of ["Place bid and total bid price on the prescribed portal","Appendix A – Technical Bid Response Sheet","Appendix B – Pricing Schedule","OEM / reseller authorisation letter","At least one contactable similar-work reference","SBD4 – Bidder’s Disclosure","CSD registration","Tax compliance status"]){
  assert.ok(titles.includes(expected),"Missing Fortinet pack item: "+expected);
}
const conditions=vm.runInContext("state.requirements.map(x=>x.text)",sandbox);
assert.ok(!conditions.some(x=>/CEO must inform National Treasury/i.test(x)),"Buyer-internal evaluator clause leaked into bidder compliance conditions");

const XSS='<img src=x onerror=alert(1)>';
sandbox.XSS=XSS;
const escaped=vm.runInContext("esc(XSS)",sandbox);
assert.ok(!escaped.includes("<img"),"HTML escape regression detected");

console.log(JSON.stringify({
  status:"PASS",
  demoRequirements:demoReq,
  demoSubmissionItems:demoDocs,
  demoMandatory,
  loadInputLines:1200,
  extractedRequirementCap:capped,
  syntheticSubmissionItems:loadDocs,
  analysisMs:Number(elapsed.toFixed(1)),
  checks:["UI contract","seed workflow","submission gate","load analysis","HTML escaping"]
},null,2));
