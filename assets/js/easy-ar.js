(function(){
"use strict";
const K={
 invoices:"easy.ar.invoices.v1",payments:"easy.ar.payments.v1",recurring:"easy.ar.recurring.v1",
 reminders:"easy.ar.reminders.v1",credits:"easy.ar.credits.v1",audit:"easy.ar.audit.v1",
 settings:"easy.ar.settings.v1",attachments:"easy.ar.attachments.v1",transfer:"easy.ar.transfer.v1"
};
const now=()=>new Date().toISOString();
const uid=(p="id")=>p+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
const read=(k,f=[])=>{try{const v=JSON.parse(localStorage.getItem(k)||"");return v??f}catch{return f}};
const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const clone=v=>JSON.parse(JSON.stringify(v));
function audit(action,entityType,entityId,detail={}){
 const a=read(K.audit,[]); a.unshift({id:uid("evt"),at:now(),action,entityType,entityId,detail});
 write(K.audit,a.slice(0,1000));
}
function payments(){return read(K.payments,[])}
function invoices(){return read(K.invoices,[])}
function credits(){return read(K.credits,[])}
function invoicePayments(id){return payments().filter(x=>x.invoiceId===id)}
function paymentTotal(id){return invoicePayments(id).reduce((s,x)=>s+num(x.amount),0)}
function creditTotal(id){return credits().filter(x=>x.invoiceId===id&&x.status!=="void").reduce((s,x)=>s+num(x.amount),0)}
function balance(inv){return Math.max(0,num(inv.total)-paymentTotal(inv.id)-creditTotal(inv.id))}
function deriveStatus(inv){
 const b=balance(inv);
 if(num(inv.total)>0 && b<=0.005) return "Paid";
 if(inv.dueDate && inv.dueDate < new Date().toISOString().slice(0,10) && b>0) return "Overdue";
 if(paymentTotal(inv.id)>0 || creditTotal(inv.id)>0) return "Partially Paid";
 return inv.status==="Draft"?"Draft":"Sent";
}
function normalizeInvoice(x){
 const inv={id:x.id||uid("inv"),number:x.number||x.invNumber||"",reference:x.reference||"",
 issueDate:x.issueDate||new Date().toISOString().slice(0,10),dueDate:x.dueDate||"",currency:x.currency||"ZAR",
 fxRate:num(x.fxRate)||1,type:x.type||"Invoice",status:x.status||"Draft",company:x.company||{},client:x.client||{},
 lines:Array.isArray(x.lines)?x.lines:[],subtotal:num(x.subtotal),vat:num(x.vat),discount:num(x.discount),
 shipping:num(x.shipping),total:num(x.total),notes:x.notes||"",terms:x.terms||"",source:x.source||"easy-invoice",
 createdAt:x.createdAt||now(),updatedAt:now(),paymentUrl:x.paymentUrl||"",inventoryCommitted:!!x.inventoryCommitted
 };
 return inv;
}
function saveInvoice(x){
 let list=invoices(), inv=normalizeInvoice(x);
 const i=list.findIndex(v=>v.id===inv.id);
 if(i>=0){inv.createdAt=list[i].createdAt||inv.createdAt;list[i]=inv}else list.unshift(inv);
 write(K.invoices,list); audit(i>=0?"invoice.updated":"invoice.created","invoice",inv.id,{number:inv.number,total:inv.total});
 return inv;
}
function deleteInvoice(id){write(K.invoices,invoices().filter(x=>x.id!==id));audit("invoice.deleted","invoice",id)}
function addPayment(p){
 const rec={id:p.id||uid("pay"),invoiceId:p.invoiceId,date:p.date||new Date().toISOString().slice(0,10),
 amount:Math.max(0,num(p.amount)),method:p.method||"EFT",reference:p.reference||"",notes:p.notes||"",createdAt:now()};
 const list=payments();list.unshift(rec);write(K.payments,list);audit("payment.recorded","invoice",p.invoiceId,{paymentId:rec.id,amount:rec.amount,method:rec.method});return rec;
}
function removePayment(id){const p=payments().find(x=>x.id===id);write(K.payments,payments().filter(x=>x.id!==id));if(p)audit("payment.deleted","invoice",p.invoiceId,{paymentId:id})}
function addCredit(c){
 const rec={id:c.id||uid("cn"),invoiceId:c.invoiceId,number:c.number||("CN-"+Date.now().toString().slice(-6)),date:c.date||new Date().toISOString().slice(0,10),
 amount:Math.max(0,num(c.amount)),reason:c.reason||"",status:c.status||"issued",createdAt:now()};
 const list=credits();list.unshift(rec);write(K.credits,list);audit("credit.issued","invoice",c.invoiceId,{creditId:rec.id,amount:rec.amount});return rec;
}
function getSettings(){return Object.assign({baseCurrency:"ZAR",paymentProvider:"EFT",paymentBaseUrl:"",defaultTermsDays:7,defaultVat:15},read(K.settings,{}))}
function saveSettings(s){write(K.settings,Object.assign(getSettings(),s));audit("settings.updated","settings","ar")}
function aging(asOf=new Date().toISOString().slice(0,10)){
 const b={current:0,d1_30:0,d31_60:0,d61_90:0,d90plus:0,total:0};
 invoices().forEach(inv=>{const bal=balance(inv);if(bal<=0)return; b.total+=bal; const due=inv.dueDate||inv.issueDate;
  const d=Math.floor((new Date(asOf+"T00:00:00")-new Date(due+"T00:00:00"))/86400000);
  if(d<=0)b.current+=bal; else if(d<=30)b.d1_30+=bal; else if(d<=60)b.d31_60+=bal; else if(d<=90)b.d61_90+=bal; else b.d90plus+=bal;
 }); return b;
}
function customerLedger(key){
 const q=String(key||"").trim().toLowerCase(); const invs=invoices().filter(i=>{
  const c=i.client||{};return [c.name,c.email,c.vat,c.reg].some(v=>String(v||"").toLowerCase()===q)||String(c.name||"").toLowerCase().includes(q);
 });
 return invs.map(i=>({invoice:i,payments:invoicePayments(i.id),credits:credits().filter(c=>c.invoiceId===i.id),balance:balance(i),status:deriveStatus(i)}));
}
function recurring(){return read(K.recurring,[])}
function saveRecurring(r){
 const list=recurring(); const rec=Object.assign({id:uid("rec"),frequency:"monthly",interval:1,nextDate:new Date().toISOString().slice(0,10),active:true,template:{}},r);
 const i=list.findIndex(x=>x.id===rec.id); if(i>=0)list[i]=rec;else list.unshift(rec);write(K.recurring,list);audit("recurring.saved","recurring",rec.id);return rec;
}
function nextDate(iso,freq,interval=1){const d=new Date(iso+"T00:00:00");if(freq==="weekly")d.setDate(d.getDate()+7*interval);else if(freq==="yearly")d.setFullYear(d.getFullYear()+interval);else d.setMonth(d.getMonth()+interval);return d.toISOString().slice(0,10)}
function runRecurring(asOf=new Date().toISOString().slice(0,10)){
 let list=recurring(),created=[];
 list=list.map(r=>{if(!r.active||r.nextDate>asOf)return r;let guard=0,nr={...r};while(nr.nextDate<=asOf&&guard++<24){
   const inv=saveInvoice(Object.assign({},clone(nr.template),{id:null,number:"INV-"+Date.now().toString().slice(-7)+"-"+guard,issueDate:nr.nextDate,dueDate:nextDate(nr.nextDate,"weekly",1),status:"Draft",source:"recurring"}));
   created.push(inv);nr.nextDate=nextDate(nr.nextDate,nr.frequency,nr.interval||1);
 }return nr});write(K.recurring,list);return created;
}
function reminderStage(inv,asOf=new Date().toISOString().slice(0,10)){
 if(balance(inv)<=0)return null;const due=inv.dueDate;if(!due)return null;const d=Math.floor((new Date(asOf+"T00:00:00")-new Date(due+"T00:00:00"))/86400000);
 if(d>=14)return"final";if(d>=7)return"overdue7";if(d>=0)return"due";if(d>=-3)return"before";return null;
}
function reminderText(inv){
 const stage=reminderStage(inv),bal=balance(inv),name=inv.client?.name||"Customer",co=inv.company?.name||"";
 const intro=stage==="final"?"Final payment notice":stage==="overdue7"?"Overdue payment reminder":stage==="due"?"Payment due reminder":"Upcoming payment reminder";
 return `${intro}: Hi ${name}, invoice ${inv.number} has an outstanding balance of ${inv.currency} ${bal.toFixed(2)} due ${inv.dueDate||"soon"}. Please use ${inv.number} as the payment reference. Thank you${co?", "+co:""}.`;
}
function reminderQueue(){return invoices().map(i=>({invoice:i,stage:reminderStage(i)})).filter(x=>x.stage)}
function createTransfer(type,payload){const rec={id:uid("xfer"),type,payload,createdAt:now()};write(K.transfer,rec);audit("transfer.created",type,rec.id);return rec}
function consumeTransfer(type){const r=read(K.transfer,null);if(!r||r.type!==type)return null;localStorage.removeItem(K.transfer);audit("transfer.consumed",type,r.id);return r.payload}
function crmContacts(){return read("easy.crm.v2",[])}
function inventory(){return read("easy.inventory.v2",[])}
function consumeInventoryForInvoice(inv){
 if(inv.inventoryCommitted)return {ok:true,changes:[]};let stock=inventory(),changes=[];
 for(const ln of inv.lines||[]){const sku=String(ln.sku||"").trim().toUpperCase();if(!sku)continue;const item=stock.find(x=>String(x.sku||"").toUpperCase()===sku);if(!item)continue;const q=Math.max(0,Math.floor(num(ln.qty)));if(q>num(item.stock))return {ok:false,error:`Insufficient stock for ${sku}`};item.stock=num(item.stock)-q;changes.push({sku,qty:q})}
 write("easy.inventory.v2",stock);let moves=read("easy.inventory.moves.v1",[]);changes.forEach(c=>moves.unshift({ts:now(),sku:c.sku,type:"OUT",qty:c.qty,note:"Invoice "+inv.number}));write("easy.inventory.moves.v1",moves.slice(0,50));inv.inventoryCommitted=true;saveInvoice(inv);audit("inventory.committed","invoice",inv.id,{changes});return {ok:true,changes}
}
function attachMeta(invoiceId,file){const list=read(K.attachments,[]);const rec={id:uid("att"),invoiceId,name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,createdAt:now()};list.unshift(rec);write(K.attachments,list);audit("attachment.added","invoice",invoiceId,{name:rec.name,size:rec.size});return rec}
function attachments(invoiceId){return read(K.attachments,[]).filter(x=>x.invoiceId===invoiceId)}
function forecast(days=90){const start=new Date(),end=new Date();end.setDate(end.getDate()+days);const rows=invoices().filter(i=>balance(i)>0).map(i=>({date:i.dueDate||i.issueDate,amount:balance(i),invoice:i})).filter(x=>new Date(x.date)<=end);const total=rows.reduce((s,x)=>s+x.amount,0);return {days,total,rows}}
function assistant(inv){
 const tips=[],bal=inv?balance(inv):0;
 if(!inv)return["Save the invoice to the register to unlock invoice intelligence."];
 if(!inv.client?.email)tips.push("Add a billing email so reminders can be generated.");
 if(!inv.dueDate)tips.push("Set a due date to enable aging, reminders, and forecasting.");
 if((inv.lines||[]).some(l=>num(l.vat)>0)&&!inv.company?.vat)tips.push("VAT is charged but the supplier VAT number is blank.");
 if(deriveStatus(inv)==="Overdue")tips.push("This invoice is overdue. Send the staged reminder and record any payment promise in notes.");
 if(bal>0&&paymentTotal(inv.id)>0)tips.push("A partial payment is recorded. Confirm the remaining balance with the customer.");
 if(!tips.length)tips.push("Invoice checks are clear. Next action: send, track receipt, and monitor payment.");
 return tips;
}
window.EasyAR={K,uid,now,read,write,invoices,saveInvoice,deleteInvoice,payments,invoicePayments,paymentTotal,balance,deriveStatus,addPayment,removePayment,credits,addCredit,creditTotal,getSettings,saveSettings,aging,customerLedger,recurring,saveRecurring,runRecurring,reminderStage,reminderText,reminderQueue,createTransfer,consumeTransfer,crmContacts,inventory,consumeInventoryForInvoice,attachMeta,attachments,forecast,assistant,audit};
})();