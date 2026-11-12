(function(){"use strict";
const $=id=>document.getElementById(id);
const FORM_KEY="easy.form.forms.v1",RESPONSE_KEY="easy.form.responses.v1",DRAFT_KEY="easy.form.draft.v1",OWNER_KEY="easy.form.owner-token.v1";
const API_BASE="https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-form";
let forms=read(FORM_KEY,[]),responses=read(RESPONSE_KEY,[]),current=null,published=false,publicMode=false;
let ownerToken=read(OWNER_KEY,"");
if(!ownerToken){ownerToken=(window.crypto&&crypto.randomUUID?crypto.randomUUID()+crypto.randomUUID():uid("owner")+uid("owner"));write(OWNER_KEY,ownerToken)}

function read(k,f){try{const v=JSON.parse(localStorage.getItem(k)||JSON.stringify(f));return v??f}catch(_){return f}}
function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(_){return false}}
function uid(prefix){if(window.crypto&&crypto.randomUUID)return prefix+"-"+crypto.randomUUID();return prefix+"-"+Date.now()+"-"+Math.random().toString(16).slice(2)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function now(){return new Date().toISOString()}
function toast(msg){if($("aiStatus"))$("aiStatus").textContent=msg;clearTimeout(toast.t);toast.t=setTimeout(()=>{if($("aiStatus"))$("aiStatus").textContent="Local generation is available immediately."},2600)}
function shareUrl(){return location.origin+location.pathname+"?form="+encodeURIComponent(current.id)}
function apiHeaders(owner=false){const h={"Content-Type":"application/json"};if(owner)h["X-EasyForm-Owner-Token"]=ownerToken;return h}
async function api(path,options={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(API_BASE+path,{...options,signal:controller.signal});let data={};try{data=await r.json()}catch(_){data={}}if(!r.ok)throw new Error(data.message||data.error||("HTTP "+r.status));return data}finally{clearTimeout(timer)}}
function setPublishState(isPublished,message){published=!!isPublished;const status=$("publishStatus"),link=$("shareUrl");if(status)status.textContent=message||(published?"Published online and ready to collect responses.":"Draft is stored in this browser until you publish it online.");if(link){link.textContent=published?shareUrl():"Not published";link.href=published?shareUrl():"#"}}
async function publishForm(){fromUI();if(!current.fields.length)return toast("Add at least one question before publishing.");$("publishStatus").textContent="Publishing form…";try{await api("/forms",{method:"POST",headers:{...apiHeaders(true),"X-EasyForm-Owner-Token":ownerToken},body:JSON.stringify({...current,ownerToken})});saveLocal();setPublishState(true);toast("Form published online.");return true}catch(error){setPublishState(false,"Publish failed: "+error.message);toast("Could not publish online.");return false}}
async function copyShareLink(){if(!published){const ok=await publishForm();if(!ok)return}try{await navigator.clipboard.writeText(shareUrl());toast("Share link copied.")}catch(_){prompt("Copy this share link:",shareUrl())}}
async function loadRemoteForm(id){$("publishStatus").textContent="Loading published form…";const data=await api("/forms/"+encodeURIComponent(id));current={...blankForm(),...data.form,id:data.form.id,fields:Array.isArray(data.form.fields)?data.form.fields:[]};publicMode=true;setPublishState(true,"Published form loaded. Responses are submitted securely online.");toUI();document.querySelectorAll(".ef-tab").forEach(x=>x.setAttribute("aria-selected",String(x.dataset.tab==="preview")));document.querySelectorAll(".ef-view").forEach(v=>v.classList.add("hidden"));$("view-preview").classList.remove("hidden");document.querySelectorAll("#btnSaveForm,#btnPublishForm,#btnCopyShareLink,#btnNewForm,#btnSeed,#btnExportForm").forEach(el=>{if(el)el.classList.add("hidden")})}
function download(name,blob){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0)}
function csv(v){const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}

function blankForm(){return{id:uid("form"),title:"Untitled form",category:"Business",description:"",fields:[],settings:{anonymous:false,oneResponse:false,confirm:true,collectEmail:false,confirmationMessage:"Thank you. Your response has been received.",owner:"",retentionDays:365},createdAt:now(),updatedAt:now()}}
function makeField(type,label){return{id:uid("field"),type,label:label||fieldLabel(type),help:"",required:false,placeholder:"",options:(type==="select"||type==="radio"||type==="checkbox")?["Option 1","Option 2"]:[],min:1,max:5}}
function fieldLabel(type){return({text:"Short answer",textarea:"Long answer",email:"Email address",tel:"Phone number",number:"Number",date:"Date",select:"Choose an option",radio:"Select one",checkbox:"Select all that apply",rating:"Rating",consent:"Consent"})[type]||"Question"}

function fromUI(){
 current.title=$("formTitle").value.trim()||"Untitled form";
 current.category=$("formCategory").value;
 current.description=$("formDescription").value.trim();
 current.settings={anonymous:$("settingAnonymous").checked,oneResponse:$("settingOneResponse").checked,confirm:$("settingConfirm").checked,collectEmail:$("settingCollectEmail").checked,confirmationMessage:$("confirmationMessage").value.trim()||"Thank you. Your response has been received.",owner:$("responseOwner").value.trim(),retentionDays:Math.max(1,Number($("retentionDays").value||365))};
 current.updatedAt=now();
 write(DRAFT_KEY,current);
}
function toUI(){
 $("formTitle").value=current.title||"";$("formCategory").value=current.category||"Business";$("formDescription").value=current.description||"";
 const s=current.settings||{};$("settingAnonymous").checked=!!s.anonymous;$("settingOneResponse").checked=!!s.oneResponse;$("settingConfirm").checked=s.confirm!==false;$("settingCollectEmail").checked=!!s.collectEmail;$("confirmationMessage").value=s.confirmationMessage||"Thank you. Your response has been received.";$("responseOwner").value=s.owner||"";$("retentionDays").value=s.retentionDays||365;
 renderFields();renderPreview();renderSaved();renderResponses();renderKpis();
}

function renderFields(){
 const host=$("fieldList");host.innerHTML="";
 if(!current.fields.length){host.innerHTML='<div class="ef-empty">No questions yet. Add one manually or ask the AI Form Assistant to create a draft.</div>';return}
 current.fields.forEach((f,i)=>{
  const d=document.createElement("div");d.className="ef-field-card";d.innerHTML=`
   <div class="flex flex-col md:flex-row md:items-start gap-3">
    <div class="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
     <div><label class="ef-label">Question</label><input class="ef-field" data-prop="label" data-id="${f.id}" value="${esc(f.label)}"></div>
     <div><label class="ef-label">Type</label><select class="ef-field" data-prop="type" data-id="${f.id}">${["text","textarea","email","tel","number","date","select","radio","checkbox","rating","consent"].map(t=>'<option value="'+t+'" '+(f.type===t?'selected':'')+'>'+fieldLabel(t)+'</option>').join("")}</select></div>
     <div><label class="ef-label">Help text</label><input class="ef-field" data-prop="help" data-id="${f.id}" value="${esc(f.help||"")}"></div>
     <div><label class="ef-label">Placeholder</label><input class="ef-field" data-prop="placeholder" data-id="${f.id}" value="${esc(f.placeholder||"")}"></div>
     ${["select","radio","checkbox"].includes(f.type)?'<div class="md:col-span-2"><label class="ef-label">Options (one per line)</label><textarea class="ef-field" rows="3" data-prop="options" data-id="'+f.id+'">'+esc((f.options||[]).join("\n"))+'</textarea></div>':""}
     <label class="text-sm flex items-center gap-2"><input type="checkbox" data-prop="required" data-id="${f.id}" ${f.required?"checked":""}> Required</label>
    </div>
    <div class="flex md:flex-col gap-2 no-print">
      <button class="ef-btn ef-btn-soft" data-move-up="${f.id}" title="Move up" ${i===0?"disabled":""}><i class="fa-solid fa-arrow-up"></i></button>
      <button class="ef-btn ef-btn-soft" data-move-down="${f.id}" title="Move down" ${i===current.fields.length-1?"disabled":""}><i class="fa-solid fa-arrow-down"></i></button>
      <button class="ef-btn ef-btn-soft" data-duplicate="${f.id}" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
      <button class="ef-btn ef-btn-soft" data-delete="${f.id}" title="Delete"><i class="fa-solid fa-trash text-red-600"></i></button>
    </div>
   </div>`;
  host.appendChild(d);
 });
 host.querySelectorAll("[data-prop]").forEach(el=>el.addEventListener("input",()=>{const f=current.fields.find(x=>x.id===el.dataset.id);if(!f)return;const p=el.dataset.prop;if(p==="required")f[p]=el.checked;else if(p==="options")f[p]=el.value.split("\n").map(x=>x.trim()).filter(Boolean);else if(p==="type"){f[p]=el.value;if(["select","radio","checkbox"].includes(f[p])&&!f.options.length)f.options=["Option 1","Option 2"];renderFields()}else f[p]=el.value;fromUI();renderPreview()}));
 host.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{current.fields=current.fields.filter(f=>f.id!==b.dataset.delete);renderFields();renderPreview();fromUI()});
 host.querySelectorAll("[data-duplicate]").forEach(b=>b.onclick=()=>{const i=current.fields.findIndex(f=>f.id===b.dataset.duplicate);if(i<0)return;const clone={...current.fields[i],id:uid("field"),options:[...(current.fields[i].options||[])]};current.fields.splice(i+1,0,clone);renderFields();renderPreview();fromUI()});
 host.querySelectorAll("[data-move-up]").forEach(b=>b.onclick=()=>moveField(b.dataset.moveUp,-1));
 host.querySelectorAll("[data-move-down]").forEach(b=>b.onclick=()=>moveField(b.dataset.moveDown,1));
}
function moveField(id,delta){const i=current.fields.findIndex(f=>f.id===id),j=i+delta;if(i<0||j<0||j>=current.fields.length)return;[current.fields[i],current.fields[j]]=[current.fields[j],current.fields[i]];renderFields();renderPreview();fromUI()}

function control(f){
 const req=f.required?" required":"",ph=f.placeholder?' placeholder="'+esc(f.placeholder)+'"':"";
 if(f.type==="textarea")return '<textarea class="ef-field" rows="4" name="'+f.id+'"'+ph+req+'></textarea>';
 if(f.type==="select")return '<select class="ef-field" name="'+f.id+'"'+req+'><option value="">Select…</option>'+f.options.map(o=>'<option>'+esc(o)+'</option>').join("")+'</select>';
 if(f.type==="radio")return '<div class="space-y-2">'+f.options.map(o=>'<label class="flex gap-2"><input type="radio" name="'+f.id+'" value="'+esc(o)+'"'+req+'><span>'+esc(o)+'</span></label>').join("")+'</div>';
 if(f.type==="checkbox")return '<div class="space-y-2">'+f.options.map(o=>'<label class="flex gap-2"><input type="checkbox" name="'+f.id+'" value="'+esc(o)+'"><span>'+esc(o)+'</span></label>').join("")+'</div>';
 if(f.type==="rating")return '<div class="flex gap-3">'+[1,2,3,4,5].map(n=>'<label class="flex items-center gap-1"><input type="radio" name="'+f.id+'" value="'+n+'"'+req+'><span>'+n+'</span></label>').join("")+'</div>';
 if(f.type==="consent")return '<label class="flex items-start gap-2"><input type="checkbox" name="'+f.id+'" value="Yes"'+req+'><span>'+esc(f.placeholder||"I agree and give consent.")+'</span></label>';
 return '<input class="ef-field" type="'+f.type+'" name="'+f.id+'"'+ph+req+'>';
}
function renderPreview(){
 $("previewTitle").textContent=current.title||"Untitled form";$("previewCategory").textContent=current.category||"Business";$("previewDescription").textContent=current.description||"";$("previewFormId").textContent=current.id;$("previewFieldCount").textContent=current.fields.length;
 const host=$("responseForm");host.innerHTML="";
 if(current.settings?.collectEmail){const q=document.createElement("div");q.className="ef-question";q.innerHTML='<label class="font-black">Respondent email <span class="text-red-600">*</span></label><input class="ef-field mt-2" name="_respondentEmail" type="email" required placeholder="name@example.com">';host.appendChild(q)}
 current.fields.forEach((f,i)=>{const q=document.createElement("div");q.className="ef-question";q.innerHTML='<label class="font-black">'+(i+1)+'. '+esc(f.label)+(f.required?' <span class="text-red-600">*</span>':'')+'</label>'+(f.help?'<p class="text-sm mt-1 mb-2" style="color:var(--ef-muted)">'+esc(f.help)+'</p>':'<div class="mb-2"></div>')+control(f);host.appendChild(q)});
 if(!current.fields.length)host.innerHTML='<div class="ef-empty">Add questions in Builder to preview your form.</div>';
}
function collectResponse(){
 const form=$("responseForm");if(!form.reportValidity())return null;
 const fd=new FormData(form),answers={};
 if(current.settings?.collectEmail)answers._respondentEmail=fd.get("_respondentEmail")||"";
 current.fields.forEach(f=>{answers[f.id]=f.type==="checkbox"?fd.getAll(f.id):f.type==="consent"?(fd.get(f.id)||"No"):(fd.get(f.id)||"")});
 return{id:uid("resp"),formId:current.id,formTitle:current.title,status:"New",answers,submittedAt:now(),reviewedAt:null,reviewNote:""};
}
async function submitResponse(){const r=collectResponse();if(!r)return;const button=$("btnSubmitResponse");if(button)button.disabled=true;try{if(publicMode||published){await api("/forms/"+encodeURIComponent(current.id)+"/responses",{method:"POST",headers:apiHeaders(false),body:JSON.stringify({answers:r.answers,respondentEmail:r.answers?._respondentEmail||""})})}else{responses.unshift(r);write(RESPONSE_KEY,responses);renderResponses();renderKpis()}$("responseForm").reset();$("submitMessage").textContent=current.settings?.confirmationMessage||"Thank you. Your response has been received.";$("submitMessage").classList.remove("hidden")}catch(error){$("submitMessage").textContent="Submission failed: "+error.message;$("submitMessage").classList.remove("hidden")}finally{if(button)button.disabled=false}}
function answerText(r){return current.fields.map(f=>{const v=r.answers?.[f.id];return f.label+": "+(Array.isArray(v)?v.join("; "):String(v??""))}).join(" | ")+" "+(r.answers?._respondentEmail||"")}
async function refreshResponses(){if(!published||publicMode)return;try{const data=await api("/forms/"+encodeURIComponent(current.id)+"/responses",{headers:apiHeaders(true)});responses=(responses||[]).filter(r=>r.formId!==current.id).concat(data.responses||[]);write(RESPONSE_KEY,responses);renderResponses();renderKpis();toast("Responses refreshed.")}catch(error){toast("Could not refresh responses: "+error.message)}}
function renderResponses(){
 const host=$("responseList"),q=($("responseSearch").value||"").toLowerCase(),status=$("responseStatusFilter").value;
 const list=responses.filter(r=>r.formId===current.id).filter(r=>(!status||r.status===status)&&(!q||answerText(r).toLowerCase().includes(q)));
 if(!list.length){host.innerHTML='<div class="ef-empty">No responses match this view.</div>';return}
 host.innerHTML=list.map(r=>'<article class="ef-field-card"><div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><strong>'+esc(r.status)+'</strong><span class="ef-pill">'+esc(new Date(r.submittedAt).toLocaleString("en-ZA"))+'</span></div><div class="mt-3 space-y-1 text-sm">'+current.fields.map(f=>'<div><span class="font-bold">'+esc(f.label)+':</span> '+esc(Array.isArray(r.answers?.[f.id])?r.answers[f.id].join(", "):r.answers?.[f.id]||"—")+'</div>').join("")+(r.answers?._respondentEmail?'<div><span class="font-bold">Respondent email:</span> '+esc(r.answers._respondentEmail)+'</div>':'')+'</div><div class="mt-3"><input class="ef-field" data-note="'+r.id+'" value="'+esc(r.reviewNote||"")+'" placeholder="Reviewer note"></div></div><div class="flex flex-wrap gap-2 no-print"><button class="ef-btn ef-btn-soft" data-status="'+r.id+'" data-next="Reviewed"><i class="fa-solid fa-check"></i> Reviewed</button><button class="ef-btn ef-btn-soft" data-status="'+r.id+'" data-next="Flagged"><i class="fa-solid fa-flag"></i> Flag</button><button class="ef-btn ef-btn-soft" data-delete-response="'+r.id+'"><i class="fa-solid fa-trash text-red-600"></i></button></div></div></article>').join("");
 host.querySelectorAll("[data-status]").forEach(b=>b.onclick=async()=>{const r=responses.find(x=>x.id===b.dataset.status);if(!r)return;r.status=b.dataset.next;r.reviewedAt=now();write(RESPONSE_KEY,responses);renderResponses();renderKpis();if(published){try{await api("/forms/"+encodeURIComponent(current.id)+"/responses/"+encodeURIComponent(r.id),{method:"PATCH",headers:apiHeaders(true),body:JSON.stringify({status:r.status,reviewNote:r.reviewNote||""})})}catch(error){toast("Server update failed: "+error.message)}}});
 host.querySelectorAll("[data-note]").forEach(i=>i.onchange=async()=>{const r=responses.find(x=>x.id===i.dataset.note);if(!r)return;r.reviewNote=i.value;write(RESPONSE_KEY,responses);if(published){try{await api("/forms/"+encodeURIComponent(current.id)+"/responses/"+encodeURIComponent(r.id),{method:"PATCH",headers:apiHeaders(true),body:JSON.stringify({status:r.status,reviewNote:r.reviewNote})})}catch(error){toast("Server note update failed: "+error.message)}}});
 host.querySelectorAll("[data-delete-response]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this response?"))return;const id=b.dataset.deleteResponse;if(published){try{await api("/forms/"+encodeURIComponent(current.id)+"/responses/"+encodeURIComponent(id),{method:"DELETE",headers:apiHeaders(true)})}catch(error){return toast("Server delete failed: "+error.message)}}responses=responses.filter(x=>x.id!==id);write(RESPONSE_KEY,responses);renderResponses();renderKpis()});
}
function renderKpis(){const mine=responses.filter(r=>r.formId===current.id);$("kpiForms").textContent=forms.length;$("kpiResponses").textContent=mine.length;$("kpiReviewed").textContent=mine.filter(r=>r.status==="Reviewed").length;$("kpiFlagged").textContent=mine.filter(r=>r.status==="Flagged").length}
function renderSaved(){const s=$("savedForms");s.innerHTML=forms.length?forms.map(f=>'<option value="'+f.id+'">'+esc(f.title)+'</option>').join(""):'<option value="">No saved forms</option>';if(forms.some(f=>f.id===current.id))s.value=current.id}

function saveLocal(){const i=forms.findIndex(f=>f.id===current.id);if(i>=0)forms[i]=JSON.parse(JSON.stringify(current));else forms.unshift(JSON.parse(JSON.stringify(current)));write(FORM_KEY,forms);renderSaved();renderKpis()}
function saveForm(){fromUI();saveLocal();toast("Draft saved locally.")}
function loadForm(){const f=forms.find(x=>x.id===$("savedForms").value);if(!f)return;current=JSON.parse(JSON.stringify(f));toUI();toast("Form loaded.")}
function deleteForm(){const id=$("savedForms").value;if(!id)return;if(!confirm("Delete this saved form? Existing responses will be retained."))return;forms=forms.filter(f=>f.id!==id);write(FORM_KEY,forms);renderSaved();renderKpis();toast("Saved form deleted.")}
function newForm(){if(!confirm("Start a new form? Save the current form first if needed."))return;current=blankForm();current.fields=[makeField("text","Full name"),makeField("email","Email address")];toUI()}

function seed(){
 const f=blankForm();f.title="Microsoft 365 / Google Workspace Customer Discovery";f.category="Customer Intake";f.description="Use this discovery form to size licensing, migration, identity, security, device management and support requirements.";
 f.fields=[
  {...makeField("text","Organisation name"),required:true,placeholder:"Company / organisation"},
  {...makeField("email","Primary contact email"),required:true},
  {...makeField("number","Approximate number of users"),required:true,placeholder:"e.g. 85"},
  {...makeField("radio","Current productivity platform"),options:["Microsoft 365","Google Workspace","On-premises / mixed","Other"],required:true},
  {...makeField("checkbox","Required workloads"),options:["Email","Office apps","Teams / Meet","Cloud storage","Device management","Security / MFA","Backup","Migration services"]},
  {...makeField("textarea","Domains and existing tenant/workspace details"),placeholder:"List domains, tenant status and known constraints."},
  {...makeField("radio","Target support model"),options:["Licensing only","Managed service","Migration project","Security hardening","Training and adoption"]},
  {...makeField("consent","Consent to process this information"),required:true,placeholder:"I confirm that I am authorised to provide this information and consent to its processing for assessment and quotation purposes."}
 ];f.settings.collectEmail=false;current=f;
 responses=responses.filter(r=>r.formId!==f.id);
 const makeResp=(org,users,platform,status)=>({id:uid("resp"),formId:f.id,formTitle:f.title,status,submittedAt:now(),reviewedAt:status==="New"?null:now(),reviewNote:status==="Flagged"?"Confirm domain ownership and migration scope.":"",answers:{[f.fields[0].id]:org,[f.fields[1].id]:"it@"+org.toLowerCase().replace(/[^a-z0-9]/g,"")+".example",[f.fields[2].id]:String(users),[f.fields[3].id]:platform,[f.fields[4].id]:["Email","Cloud storage","Security / MFA"],[f.fields[5].id]:"Single primary domain; migration assistance required.",[f.fields[6].id]:"Migration project",[f.fields[7].id]:"Yes"}});
 responses.unshift(makeResp("Contoso Africa",84,"Microsoft 365","Reviewed"),makeResp("Northwind Services",42,"Google Workspace","New"),makeResp("Fabrikam Holdings",230,"On-premises / mixed","Flagged"));write(RESPONSE_KEY,responses);
 $("aiPrompt").value="Build a Microsoft 365 or Google Workspace customer discovery form covering user counts, current platform, licensing, migration, security, devices, domains, support and consent.";
 toUI();saveForm();toast("Demo form and 3 responses loaded.");
}

function localGenerate(prompt){
 const p=prompt.toLowerCase(),f=blankForm();f.title=prompt.trim().slice(0,80)||"AI-generated form";f.description="Generated draft. Review every question before publishing.";
 const base=[makeField("text","Full name"),makeField("email","Email address")];
 if(/microsoft|365|workspace|tenant|licen/.test(p)){f.title="Cloud Productivity Customer Discovery";f.category="Customer Intake";f.fields=[makeField("text","Organisation name"),makeField("email","Primary contact email"),makeField("number","Number of users"),{...makeField("radio","Current platform"),options:["Microsoft 365","Google Workspace","On-premises / mixed","Other"]},{...makeField("checkbox","Required services"),options:["Licensing","Migration","Email","Collaboration","Storage","Security / MFA","Device management","Backup","Training"]},makeField("textarea","Domains and tenant/workspace details"),makeField("textarea","Security, compliance and support requirements"),makeField("consent","Consent to process this information")]}
 else if(/event|register|training|course/.test(p)){f.category="Registration";f.fields=[...base,makeField("text","Organisation"),makeField("text","Role / job title"),makeField("select","Preferred attendance mode"),makeField("textarea","Learning goals or accessibility requirements"),makeField("consent","Consent")]}
 else if(/survey|feedback|satisfaction/.test(p)){f.category="Survey";f.fields=[makeField("rating","Overall rating"),makeField("textarea","What worked well?"),makeField("textarea","What should we improve?"),makeField("radio","May we contact you about this feedback?")]}
 else if(/lead|sales|quote|enquiry/.test(p)){f.category="Lead Capture";f.fields=[...base,makeField("text","Company"),makeField("tel","Phone"),makeField("select","Service of interest"),makeField("textarea","What do you need?"),makeField("date","Required-by date"),makeField("consent","Consent to be contacted")]}
 else f.fields=[...base,makeField("tel","Phone number"),makeField("textarea","Tell us what you need"),makeField("consent","Consent")];
 f.fields.forEach((x,i)=>{if(i<2)x.required=true});return f;
}
async function aiGenerate(){const prompt=$("aiPrompt").value.trim();if(!prompt)return toast("Describe the form you need first.");try{$("aiStatus").textContent="Trying EasyFile AI…";const r=await fetch("/api/easy-form/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,locale:"en-ZA"})});if(!r.ok)throw new Error();const data=await r.json();if(!data||!Array.isArray(data.fields))throw new Error();current={...blankForm(),...data,id:current.id||uid("form"),updatedAt:now()};current.fields=current.fields.map(f=>({...makeField(f.type||"text",f.label||"Question"),...f,id:f.id||uid("field")}));toUI();$("aiStatus").textContent="AI draft generated. Review every question before publishing."}catch(_){current=localGenerate(prompt);toUI();$("aiStatus").textContent="Cloud AI is not configured, so Easy Form generated a local draft instead."}}
async function aiReview(){fromUI();try{$("aiStatus").textContent="Reviewing form…";const r=await fetch("/api/easy-form/review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(current)});if(!r.ok)throw new Error();const data=await r.json();$("aiStatus").textContent=data.summary||data.message||"AI review completed."}catch(_){const issues=[];if(!current.title||current.title==="Untitled form")issues.push("Add a specific form title.");if(current.fields.length<3)issues.push("Consider whether more context is needed.");if(!current.fields.some(f=>f.required))issues.push("No fields are required.");if(current.fields.some(f=>f.type==="consent"&&!f.required))issues.push("Review whether the consent field should be required.");$("aiStatus").textContent=issues.length?issues.join(" "):"Local review found no obvious structural issues."}}

function exportResponses(type){const list=responses.filter(r=>r.formId===current.id);if(type==="json")return download("easy-form-responses.json",new Blob([JSON.stringify(list,null,2)],{type:"application/json"}));const headers=["id","submittedAt","status","reviewNote","respondentEmail",...current.fields.map(f=>f.label)];const rows=list.map(r=>[r.id,r.submittedAt,r.status,r.reviewNote||"",r.answers?._respondentEmail||"",...current.fields.map(f=>Array.isArray(r.answers?.[f.id])?r.answers[f.id].join("; "):r.answers?.[f.id]||"")]);download("easy-form-responses.csv",new Blob([[headers.map(csv).join(","),...rows.map(row=>row.map(csv).join(","))].join("\n")],{type:"text/csv;charset=utf-8"}))}
function schema(){return{$schema:"https://json-schema.org/draft/2020-12/schema",title:current.title,description:current.description,type:"object",properties:Object.fromEntries(current.fields.map(f=>[f.id,{title:f.label,type:f.type==="number"?"number":f.type==="checkbox"?"array":f.type==="consent"?"boolean":"string",enum:["select","radio"].includes(f.type)?f.options:undefined,items:f.type==="checkbox"?{type:"string",enum:f.options}:undefined}])),required:current.fields.filter(f=>f.required).map(f=>f.id)}}

document.querySelectorAll(".ef-tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".ef-tab").forEach(x=>x.setAttribute("aria-selected",String(x===b)));document.querySelectorAll(".ef-view").forEach(v=>v.classList.add("hidden"));$("view-"+b.dataset.tab).classList.remove("hidden");if(b.dataset.tab==="preview")renderPreview();if(b.dataset.tab==="responses")renderResponses()});
$("btnAddField").onclick=()=>{current.fields.push(makeField($("newFieldType").value));renderFields();renderPreview();fromUI()};
["formTitle","formCategory","formDescription","settingAnonymous","settingOneResponse","settingConfirm","settingCollectEmail","confirmationMessage","responseOwner","retentionDays"].forEach(id=>$(id).addEventListener("input",()=>{fromUI();renderPreview()}));
$("btnSubmitResponse").onclick=submitResponse;$("btnClearResponse").onclick=()=>{$("responseForm").reset();$("submitMessage").classList.add("hidden")};
$("responseSearch").oninput=renderResponses;$("responseStatusFilter").onchange=renderResponses;
$("btnSaveForm").onclick=saveForm;$("btnPublishForm").onclick=publishForm;$("btnCopyShareLink").onclick=copyShareLink;$("btnRefreshResponses").onclick=refreshResponses;$("btnLoadForm").onclick=loadForm;$("btnDeleteForm").onclick=deleteForm;$("btnNewForm").onclick=newForm;$("btnSeed").onclick=seed;$("btnAiGenerate").onclick=aiGenerate;$("btnAiReview").onclick=aiReview;
$("btnExportForm").onclick=()=>{fromUI();download("easy-form-"+current.id+".json",new Blob([JSON.stringify(current,null,2)],{type:"application/json"}))};
$("btnExportResponsesCsv").onclick=()=>exportResponses("csv");$("btnExportResponsesJson").onclick=()=>exportResponses("json");
$("btnCopySchema").onclick=async()=>{const txt=JSON.stringify(schema(),null,2);try{await navigator.clipboard.writeText(txt);toast("JSON Schema copied.")}catch(_){download("easy-form-schema.json",new Blob([txt],{type:"application/json"}));toast("Schema downloaded.")}};

current=read(DRAFT_KEY,null)||forms[0]||blankForm();if(!current.fields)current.fields=[];toUI();setPublishState(false);
const requestedForm=new URLSearchParams(location.search).get("form");
if(requestedForm){loadRemoteForm(requestedForm).catch(error=>{setPublishState(false,"Could not load published form: "+error.message);toast("Published form could not be loaded.")})}
})();