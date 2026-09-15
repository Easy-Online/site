(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DB_NAME = "easyfile.easy-save.v1";
  const STORE = "files";
  const CONNECTOR_BASE = String(window.EASYFILE_SAVE_API_BASE || "https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-save").replace(/\/$/, "");
  const SESSION_PREFIX = "easyfile.easy-save.session.";

  const providers = [
    {id:"browser", name:"Browser storage", icon:"fa-hard-drive", mode:"local", status:"Ready", description:"IndexedDB on this device. No account or network required."},
    {id:"google-drive", name:"Google Drive", icon:"fa-brands fa-google-drive", mode:"connector", status:"OAuth", description:"Google Drive upload with delegated OAuth and server-side token storage."},
    {id:"onedrive", name:"OneDrive", icon:"fa-brands fa-microsoft", mode:"connector", status:"OAuth", description:"Microsoft Graph / OneDrive with delegated OAuth and refresh tokens."},
    {id:"dropbox", name:"Dropbox", icon:"fa-brands fa-dropbox", mode:"connector", status:"OAuth", description:"Dropbox scoped OAuth connector for file uploads."},
    {id:"box", name:"Box", icon:"fa-box-archive", mode:"connector", status:"OAuth", description:"Box scoped OAuth connector for file storage."},
    {id:"ftp", name:"SFTP / FTPS", icon:"fa-server", mode:"connector", status:"Secure gateway", description:"SFTP or encrypted FTPS through the EasyFile server-side gateway."},
    {id:"s3", name:"S3 / MinIO", icon:"fa-cubes-stacked", mode:"connector", status:"Object storage", description:"AWS S3, MinIO or compatible object storage through the secure connector."},
    {id:"webdav", name:"WebDAV / private cloud", icon:"fa-cloud", mode:"connector", status:"WebDAV", description:"Nextcloud, ownCloud or WebDAV-compatible private storage."}
  ];

  const oauthIds = new Set(["google-drive","onedrive","dropbox","box"]);
  let selectedProvider = "browser";
  let queue = [];
  let activeConnector = null;
  let providerHealth = {};

  function toast(message) {
    const el = $("toast"); if (!el) return;
    el.textContent = message; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3600);
  }
  function bytes(value){
    const n = Number(value || 0); if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n/1024).toFixed(1)} KB`; if (n < 1073741824) return `${(n/1048576).toFixed(1)} MB`; return `${(n/1073741824).toFixed(2)} GB`;
  }
  function escapeHtml(value){ return String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
  function uid(){ return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function sessionKey(provider){ return `${SESSION_PREFIX}${provider}`; }
  function getSession(provider){ return sessionStorage.getItem(sessionKey(provider)) || ""; }
  function ensureSession(provider){
    let value = getSession(provider);
    if (!value) {
      value = (crypto.randomUUID ? `${crypto.randomUUID()}${crypto.randomUUID()}` : `${uid()}-${uid()}-${uid()}`);
      sessionStorage.setItem(sessionKey(provider), value);
    }
    return value;
  }

  function renderProviders(){
    $("providerGrid").innerHTML = providers.map(p => {
      const health = providerHealth[p.id];
      const status = health && health.configured === false ? "Setup required" : p.status;
      return `<button class="provider ${selectedProvider===p.id?"is-selected":""}" type="button" data-provider="${p.id}" aria-pressed="${selectedProvider===p.id?"true":"false"}">
        <div class="provider-top"><div class="provider-icon"><i class="${p.icon.includes("fa-brands")?"":"fa-solid "}${p.icon}" aria-hidden="true"></i></div><span class="status ${p.mode}">${escapeHtml(status)}</span></div>
        <h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p>
      </button>`;
    }).join("");
    $("providerGrid").querySelectorAll("[data-provider]").forEach(btn => btn.addEventListener("click", () => selectProvider(btn.dataset.provider)));
    const p = providers.find(x => x.id === selectedProvider);
    $("selectedProviderLabel").className = `status ${p.mode}`;
    $("selectedProviderLabel").innerHTML = `<i class="fa-solid fa-circle-check"></i>${escapeHtml(p.name)} selected`;
  }

  async function loadProviderHealth(){
    try {
      const response = await fetch(`${CONNECTOR_BASE}/providers`, { headers:{"Accept":"application/json","X-EasyFile-Client":"easy-save-web"}, cache:"no-store" });
      if (!response.ok) return;
      const data = await response.json();
      providerHealth = data.providers || {};
      renderProviders();
    } catch (error) { console.info("Easy Save connector health unavailable", error); }
  }

  function selectProvider(id){
    selectedProvider = id; renderProviders();
    if (id !== "browser") openConnector(id);
  }

  function field(label, id, type="text", placeholder="", value="") {
    return `<label class="field-label mt-3" for="${id}">${label}</label><input id="${id}" class="field" type="${type}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}">`;
  }

  function openConnector(id){
    const p = providers.find(x => x.id === id); activeConnector = p;
    $("connectorTitle").textContent = `Connect ${p.name}`;
    $("connectorSubtitle").textContent = p.description;
    if (oauthIds.has(id)) {
      const unavailable = providerHealth[id]?.configured === false;
      $("connectorBody").innerHTML = `<div class="notice info"><strong>${escapeHtml(p.name)} OAuth</strong><br>Easy Save opens the provider's consent screen. Access and refresh tokens are encrypted by the EasyFile connector service and never stored in this page.</div>${unavailable?'<div class="notice warn mt-3">The provider application credentials still need to be configured on the EasyFile Azure Function App.</div>':''}`;
      $("modalConnect").textContent = "Continue to provider";
    } else if (id === "ftp") {
      $("connectorBody").innerHTML = `<div class="notice info">Credentials are sent directly to the EasyFile connector service, encrypted at rest for this short-lived browser session, and never placed in localStorage.</div>
        <label class="field-label mt-3" for="protocol">Protocol</label><select id="protocol" class="field"><option value="sftp">SFTP (recommended)</option><option value="ftp">FTPS</option></select>
        ${field("Server host","host","text","files.example.com")}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${field("Port","port","number","22")}${field("Base path","basePath","text","/EasyFile")}</div>
        ${field("Username","username","text","storage-user")}${field("Password","password","password","••••••••")}`;
      $("modalConnect").textContent = "Connect securely";
    } else if (id === "webdav") {
      $("connectorBody").innerHTML = `<div class="notice info">For Nextcloud, ownCloud and generic WebDAV. HTTPS is required in production.</div>
        ${field("WebDAV base URL","baseUrl","url","https://cloud.example.com/remote.php/dav/files/user/")}
        ${field("Base path","basePath","text","EasyFile")}
        ${field("Username","username","text","user")}${field("Password / app password","password","password","••••••••")}`;
      $("modalConnect").textContent = "Connect securely";
    } else if (id === "s3") {
      $("connectorBody").innerHTML = `<div class="notice info">Works with AWS S3, MinIO and S3-compatible object stores. Credentials stay server-side after connection.</div>
        ${field("Endpoint (optional for AWS)","endpoint","url","https://minio.example.com")}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${field("Region","region","text","af-south-1")}${field("Bucket","bucket","text","easyfile")}</div>
        ${field("Prefix","prefix","text","uploads")}${field("Access key ID","accessKeyId","text","AKIA…")}${field("Secret access key","secretAccessKey","password","••••••••")}
        <label class="mt-3 flex items-center gap-2 text-sm"><input id="forcePathStyle" type="checkbox" checked> Use path-style addressing (recommended for MinIO)</label>`;
      $("modalConnect").textContent = "Connect securely";
    }
    $("connectorModal").classList.add("open");
  }
  function closeModal(){ $("connectorModal").classList.remove("open"); }

  function connectorConfig(id){
    if (id === "ftp") return {
      protocol: document.getElementById("protocol")?.value || "sftp",
      host: document.getElementById("host")?.value.trim(),
      port: Number(document.getElementById("port")?.value || (document.getElementById("protocol")?.value === "sftp" ? 22 : 21)),
      username: document.getElementById("username")?.value,
      password: document.getElementById("password")?.value,
      basePath: document.getElementById("basePath")?.value || "/EasyFile",
      secure: true
    };
    if (id === "webdav") return { baseUrl: document.getElementById("baseUrl")?.value.trim(), basePath: document.getElementById("basePath")?.value || "EasyFile", username: document.getElementById("username")?.value, password: document.getElementById("password")?.value };
    if (id === "s3") return { endpoint: document.getElementById("endpoint")?.value.trim() || "", region: document.getElementById("region")?.value.trim(), bucket: document.getElementById("bucket")?.value.trim(), prefix: document.getElementById("prefix")?.value.trim(), accessKeyId: document.getElementById("accessKeyId")?.value.trim(), secretAccessKey: document.getElementById("secretAccessKey")?.value, forcePathStyle: Boolean(document.getElementById("forcePathStyle")?.checked) };
    return {};
  }

  async function connectProvider(){
    if (!activeConnector) return;
    const id = activeConnector.id;
    const sessionId = ensureSession(id);
    try {
      const response = await fetch(`${CONNECTOR_BASE}/connect/${encodeURIComponent(id)}`, {
        method:"POST",
        headers:{"Accept":"application/json","Content-Type":"application/json","X-EasyFile-Client":"easy-save-web","X-EasyFile-Storage-Session":sessionId},
        body: JSON.stringify({ sessionId, returnUrl: location.href.split("?")[0].split("#")[0], config: connectorConfig(id) }),
        cache:"no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (data.authorizeUrl) { location.assign(data.authorizeUrl); return; }
      closeModal(); toast(`${activeConnector.name} connected for this browser session.`);
    } catch (error) {
      console.error(error); toast(`Could not connect ${activeConnector.name}: ${String(error.message || error).replace(/_/g," ")}`);
    }
  }

  function handleOauthReturn(){
    const params = new URLSearchParams(location.search);
    const state = params.get("easySave");
    const provider = params.get("provider");
    if (!state) return;
    if (state === "connected" && provider) { selectedProvider = provider; toast(`${providers.find(p=>p.id===provider)?.name || provider} connected.`); }
    else if (state === "error") toast("Storage connection was not completed.");
    ["easySave","provider","reason"].forEach(k => params.delete(k));
    history.replaceState(null, "", `${location.pathname}${params.toString()?`?${params.toString()}`:""}${location.hash}`);
  }

  function addFiles(files){
    [...files].forEach(file => queue.push({ id:uid(), kind:"file", name:file.name, type:file.type || "application/octet-stream", size:file.size, blob:file, source:"local" }));
    renderQueue();
  }
  function addUrl(){
    const url = $("urlInput").value.trim(); if (!url || !/^https?:\/\//i.test(url)) return toast("Enter a valid HTTP or HTTPS URL.");
    const fallback = (() => { try { const u = new URL(url); return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname || "website-file"); } catch { return "website-file"; } })();
    queue.push({ id:uid(), kind:"url", name:$("urlFileName").value.trim() || fallback, type:$("urlType").value.trim() || "", size:0, url, source:"url" });
    $("urlInput").value = ""; $("urlFileName").value = ""; $("urlType").value = ""; renderQueue();
  }
  function removeQueue(id){ queue = queue.filter(x => x.id !== id); renderQueue(); }
  function renderQueue(){
    $("queueCount").textContent = `${queue.length} ${queue.length===1?"item":"items"}`;
    if (!queue.length) { $("queue").innerHTML = '<div class="queue-empty">No files queued yet.</div>'; return; }
    $("queue").innerHTML = queue.map(item => `<div class="file-row"><div class="file-main"><i class="fa-solid ${item.kind==="url"?"fa-link":"fa-file"}"></i><div style="min-width:0"><div class="file-name">${escapeHtml(item.name)}</div><div class="file-meta">${escapeHtml(item.type || "Type will be detected")} ${item.size?`· ${bytes(item.size)}`:""} · ${item.kind==="url"?"Website link":"Local file"}</div></div></div><span class="status ${item.kind==="url"?"direct":"local"}">${item.kind==="url"?"URL":"Local"}</span><button class="btn btn-secondary" type="button" data-remove="${item.id}" aria-label="Remove ${escapeHtml(item.name)}"><i class="fa-solid fa-trash"></i></button></div>`).join("");
    $("queue").querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => removeQueue(btn.dataset.remove)));
  }

  async function materialize(item){
    if (item.blob) return item;
    const response = await fetch(item.url, { mode:"cors" });
    if (!response.ok) throw new Error(`Remote fetch failed (${response.status})`);
    const blob = await response.blob();
    return {...item, blob, size:blob.size, type:item.type || blob.type || "application/octet-stream"};
  }

  function openDb(){ return new Promise((resolve,reject) => { const req=indexedDB.open(DB_NAME,1); req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE,{keyPath:"id"}); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
  async function vaultPut(item){ const db=await openDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,"readwrite"); tx.objectStore(STORE).put({id:item.id,name:item.name,type:item.type,size:item.size,blob:item.blob,savedAt:new Date().toISOString(),source:item.source}); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); }
  async function vaultAll(){ const db=await openDb(); return new Promise((resolve,reject)=>{ const req=db.transaction(STORE,"readonly").objectStore(STORE).getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error); }); }
  async function vaultDelete(id){ const db=await openDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,"readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); }

  async function connectorUpload(item){
    const sessionId = getSession(selectedProvider);
    if (!sessionId) throw new Error("Connect the selected storage provider first.");
    const form = new FormData(); form.append("file", item.blob, item.name); form.append("provider", selectedProvider);
    const response = await fetch(`${CONNECTOR_BASE}/upload`, { method:"POST", body:form, headers:{"X-EasyFile-Storage-Session":sessionId,"X-EasyFile-Client":"easy-save-web"}, cache:"no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Connector upload failed (${response.status})`);
    return data;
  }

  async function saveAll(){
    if (!queue.length) return toast("Add at least one file first.");
    const saveBtn=$("saveAllBtn"); saveBtn.disabled=true; saveBtn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>Saving…';
    let saved=0, failed=0;
    for (const original of queue) {
      try {
        const item = await materialize(original);
        if (selectedProvider === "browser") await vaultPut(item); else await connectorUpload(item);
        saved++;
      } catch (error) { console.error(error); failed++; }
    }
    saveBtn.disabled=false; saveBtn.innerHTML='<i class="fa-solid fa-cloud-arrow-up"></i>Save all';
    if (saved) { queue=[]; renderQueue(); await renderVault(); }
    toast(failed ? `Saved ${saved}; ${failed} failed. Check the connector configuration.` : `Saved ${saved} item${saved===1?"":"s"} successfully.`);
  }

  async function renderVault(){
    const rows = (await vaultAll()).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
    $("vaultUsage").textContent = `${rows.length} ${rows.length===1?"file":"files"}`;
    $("vaultRows").innerHTML = rows.length ? rows.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.type || "-")}</td><td>${bytes(item.size)}</td><td>${new Date(item.savedAt).toLocaleString()}</td><td><button class="btn btn-secondary mr-2" type="button" data-download="${item.id}"><i class="fa-solid fa-download"></i></button><button class="btn btn-secondary" type="button" data-delete="${item.id}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join("") : '<tr><td colspan="5" style="color:var(--easyfile-muted);text-align:center;padding:1.2rem">No browser-vault files yet.</td></tr>';
    $("vaultRows").querySelectorAll("[data-download]").forEach(btn=>btn.addEventListener("click", async()=>{ const item=(await vaultAll()).find(x=>x.id===btn.dataset.download); if(!item)return; const url=URL.createObjectURL(item.blob); const a=document.createElement("a"); a.href=url; a.download=item.name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),0); }));
    $("vaultRows").querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click", async()=>{ if(!confirm("Delete this file from the browser vault?"))return; await vaultDelete(btn.dataset.delete); await renderVault(); toast("File deleted from browser vault."); }));
  }

  const fileInput=$("fileInput"), drop=$("dropZone");
  fileInput.addEventListener("change", e=>{ addFiles(e.target.files); e.target.value=""; });
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("drag");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("drag");}));
  drop.addEventListener("drop", e=>addFiles(e.dataTransfer.files));
  $("addUrlBtn").addEventListener("click", addUrl);
  $("urlInput").addEventListener("keydown", e=>{if(e.key==="Enter"){e.preventDefault();addUrl();}});
  $("clearQueueBtn").addEventListener("click",()=>{queue=[];renderQueue();});
  $("saveAllBtn").addEventListener("click",saveAll);
  $("modalClose").addEventListener("click",closeModal); $("modalCancel").addEventListener("click",closeModal); $("modalConnect").addEventListener("click",connectProvider);
  $("connectorModal").addEventListener("click",e=>{if(e.target===$("connectorModal"))closeModal();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});

  handleOauthReturn(); renderProviders(); renderQueue(); renderVault().catch(console.error); loadProviderHealth();
})();
