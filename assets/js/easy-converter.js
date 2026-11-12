import { groupPdfRows, linesFromPdfRows, tablesFromPdfRows } from "./easy-converter-pdf.mjs";
let pdfjsLib;
async function loadPdf() {
  if (!pdfjsLib) {
    pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs";
  }
  return pdfjsLib;
}

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_PDF_PAGES = 250;
const state = {
  file: null,
  buffer: null,
  sourceKind: null,
  model: null,
  busy: false,
  cancelRequested: false,
  Tesseract: null,
  ocrLoaded: false,
  readVersion: 0,
  loadingTask: null,
  renderTask: null,
  ocrWorker: null,
  rejectCancel: null
};

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const analyzeBtn = $("analyzeBtn");
const cancelBtn = $("cancelBtn");
const resetBtn = $("resetBtn");
const copyBtn = $("copyBtn");
const editor = $("editor");
const exportButtons = [...document.querySelectorAll("[data-format]")];

const MIME_KIND = new Map([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-excel", "xls"],
  ["text/csv", "csv"],
  ["application/json", "json"],
  ["application/xml", "xml"],
  ["text/xml", "xml"],
  ["text/html", "html"],
  ["text/plain", "txt"]
]);
const EXT_KIND = {
  pdf:"pdf", docx:"docx", xlsx:"xlsx", xls:"xls", csv:"csv", tsv:"tsv", txt:"txt",
  md:"md", markdown:"md", json:"json", xml:"xml", html:"html", htm:"html",
  png:"image", jpg:"image", jpeg:"image", webp:"image", bmp:"image"
};

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function xmlEscape(value){
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
}
function safeCell(value){
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}
function extOf(name){
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}
function kindOf(file){
  const ext = extOf(file?.name);
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  return MIME_KIND.get(mime) || null;
}
function baseName(){
  const name = state.file?.name || "converted-file";
  return name.replace(/\.[^.]+$/, "") || "converted-file";
}
function formatBytes(bytes){
  const units=["B","KB","MB","GB"]; let size=Number(bytes)||0, i=0;
  while(size>=1024 && i<units.length-1){size/=1024;i++;}
  return `${size.toFixed(size>=10||i===0?0:2)} ${units[i]}`;
}
function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=filename; a.style.display="none"; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},30000);
}
function setStatus(message, meta="Idle", progress=null){
  $("statusText").textContent=message; $("statusMeta").textContent=meta;
  if(progress!==null) {
    const pct=Math.max(0,Math.min(100,Number(progress)||0));
    $("progressBar").style.width=`${pct}%`;
    $("progressBar").parentElement.setAttribute("aria-valuenow",String(pct));
  }
}
function log(message, tone="info"){
  const line=document.createElement("div"); line.className="converter-log-line";
  const stamp=document.createElement("span"); stamp.className="converter-log-time"; stamp.textContent=`[${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}]`;
  const body=document.createElement("span"); body.className=`converter-log-${["success","warn","error"].includes(tone)?tone:"info"}`; body.textContent=String(message ?? "");
  line.append(stamp,body); $("logBody").appendChild(line); $("logBody").scrollTop=$("logBody").scrollHeight;
}
function showWarning(message=""){
  const box=$("warningBox"); box.textContent=message; box.classList.toggle("show",Boolean(message));
}
function setBusy(value){
  state.busy=value; analyzeBtn.disabled=value || !state.buffer; cancelBtn.disabled=!value; resetBtn.disabled=value;
  fileInput.disabled=value; dropzone.setAttribute("aria-disabled",String(value)); dropzone.tabIndex=value?-1:0;
  editor.readOnly=value;
  ["ocrMode","ocrScale","ocrLanguage","minWords"].forEach(id=>$(id).disabled=value);
  copyBtn.disabled=value || !editor.value;
  if(value) exportButtons.forEach((button)=>button.disabled=true);
}
function updateMetrics(model){
  $("unitCount").textContent=String(model?.unitCount ?? 0);
  $("charCount").textContent=new Intl.NumberFormat("en-ZA").format(model?.text?.length ?? 0);
  $("tableCount").textContent=String(model?.tables?.length ?? 0);
  $("ocrCount").textContent=String(model?.ocrCount ?? 0);
}
function updateSummaries(){
  const m=state.model;
  if(!m){
    $("sourceType").textContent="Source: —"; $("sourceSummary").textContent="No analysis available."; $("structureSummary").textContent="No tables detected."; return;
  }
  $("sourceType").textContent=`Source: ${m.sourceType.toUpperCase()}`;
  $("sourceSummary").textContent=`${m.sourceFile} · ${m.unitCount} ${m.unitLabel} · ${m.text.length.toLocaleString("en-ZA")} characters${m.warnings.length?` · ${m.warnings.length} warning(s)`:""}`;
  $("structureSummary").textContent=m.tables.length?`${m.tables.length} structured table(s) available for XLSX/CSV/JSON/XML exports.`:"No structured tables detected; spreadsheet exports will use line-based content.";
}
function enableExports(){
  const available = {docx: Boolean(window.docx?.Packer || window.EasyFileDocxFallback?.createDocument), xlsx: Boolean(window.XLSX), csv: true,
    pdf: Boolean((state.sourceKind==="pdf" && currentText()===state.model?.text) || window.jspdf?.jsPDF)};
  exportButtons.forEach(button=>{
    const ready = available[button.dataset.format] !== false;
    button.disabled=state.busy || !state.model || !ready;
    button.title=ready ? "" : "Export library unavailable. Reload the page to retry.";
  });
  copyBtn.disabled=state.busy || !editor.value;
  $("exportHint").textContent=Object.values(available).every(Boolean)?"Exports enabled":"Some export libraries are unavailable; reload to retry";
}
function libraryHealth(){
  const checks=[
    ["PDF.js", Boolean(pdfjsLib?.getDocument)],
    ["SheetJS", Boolean(window.XLSX)],
    ["DOCX export", Boolean(window.docx?.Packer || window.EasyFileDocxFallback?.createDocument)],
    ["Mammoth", Boolean(window.mammoth)],
    ["Papa Parse", Boolean(window.Papa)],
    ["jsPDF", Boolean(window.jspdf?.jsPDF)]
  ];
  $("libraryHealth").innerHTML=checks.map(([name,ok])=>`<span class="${ok?"ok":"bad"}">${escapeHtml(name)}: ${ok?"ready":"unavailable"}</span>`).join("");
}

function makeModel({sourceType, text="", units=[], tables=[], ocrCount=0, warnings=[]}){
  return {
    schemaVersion:"easyfile.converter.v3",
    sourceFile:state.file?.name || "unknown",
    sourceType,
    sourceSize:state.file?.size || 0,
    convertedAt:new Date().toISOString(),
    unitCount:units.length || 1,
    unitLabel:sourceType==="xlsx"||sourceType==="xls"?"sheet(s)":sourceType==="pdf"?"page(s)":"section(s)",
    text:String(text||""),
    units,
    tables,
    ocrCount,
    warnings
  };
}
function currentText(){ return editor.value ?? state.model?.text ?? ""; }
function modelForExport(){
  const edited = currentText() !== state.model.text;
  return {
    ...state.model,
    text: currentText(),
    // Structured tables and page units describe the original extraction. Never export
    // outdated numerical cells as if they reflected user corrections.
    tables: edited ? [] : state.model.tables,
    units: edited ? [] : state.model.units,
    warnings: edited ? [...state.model.warnings, "Content was edited; original structured tables and units were omitted to avoid exporting stale values."] : state.model.warnings,
    correctedAt: new Date().toISOString()
  };
}

async function setFile(file){
  if(state.busy || !file) return;
  const version=++state.readVersion;
  state.file=null; state.buffer=null; state.model=null; state.sourceKind=null;
  editor.value=""; updateMetrics(null); updateSummaries(); analyzeBtn.disabled=true; copyBtn.disabled=true;
  exportButtons.forEach(b=>b.disabled=true); $("exportHint").textContent="Analyse a file to enable export";
  $("fileMeta").textContent="No file selected yet."; setStatus("Reading selected file","Preparing",0);
  const kind=kindOf(file);
  if(!kind){showWarning("Unsupported source format. Use PDF, DOCX, XLSX/XLS, CSV/TSV, TXT/Markdown, JSON, XML, HTML or a common image format."); return;}
  if(!file.size){showWarning("The selected file is empty."); return;}
  if(file.size>MAX_BYTES){showWarning(`The selected file is ${formatBytes(file.size)}. The browser safety limit is 100 MB.`); return;}
  try{
    const buffer=await file.arrayBuffer();
    if(version!==state.readVersion) return;
    state.file=file; state.sourceKind=kind; state.buffer=buffer; state.model=null; state.cancelRequested=false;
    $("fileMeta").textContent=`${file.name} · ${formatBytes(file.size)} · detected as ${kind.toUpperCase()}`;
    editor.value=""; showWarning(""); updateMetrics(null); updateSummaries();
    exportButtons.forEach((b)=>b.disabled=true); copyBtn.disabled=true; analyzeBtn.disabled=false;
    setStatus("File ready for analysis",kind.toUpperCase(),0); log(`Loaded ${file.name} as ${kind.toUpperCase()}.`,"success");
  }catch(error){ console.error(error); showWarning("The file could not be read by this browser."); log(`Read error: ${error?.message||error}`,"error"); }
}

async function renderPdfPage(page,scale){
  let viewport=page.getViewport({scale});
  if(viewport.width*viewport.height>16000000) viewport=page.getViewport({scale:scale*Math.sqrt(16000000/(viewport.width*viewport.height))});
  const canvas=document.createElement("canvas"); const ctx=canvas.getContext("2d",{willReadFrequently:true});
  if(!ctx) throw new Error("Canvas rendering is unavailable in this browser.");
  canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
  try { state.renderTask=page.render({canvasContext:ctx,viewport}); await state.renderTask.promise; return canvas; }
  catch(error) { canvas.width=canvas.height=1; throw error; }
  finally { state.renderTask=null; }
}
async function loadOcr(){
  if(state.ocrLoaded && state.Tesseract) return state.Tesseract;
  await new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-easy-ocr="true"]');
    if(existing && window.Tesseract) return resolve();
    if(existing) existing.remove();
    const script=document.createElement("script"); script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"; script.async=true; script.dataset.easyOcr="true";
    const timer=setTimeout(()=>{script.remove();reject(new Error("OCR library timed out. Check your connection and retry."));},30000);
    script.addEventListener("load",()=>{clearTimeout(timer);resolve();},{once:true}); script.addEventListener("error",()=>{clearTimeout(timer);script.remove();reject(new Error("OCR library failed to load from the CDN."));},{once:true}); document.head.appendChild(script);
  });
  if(!window.Tesseract) throw new Error("OCR runtime loaded without exposing Tesseract.");
  state.Tesseract=window.Tesseract; state.ocrLoaded=true; libraryHealth(); return state.Tesseract;
}
async function ocrImageSource(source,label,progressBase=0,progressSpan=100){
  const Tesseract=await loadOcr(); const lang=$("ocrLanguage").value || "eng";
  if(state.cancelRequested) throw new DOMException("Conversion cancelled by user.","AbortError");
  if(!state.ocrWorker) state.ocrWorker=await Tesseract.createWorker(lang,1,{logger:(event)=>{
    if(!event?.status) return; const pct=typeof event.progress==="number"?Math.round(event.progress*100):0;
    setStatus(`OCR: ${label}`,`${event.status} · ${pct}%`,progressBase+Math.round(progressSpan*pct/100));
  }});
  if(state.cancelRequested) throw new DOMException("Conversion cancelled by user.","AbortError");
  const result=await Promise.race([state.ocrWorker.recognize(source),new Promise((resolve,reject)=>{state.rejectCancel=reject;})]);
  state.rejectCancel=null;
  return {text:String(result?.data?.text||"").trim(), confidence:Number(result?.data?.confidence||0)/100};
}

async function parsePdf(){
  const pdfjsLib=await loadPdf(); libraryHealth();
  const bytes=new Uint8Array(state.buffer.slice(0));
  if(String.fromCharCode(...bytes.slice(0,5))!=="%PDF-") log("PDF signature was not canonical; PDF.js will perform the authoritative parse.","warn");
  state.loadingTask=pdfjsLib.getDocument({data:bytes});
  let pdf;
  try {
  pdf=await Promise.race([state.loadingTask.promise,new Promise((resolve,reject)=>{
    state.loadingTask.onPassword=()=>reject(new Error("This PDF is password protected. Save an unlocked copy in your PDF reader and try again."));
  })]);
  if(pdf.numPages>MAX_PDF_PAGES) throw new Error(`PDF has ${pdf.numPages} pages. This browser workflow is limited to ${MAX_PDF_PAGES} pages per conversion for reliability.`);
  const pages=[], tables=[], warnings=[]; let ocrCount=0; const threshold=Math.max(5,Math.min(400,Number($("minWords").value)||24)); const mode=$("ocrMode").value; const scale=Number($("ocrScale").value)||2;
  for(let n=1;n<=pdf.numPages;n++){
    if(state.cancelRequested) throw new DOMException("Conversion cancelled by user.","AbortError");
    setStatus(`Reading PDF page ${n} of ${pdf.numPages}`,"Embedded text",Math.round((n-1)/pdf.numPages*100));
    const page=await pdf.getPage(n); const content=await page.getTextContent();
    const viewport=page.getViewport({scale:1});
    const items=content.items.filter(item=>typeof item.str==="string").map(item=>{
      const transform=pdfjsLib.Util.transform(viewport.transform,item.transform);
      return {...item,transform:[...transform.slice(0,4),transform[4],-transform[5]]};
    });
    const rows=groupPdfRows(items); const embedded=linesFromPdfRows(rows);
    const wordCount=embedded.join(" ").split(/\s+/).filter(Boolean).length; const useOcr=mode==="always" || (mode==="auto" && wordCount<threshold);
    let text=embedded.join("\n"), source="embedded-text", confidence=embedded.length?0.98:0.7;
    if(useOcr){
      log(`Page ${n}: ${wordCount} embedded words; OCR ${mode==="always"?"forced":"fallback"}.`);
      let canvas;
      try {
      canvas=await renderPdfPage(page,scale); const result=await ocrImageSource(canvas,`page ${n} of ${pdf.numPages}`,Math.round((n-1)/pdf.numPages*100),Math.ceil(100/pdf.numPages));
      if(result.text){text=result.text;source="ocr";confidence=result.confidence;ocrCount++;}
      else if(embedded.length){log(`Page ${n}: OCR returned no text; retained embedded text.`,"warn");}
      } catch(error) {
        if(state.cancelRequested || !embedded.length) throw error;
        warnings.push(`Page ${n}: OCR unavailable; embedded text was retained. Review the original for missing content.`);
      } finally { if(canvas) canvas.width=canvas.height=1; }
    }
    if(!text.trim()) warnings.push(`Page ${n}: no readable text found${mode==="never"?"; enable OCR for scanned pages":"; the page may be blank or unreadable"}.`);
    if(source==="embedded-text") tables.push(...tablesFromPdfRows(rows,n));
    const lines=text.split(/\n+/).map((line)=>line.replace(/\s+/g," ").trim()).filter(Boolean);
    pages.push({index:n,label:`Page ${n}`,source,confidence,text:lines.join("\n"),lines});
    page.cleanup?.();
  }
  if(!pages.some(page=>page.text.trim())) throw new Error(mode==="never"?"No readable PDF text found. Enable OCR for scanned pages and analyse again.":"No readable PDF text found. Try a clearer scan or another OCR language.");
  const text=pages.map((p)=>`--- Page ${p.index} ---\n${p.text}`).join("\n\n");
  if(ocrCount) warnings.push(`${ocrCount} page(s) required OCR. Review names, numbers and tables before relying on the result.`);
  if(tables.length) warnings.push("PDF tables are candidates based on aligned columns. Compare every row with the original; complex layouts and merged cells may need correction.");
  return makeModel({sourceType:"pdf",text,units:pages,tables,ocrCount,warnings});
  } finally {
    await state.loadingTask?.destroy().catch(()=>{}); state.loadingTask=null;
  }
}

async function parseImage(){
  const blob=new Blob([state.buffer],{type:state.file.type||"image/png"}); const url=URL.createObjectURL(blob);
  try{
    const result=await ocrImageSource(url,state.file.name,0,100); const lines=result.text.split(/\n+/).map((l)=>l.trim()).filter(Boolean);
    if(!result.text.trim()) throw new Error("No readable image text found. Try a clearer image or another OCR language.");
    return makeModel({sourceType:"image",text:result.text,units:[{index:1,label:"Image OCR",source:"ocr",confidence:result.confidence,text:result.text,lines}],tables:[],ocrCount:1,warnings:["Image OCR is probabilistic. Review names, dates, amounts and identifiers before using the output."]});
  } finally { URL.revokeObjectURL(url); }
}
async function parseDocx(){
  if(!window.mammoth) throw new Error("Mammoth DOCX parser is unavailable. Reload the page and retry.");
  const result=await window.mammoth.extractRawText({arrayBuffer:state.buffer.slice(0)}); const text=String(result.value||"").trim();
  const warnings=(result.messages||[]).map((m)=>String(m.message||m)); warnings.push("DOCX conversion extracts readable text; complex Word layout, floating shapes and exact styling are not preserved.");
  return makeModel({sourceType:"docx",text,units:[{index:1,label:"Document text",source:"mammoth",text,lines:text.split(/\n+/).filter(Boolean)}],tables:[],warnings});
}
async function parseWorkbook(){
  if(!window.XLSX) throw new Error("SheetJS is unavailable. Reload the page and retry.");
  const wb=window.XLSX.read(state.buffer,{type:"array",cellDates:true}); const units=[],tables=[],parts=[];
  wb.SheetNames.forEach((name,index)=>{
    const ws=wb.Sheets[name]; const rows=window.XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:"",blankrows:false});
    const clean=rows.map((row)=>row.map((cell)=>String(cell??"").trim())).filter((row)=>row.some(Boolean));
    tables.push({id:`sheet-${index+1}`,name,rows:clean});
    const text=clean.map((row)=>row.join("\t")).join("\n"); units.push({index:index+1,label:name,source:"sheetjs",text,lines:text.split(/\n+/).filter(Boolean)}); parts.push(`--- Sheet: ${name} ---\n${text}`);
  });
  return makeModel({sourceType:state.sourceKind,text:parts.join("\n\n"),units,tables,warnings:["Spreadsheet formulas are exported as their calculated/displayed cell values. Macros, charts and workbook styling are not preserved in text conversions."]});
}
function decodeText(){
  const bytes=new Uint8Array(state.buffer); let text=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
  if(text.charCodeAt(0)===0xFEFF) text=text.slice(1); return text;
}
function tableFromDelimited(rows,name="Table 1"){
  return {id:"table-1",name,rows:rows.map((row)=>row.map((cell)=>String(cell??"")))};
}
async function parseDelimited(kind){
  const text=decodeText();
  if(!window.Papa) throw new Error("Papa Parse is unavailable. Reload the page and retry.");
  const config={skipEmptyLines:"greedy",delimiter:kind==="tsv"?"\t":""}; const result=window.Papa.parse(text,config);
  if(result.errors?.length) log(`Parser reported ${result.errors.length} CSV/TSV issue(s); usable rows will still be loaded.`,"warn");
  const rows=result.data||[]; const normalized=rows.map((row)=>Array.isArray(row)?row:[row]).filter((row)=>row.some((cell)=>String(cell??"").trim()));
  const plain=normalized.map((row)=>row.join("\t")).join("\n");
  return makeModel({sourceType:kind,text:plain,units:[{index:1,label:"Delimited data",source:"papaparse",text:plain,lines:plain.split(/\n+/).filter(Boolean)}],tables:[tableFromDelimited(normalized,state.file.name)],warnings:result.errors?.slice(0,10).map((e)=>e.message)||[]});
}
async function parseTextLike(kind){
  const raw=decodeText(); let text=raw, warnings=[], tables=[];
  if(kind==="json"){
    try{const parsed=JSON.parse(raw); text=JSON.stringify(parsed,null,2); if(Array.isArray(parsed) && parsed.every((x)=>x && typeof x==="object" && !Array.isArray(x))){const headers=[...new Set(parsed.flatMap((x)=>Object.keys(x)))]; const rows=[headers,...parsed.map((x)=>headers.map((h)=>x[h]??""))]; tables=[tableFromDelimited(rows,"JSON records")];}}catch(error){throw new Error(`Invalid JSON: ${error.message}`);}
  } else if(kind==="xml"){
    const doc=new DOMParser().parseFromString(raw,"application/xml"); const err=doc.querySelector("parsererror"); if(err) throw new Error("Invalid XML: the document could not be parsed."); text=raw.trim();
  } else if(kind==="html"){
    const doc=new DOMParser().parseFromString(raw,"text/html"); doc.querySelectorAll("script,style,noscript").forEach((el)=>el.remove()); text=(doc.body?.innerText||doc.body?.textContent||"").replace(/\n{3,}/g,"\n\n").trim(); warnings.push("HTML input is exported as visible text; CSS layout and scripts are intentionally not executed or reproduced.");
  } else if(kind==="md") warnings.push("Markdown source is preserved as text. Generated DOCX/PDF uses readable text rather than a full Markdown renderer.");
  return makeModel({sourceType:kind,text,units:[{index:1,label:"Document",source:"native",text,lines:text.split(/\n+/).filter(Boolean)}],tables,warnings});
}

async function analyze(){
  if(!state.buffer || state.busy) return;
  state.cancelRequested=false; state.model=null; setBusy(true); showWarning(""); editor.value=""; updateMetrics(null); updateSummaries(); $("exportHint").textContent="Analysis in progress"; setStatus("Starting analysis…",state.sourceKind.toUpperCase(),1); log(`Starting ${state.sourceKind.toUpperCase()} analysis.`);
  try{
    let model;
    if(state.sourceKind==="pdf") model=await parsePdf();
    else if(state.sourceKind==="image") model=await parseImage();
    else if(state.sourceKind==="docx") model=await parseDocx();
    else if(["xlsx","xls"].includes(state.sourceKind)) model=await parseWorkbook();
    else if(["csv","tsv"].includes(state.sourceKind)) model=await parseDelimited(state.sourceKind);
    else model=await parseTextLike(state.sourceKind);
    if(state.cancelRequested) throw new DOMException("Conversion cancelled by user.","AbortError");
    state.model=model; editor.value=model.text; updateMetrics(model); updateSummaries(); enableExports();
    setStatus("Analysis complete",`${model.sourceType.toUpperCase()} · ${model.text.length.toLocaleString("en-ZA")} characters`,100); log("Analysis completed successfully.","success");
    if(model.warnings.length){showWarning(model.warnings.join(" ")); model.warnings.forEach((w)=>log(w,"warn"));}
  }catch(error){
    console.error(error);
    const cancelled=state.cancelRequested || error?.name==="AbortError"; setStatus(cancelled?"Conversion cancelled":"Conversion failed",cancelled?"Cancelled":"Error",0); $("exportHint").textContent="Analyse a file to enable export"; log(cancelled?"Conversion cancelled by user.":`Conversion failed: ${error?.message||error}`,cancelled?"warn":"error");
    if(!cancelled) showWarning(error?.message||"The conversion failed.");
  }finally{ state.rejectCancel=null; await state.ocrWorker?.terminate().catch(()=>{}); state.ocrWorker=null; setBusy(false); if(state.model) enableExports(); }
}

function exportTxt(){downloadBlob(new Blob([currentText()],{type:"text/plain;charset=utf-8"}),`${baseName()}.txt`);}
function exportMarkdown(){
  const m=modelForExport(); const heading=`# ${baseName()}\n\n> Converted by EasyFile from ${m.sourceType.toUpperCase()} on ${new Date(m.convertedAt).toLocaleString("en-ZA")}\n\n`;
  downloadBlob(new Blob([heading+currentText()],{type:"text/markdown;charset=utf-8"}),`${baseName()}.md`);
}
function exportHtml(){
  const body=escapeHtml(currentText()); const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(baseName())}</title><style>body{max-width:900px;margin:40px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.6;color:#111827}pre{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(baseName())}</h1><pre>${body}</pre></body></html>`;
  downloadBlob(new Blob([html],{type:"text/html;charset=utf-8"}),`${baseName()}.html`);
}
function exportJson(){downloadBlob(new Blob([JSON.stringify(modelForExport(),null,2)],{type:"application/json;charset=utf-8"}),`${baseName()}.json`);}
function exportXml(){
  const m=modelForExport(); const units=m.units.map((u)=>`  <unit index="${u.index}" label="${xmlEscape(u.label)}" source="${xmlEscape(u.source||"")}"><text>${xmlEscape(u.text)}</text></unit>`).join("\n");
  const tables=m.tables.map((t)=>`  <table id="${xmlEscape(t.id)}" name="${xmlEscape(t.name||t.id)}">${t.rows.map((row)=>`<row>${row.map((cell)=>`<cell>${xmlEscape(cell)}</cell>`).join("")}</row>`).join("")}</table>`).join("\n");
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<easyFileConversion sourceFile="${xmlEscape(m.sourceFile)}" sourceType="${xmlEscape(m.sourceType)}" convertedAt="${xmlEscape(m.convertedAt)}">\n  <text>${xmlEscape(currentText())}</text>\n${units}\n${tables}\n</easyFileConversion>`;
  downloadBlob(new Blob([xml],{type:"application/xml;charset=utf-8"}),`${baseName()}.xml`);
}
function exportCsv(){
  const m=modelForExport(); let rows;
  if(m.tables.length){rows=[]; m.tables.forEach((table)=>{rows.push([`# ${table.name||table.id}`]); table.rows.forEach((row)=>rows.push(row.map(safeCell))); rows.push([]);});}
  else rows=[["line_number","text"],...currentText().split(/\n/).map((line,i)=>[i+1,safeCell(line)])];
  const csv=rows.map(row=>row.map(cell=>`"${String(cell??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
  downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),`${baseName()}.csv`);
}
function exportXlsx(){
  if(!window.XLSX) throw new Error("SheetJS is unavailable."); const m=modelForExport(); const wb=window.XLSX.utils.book_new();
  const summary=[{source_file:m.sourceFile,source_type:m.sourceType,units:m.unitCount,tables:m.tables.length,ocr_count:m.ocrCount,characters:currentText().length,converted_at:m.convertedAt}];
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(summary),"Summary");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.aoa_to_sheet([["line_number","text"],...currentText().split(/\n/).map((line,i)=>[i+1,safeCell(line)])]),"Content");
  m.tables.forEach((table,index)=>{
    const base=String(table.name||`Table ${index+1}`).replace(/[\\/?*\[\]:]/g," ").replace(/^'+|'+$/g,"").slice(0,31)||`Table ${index+1}`;
    let name=base, suffix=1;
    while(wb.SheetNames.some(existing=>existing.toLowerCase()===name.toLowerCase())){const tail=` (${suffix++})`;name=base.slice(0,31-tail.length)+tail;}
    window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.aoa_to_sheet(table.rows.map(r=>r.map(safeCell))),name);
  });
  window.XLSX.writeFile(wb,`${baseName()}.xlsx`,{compression:true});
}
async function exportDocx(){
  if(!window.docx?.Document || !window.docx?.Packer){
    if(!window.EasyFileDocxFallback?.createDocument) throw new Error("DOCX export engines are unavailable. Reload the page.");
    const m=modelForExport();
    const blocks=[
      {type:"paragraph",style:"title",text:baseName()},
      {type:"paragraph",text:"Converted from "+m.sourceFile+" ("+m.sourceType.toUpperCase()+") with EasyFile."}
    ];
    currentText().split(/\n/).forEach((line)=>blocks.push({type:"paragraph",text:line}));
    if(m.tables.length){
      blocks.push({type:"paragraph",style:"heading1",text:"Structured tables"});
      m.tables.forEach((table,index)=>{
        blocks.push({type:"paragraph",style:"heading2",text:table.name||"Table "+(index+1)});
        if(table.rows.length) blocks.push({type:"table",rows:table.rows});
      });
    }
    downloadBlob(window.EasyFileDocxFallback.createDocument({blocks}),baseName()+".docx");
    log("DOCX created with the browser-local export engine.","success");
    return;
  }
  const {Document,Packer,Paragraph,HeadingLevel,TextRun,Table,TableRow,TableCell}=window.docx; const m=modelForExport(); const children=[];
  children.push(new Paragraph({heading:HeadingLevel.TITLE,children:[new TextRun(baseName())]}));
  children.push(new Paragraph({text:`Converted from ${m.sourceFile} (${m.sourceType.toUpperCase()}) with EasyFile.`}));
  currentText().split(/\n/).forEach((line)=>children.push(new Paragraph({text:line||" "})));
  if(m.tables.length){
    children.push(new Paragraph({heading:HeadingLevel.HEADING_1,text:"Structured tables"}));
    m.tables.forEach((table,index)=>{children.push(new Paragraph({heading:HeadingLevel.HEADING_2,text:table.name||`Table ${index+1}`})); const rows=table.rows.map((row)=>new TableRow({children:row.map((cell)=>new TableCell({children:[new Paragraph({text:String(cell??"")})]}))})); if(rows.length)children.push(new Table({rows}));});
  }
  const blob=await Packer.toBlob(new Document({sections:[{properties:{},children}]})); downloadBlob(blob,`${baseName()}.docx`);
}
function exportPdf(){
  // Rebuild from corrected text when a PDF input has been edited; original PDF would lose edits.
  if(state.sourceKind==="pdf" && state.file && currentText()===state.model.text){downloadBlob(state.file,state.file.name); log("Downloaded the unchanged original PDF.","success"); return;}
  if(!window.jspdf?.jsPDF) throw new Error("jsPDF is unavailable.");
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:"pt",format:"a4",compress:true}); const margin=48, pageWidth=doc.internal.pageSize.getWidth(), pageHeight=doc.internal.pageSize.getHeight(), width=pageWidth-margin*2; doc.setFont("helvetica","normal"); doc.setFontSize(10);
  const lines=doc.splitTextToSize(currentText()||" ",width); let y=margin; lines.forEach((line)=>{if(y>pageHeight-margin){doc.addPage();y=margin;}doc.text(line,margin,y);y+=14;}); doc.save(`${baseName()}${state.sourceKind==="pdf"?"-edited":""}.pdf`);
}
async function runExport(format){
  if(!state.model || state.busy) return;
  setBusy(true); cancelBtn.disabled=true; showWarning(""); $("exportHint").textContent=`Preparing ${format.toUpperCase()}…`;
  try{
    if(format==="txt") exportTxt(); else if(format==="md") exportMarkdown(); else if(format==="html") exportHtml(); else if(format==="json") exportJson(); else if(format==="xml") exportXml(); else if(format==="csv") exportCsv(); else if(format==="xlsx") exportXlsx(); else if(format==="docx") await exportDocx(); else if(format==="pdf") exportPdf();
    log(`${format.toUpperCase()} export started.`,"success");
  }catch(error){console.error(error); showWarning(error?.message||"Export failed."); log(`Export failed: ${error?.message||error}`,"error");}
  finally{setBusy(false); enableExports();}
}
async function copyText(){
  const text=currentText(); if(!text)return;
  try{await navigator.clipboard.writeText(text);log("Corrected text copied to clipboard.","success");}
  catch{const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();}
}
function resetAll(){
  ++state.readVersion;
  state.file=null;state.buffer=null;state.sourceKind=null;state.model=null;state.cancelRequested=false;fileInput.value="";$("fileMeta").textContent="No file selected yet.";editor.value="";showWarning("");updateMetrics(null);updateSummaries();analyzeBtn.disabled=true;copyBtn.disabled=true;exportButtons.forEach((b)=>b.disabled=true);$("exportHint").textContent="Analyse a file to enable export";setStatus("Awaiting file upload","Idle",0);setBusy(false);log("State reset. Ready for another file.");
}

fileInput.addEventListener("change",(event)=>setFile(event.target.files?.[0]));
dropzone.addEventListener("click",()=>{if(!state.busy)fileInput.click();});
dropzone.addEventListener("keydown",(event)=>{if((event.key==="Enter"||event.key===" ")&&!state.busy){event.preventDefault();fileInput.click();}});
["dragenter","dragover"].forEach((name)=>dropzone.addEventListener(name,(event)=>{event.preventDefault();if(!state.busy)dropzone.classList.add("dragover");}));
["dragleave","drop"].forEach((name)=>dropzone.addEventListener(name,(event)=>{event.preventDefault();dropzone.classList.remove("dragover");}));
dropzone.addEventListener("drop",(event)=>{if(!state.busy)setFile(event.dataTransfer?.files?.[0]);});
analyzeBtn.addEventListener("click",analyze);
cancelBtn.addEventListener("click",()=>{state.cancelRequested=true;cancelBtn.disabled=true;state.rejectCancel?.(new DOMException("Conversion cancelled by user.","AbortError"));state.renderTask?.cancel();state.loadingTask?.destroy().catch(()=>{});state.ocrWorker?.terminate().catch(()=>{});setStatus("Cancellation requested…","Stopping conversion",null);log("Cancellation requested.","warn");});
resetBtn.addEventListener("click",resetAll);
copyBtn.addEventListener("click",copyText);
$("clearLogBtn").addEventListener("click",(event)=>{event.preventDefault();event.stopPropagation();$("logBody").textContent="";});
editor.addEventListener("input",()=>{copyBtn.disabled=!editor.value;if(state.model){enableExports();updateMetrics({...state.model,text:editor.value});$("exportHint").textContent="Exports enabled · corrected text will be used";}});
exportButtons.forEach((button)=>button.addEventListener("click",()=>runExport(button.dataset.format)));
window.addEventListener("load",libraryHealth,{once:true});
loadPdf().then(libraryHealth).catch(libraryHealth);
setTimeout(libraryHealth,1200);
resetAll();
