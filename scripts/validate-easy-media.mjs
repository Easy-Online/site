import fs from "node:fs";
const read=p=>fs.readFileSync(p,"utf8");
const html=read("easy-media.html");
const js=read("assets/js/easy-media.js");
const nav=read("scripts/sync-nav.js");
const checks=[
  ["responsive viewport",/name="viewport"/.test(html)],
  ["EasyFile shared navigation",/scripts\/sync-nav\.js/.test(html)],
  ["favicon",/logo-b\.png/.test(html)],
  ["mobile breakpoint",/@media\(max-width:620px\)/.test(html)],
  ["link workflow",/id="urlInput"/.test(html)&&/analyseUrl/.test(js)],
  ["upload workflow",/id="fileInput"/.test(html)&&/acceptBlob/.test(js)],
  ["media search",/id="providerGrid"/.test(html)&&/Pixabay/.test(js)&&/Unsplash/.test(js)],
  ["rights confirmation",/id="rightsConfirm"/.test(html)&&/allowed\(\)/.test(js)],
  ["image conversion",/convertImage/.test(js)&&/createImageBitmap/.test(js)],
  ["audio-video conversion",/convertAV/.test(js)&&/@ffmpeg\/ffmpeg/.test(js)],
  ["Easy Edit handoff",/easy-edit\.html/.test(js)&&/EasyFileDocumentBus/.test(js)],
  ["history",/easy\.media\.history\.v1/.test(js)],
  ["streaming safeguards",/youtube\.com/.test(js)&&/providerRestricted/.test(js)],
  ["global module registration",/name: "Media".*easy-media\.html/.test(nav)]
];
const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?"PASS":"FAIL")+"  "+name);
if(failed.length) throw new Error("Easy Media validation failed: "+failed.map(x=>x[0]).join(", "));
console.log("Easy Media validation passed.");