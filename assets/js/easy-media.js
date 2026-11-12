/* Easy Media — local-first media import, preview, conversion and Easy Edit handoff. */
(function(global){
  "use strict";
  const $=id=>document.getElementById(id);
  const HISTORY_KEY="easy.media.history.v1";
  const MAX_FETCH_BYTES=200*1024*1024;
  const MAX_FFMPEG_BYTES=120*1024*1024;
  const STREAMING_HOSTS=["youtube.com","youtu.be","facebook.com","fb.watch","spotify.com","music.apple.com","tiktok.com","instagram.com","soundcloud.com"];
  const PROVIDERS=[
    {name:"Pixabay",icon:"fa-image",kind:"Images · video · audio",url:q=>"https://pixabay.com/images/search/"+encodeURIComponent(q)+"/",note:"Stock media with provider licensing."},
    {name:"Unsplash",icon:"fa-camera",kind:"Photography",url:q=>"https://unsplash.com/s/photos/"+encodeURIComponent(q),note:"Photography with Unsplash download/API requirements."},
    {name:"Pexels",icon:"fa-photo-film",kind:"Images · video",url:q=>"https://www.pexels.com/search/"+encodeURIComponent(q)+"/",note:"Stock photography and video."},
    {name:"Openverse",icon:"fa-globe",kind:"Open media",url:q=>"https://openverse.org/search/?q="+encodeURIComponent(q),note:"Openly licensed media search; verify item licence."},
    {name:"Wikimedia Commons",icon:"fa-landmark",kind:"Images · audio · video",url:q=>"https://commons.wikimedia.org/w/index.php?search="+encodeURIComponent(q)+"&title=Special:MediaSearch",note:"Commons media with item-specific licensing."},
    {name:"Freesound",icon:"fa-wave-square",kind:"Audio · effects",url:q=>"https://freesound.org/search/?q="+encodeURIComponent(q),note:"Community audio with per-file licences."},
    {name:"Internet Archive",icon:"fa-box-archive",kind:"Video · audio · docs",url:q=>"https://archive.org/search?query="+encodeURIComponent(q),note:"Archive content with item-specific rights."},
    {name:"arXiv",icon:"fa-file-lines",kind:"Research",url:q=>"https://arxiv.org/search/?query="+encodeURIComponent(q)+"&searchtype=all",note:"Research discovery and downloadable papers where permitted."}
  ];

  let current=null,objectUrl=null,ffmpeg=null;

  function toast(msg){
    let el=document.querySelector(".m-toast");
    if(!el){el=document.createElement("div");el.className="m-toast";el.setAttribute("role","status");document.body.appendChild(el);}
    el.textContent=msg;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,3200);
  }
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
  function bytes(n){if(n==null||Number.isNaN(n))return "Unknown";const u=["B","KB","MB","GB"];let x=Number(n),i=0;while(x>=1024&&i<u.length-1){x/=1024;i++;}return (i?x.toFixed(x>=10?1:2):Math.round(x))+" "+u[i];}
  function ext(name){const m=String(name||"").toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:"";}
  function fromUrlName(url){try{return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop()||"download");}catch{return "download";}}
  function kind(type,name){
    const t=String(type||"").toLowerCase(),e=ext(name);
    if(t.startsWith("image/")||["png","jpg","jpeg","webp","gif","bmp","svg"].includes(e))return "image";
    if(t.startsWith("video/")||["mp4","webm","mov","mkv","avi","m4v"].includes(e))return "video";
    if(t.startsWith("audio/")||["mp3","wav","m4a","aac","ogg","flac"].includes(e))return "audio";
    if(t==="application/pdf"||e==="pdf")return "pdf";
    if(t.startsWith("text/")||["txt","md","csv","json","html","htm","xml"].includes(e))return "text";
    return "file";
  }
  function providerRestricted(url){
    try{const h=new URL(url).hostname.toLowerCase();return STREAMING_HOSTS.some(x=>h===x||h.endsWith("."+x));}catch{return false;}
  }
  function history(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]")}catch{return []}}
  function addHistory(action){
    if(!current)return;
    const h=history();h.unshift({ts:new Date().toISOString(),name:current.name,kind:current.kind,source:current.source,action});
    localStorage.setItem(HISTORY_KEY,JSON.stringify(h.slice(0,25)));renderHistory();
  }
  function renderHistory(){
    const h=history();
    $("historyList").innerHTML=h.length?h.map(x=>'<div class="m-history-item"><div><strong>'+esc(x.name)+'</strong><small>'+esc(x.action)+' · '+esc(x.source)+' · '+new Date(x.ts).toLocaleString()+'</small></div><i class="fa-solid fa-clock-rotate-left"></i></div>').join(""):'<div class="m-empty" style="padding:1rem"><p>No activity yet.</p></div>';
  }
  function revoke(){if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
  function setProgress(v){$("progressBar").style.width=Math.max(0,Math.min(100,v))+"%";}
  function allowed(){return Boolean(current&&$("rightsConfirm").checked);}
  function updateButtons(){
    const ok=allowed();
    $("downloadBtn").disabled=!ok||(!current?.blob&&!current?.url);
    $("convertBtn").disabled=!ok||!current?.blob||!["image","audio","video"].includes(current.kind);
    $("editBtn").disabled=!ok||!current?.blob;
  }
  function meta(item){
    const rows=[["Name",item.name],["Type",item.type||item.kind],["Category",item.kind],["Size",bytes(item.size)],["Source",item.source]];
    if(item.url){try{rows.push(["Host",new URL(item.url).hostname])}catch{}}
    return rows.map(r=>'<div class="m-meta-row"><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>').join("");
  }
  function show(item){
    revoke();$("previewStage").innerHTML="";
    if(item.blob)objectUrl=URL.createObjectURL(item.blob);
    const src=objectUrl||item.url||"";
    let node;
    if(item.kind==="image"){node=document.createElement("img");node.src=src;node.alt=item.name;}
    else if(item.kind==="video"){node=document.createElement("video");node.src=src;node.controls=true;node.playsInline=true;}
    else if(item.kind==="audio"){node=document.createElement("audio");node.src=src;node.controls=true;}
    else if(item.kind==="pdf"){node=document.createElement("iframe");node.src=src;node.title=item.name;}
    else {node=document.createElement("div");node.className="m-empty";node.innerHTML='<i class="fa-regular fa-file-lines"></i><h3>'+esc(item.name)+'</h3><p>Preview is unavailable for this type, but the file can still be downloaded or handed to another EasyFile module.</p>';}
    $("previewStage").appendChild(node);
    $("metaList").innerHTML=meta(item);
    $("previewCard").classList.remove("hidden");
    $("rightsConfirm").checked=false;$("convertCard").classList.remove("active");updateButtons();
    $("previewCard").scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function acceptBlob(blob,name,source,url){
    current={blob,name:name||"media",type:blob.type||"application/octet-stream",size:blob.size,kind:kind(blob.type,name),source:source||"Upload",url:url||null};
    show(current);addHistory("Imported");
  }
  async function analyseUrl(){
    const raw=$("urlInput").value.trim();
    if(!raw)return toast("Paste a URL first.");
    let u;try{u=new URL(raw);if(!["https:","http:"].includes(u.protocol))throw 0;}catch{return toast("Enter a valid http or https URL.");}
    if(providerRestricted(raw)){
      current={blob:null,name:fromUrlName(raw),type:"Provider page",size:null,kind:"file",source:"Provider page",url:raw};
      show(current);
      $("sourcePolicy").className="m-note warn";
      $("sourcePolicy").textContent="This provider is recognised, but Easy Media does not extract streamed or protected media. Use the provider's own download/export feature or supply an authorised direct file URL.";
      return;
    }
    $("analyseUrlBtn").disabled=true;$("analyseUrlBtn").innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Analysing';
    try{
      const r=await fetch(raw,{method:"GET",mode:"cors",redirect:"follow"});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const len=Number(r.headers.get("content-length")||0);
      if(len>MAX_FETCH_BYTES)throw new Error("File is larger than the 200 MB browser limit.");
      const blob=await r.blob();
      if(blob.size>MAX_FETCH_BYTES)throw new Error("File is larger than the 200 MB browser limit.");
      await acceptBlob(blob,fromUrlName(r.url||raw),"Direct URL",raw);
      $("sourcePolicy").className="m-note";
      $("sourcePolicy").textContent="Direct file loaded successfully in your browser. Nothing is stored on an EasyFile server.";
    }catch(err){
      current={blob:null,name:fromUrlName(raw),type:"Remote link",size:null,kind:kind("",fromUrlName(raw)),source:"Remote URL",url:raw};
      show(current);
      $("sourcePolicy").className="m-note warn";
      $("sourcePolicy").textContent="The source did not allow browser download (usually CORS or authentication). You can still open the source, or use an official provider integration when available. "+String(err.message||err);
    }finally{
      $("analyseUrlBtn").disabled=false;$("analyseUrlBtn").innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Analyse';
    }
  }
  function downloadBlob(blob,name){
    const a=document.createElement("a"),u=URL.createObjectURL(blob);a.href=u;a.download=name||"download";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(u);a.remove()},500);
  }
  async function downloadOriginal(){
    if(!allowed())return;
    if(current.blob){downloadBlob(current.blob,current.name);addHistory("Downloaded original");return;}
    if(current.url){window.open(current.url,"_blank","noopener");addHistory("Opened source");}
  }
  function conversionOptions(){
    const sel=$("formatSelect");sel.innerHTML="";
    const opts=current?.kind==="image"?["jpg","png","webp"]:current?.kind==="audio"?["mp3","wav","ogg"]:current?.kind==="video"?["mp4","webm"]:["original"];
    opts.forEach(x=>{const o=document.createElement("option");o.value=x;o.textContent=x.toUpperCase();sel.appendChild(o);});
  }
  async function convertImage(){
    const img=await createImageBitmap(current.blob),max=Number($("widthInput").value||0);
    const scale=max&&img.width>max?max/img.width:1,w=Math.round(img.width*scale),h=Math.round(img.height*scale);
    const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;canvas.getContext("2d").drawImage(img,0,0,w,h);
    const f=$("formatSelect").value,mime=f==="jpg"?"image/jpeg":"image/"+f,q=Number($("qualityRange").value)/100;
    const blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error("Image conversion failed.")),mime,q));
    const base=current.name.replace(/\.[^.]+$/,"")||"converted";downloadBlob(blob,base+"."+f);return blob.size;
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>{const existing=[...document.scripts].find(s=>s.src===src);if(existing){if(global.FFmpeg)return resolve();existing.addEventListener("load",resolve,{once:true});existing.addEventListener("error",reject,{once:true});return;}const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
  }
  async function getFFmpeg(){
    if(ffmpeg)return ffmpeg;
    $("convertStatus").textContent="Loading the FFmpeg media engine…";
    await loadScript("https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js");
    if(!global.FFmpeg?.createFFmpeg)throw new Error("FFmpeg could not be loaded.");
    ffmpeg=global.FFmpeg.createFFmpeg({log:false,corePath:"https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js"});
    ffmpeg.setProgress(({ratio})=>setProgress(Math.round((ratio||0)*100)));
    if(!ffmpeg.isLoaded())await ffmpeg.load();
    return ffmpeg;
  }
  async function convertAV(){
    if(current.blob.size>MAX_FFMPEG_BYTES)throw new Error("Audio/video conversion is limited to 120 MB in the browser.");
    const engine=await getFFmpeg(),input="input."+((ext(current.name)|| (current.kind==="audio"?"mp3":"mp4"))),outExt=$("formatSelect").value,output="output."+outExt;
    engine.FS("writeFile",input,new Uint8Array(await current.blob.arrayBuffer()));
    const args=current.kind==="audio"
      ? (outExt==="wav"?["-i",input,output]:["-i",input,"-vn","-b:a","192k",output])
      : (outExt==="webm"?["-i",input,"-c:v","libvpx","-c:a","libvorbis",output]:["-i",input,"-c:v","libx264","-preset","veryfast","-c:a","aac","-movflags","+faststart",output]);
    await engine.run(...args);
    const data=engine.FS("readFile",output),blob=new Blob([data.buffer],{type:current.kind+"/"+outExt});
    downloadBlob(blob,(current.name.replace(/\.[^.]+$/,"")||"converted")+"."+outExt);
    try{engine.FS("unlink",input);engine.FS("unlink",output);}catch{}
    return blob.size;
  }
  async function runConvert(){
    if(!allowed()||!current?.blob)return;
    $("runConvertBtn").disabled=true;setProgress(3);
    try{
      $("convertStatus").textContent="Processing "+current.name+"…";
      const size=current.kind==="image"?await convertImage():await convertAV();
      setProgress(100);$("convertStatus").textContent="Done. Created "+bytes(size)+" file and started the download.";addHistory("Converted to "+$("formatSelect").value.toUpperCase());
    }catch(err){setProgress(0);$("convertStatus").textContent="Conversion failed: "+String(err.message||err);toast("Could not convert this file.");}
    finally{$("runConvertBtn").disabled=false;}
  }
  async function edit(){
    if(!allowed()||!current?.blob)return;
    try{
      const bus=global.EasyFileDocumentBus;
      if(!bus?.handoff)throw new Error("EasyFile document bus is unavailable.");
      const buffer=await current.blob.arrayBuffer();
      const url=await bus.handoff({name:current.name,type:current.type,blob:current.blob,arrayBuffer:buffer,sourceModule:"easy-media"},"easy-edit.html");
      addHistory("Sent to Easy Edit");location.href=url;
    }catch(err){toast("Easy Edit handoff failed: "+String(err.message||err));}
  }
  function clearCurrent(){
    revoke();current=null;$("previewCard").classList.add("hidden");$("convertCard").classList.remove("active");$("urlInput").value="";$("fileInput").value="";setProgress(0);
  }
  function renderProviders(){
    const q=$("mediaSearch").value.trim();
    $("providerGrid").innerHTML=PROVIDERS.map(p=>'<article class="m-card m-provider"><i class="fa-solid '+p.icon+'"></i><strong>'+esc(p.name)+'</strong><small>'+esc(p.kind)+'</small><p>'+esc(p.note)+'</p><a class="m-btn" target="_blank" rel="noopener noreferrer" href="'+esc(p.url(q||"business"))+'"><i class="fa-solid fa-arrow-up-right-from-square"></i> Search '+esc(p.name)+'</a></article>').join("");
  }
  function demo(){
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#061a4d"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="45%" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="84">Easy Media</text><text x="50%" y="58%" text-anchor="middle" fill="#7dd3fc" font-family="Arial" font-size="36">Demo image · safe to convert</text></svg>';
    acceptBlob(new Blob([svg],{type:"image/svg+xml"}),"easy-media-demo.svg","Demo");
  }

  document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll("[data-tab]").forEach(x=>x.setAttribute("aria-selected",String(x===btn)));
    document.querySelectorAll("[data-panel]").forEach(x=>x.classList.toggle("active",x.dataset.panel===btn.dataset.tab));
  }));
  $("analyseUrlBtn").addEventListener("click",analyseUrl);
  $("urlInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();analyseUrl();}});
  $("dropZone").addEventListener("click",()=>$("fileInput").click());
  $("dropZone").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();$("fileInput").click();}});
  $("fileInput").addEventListener("change",()=>acceptBlob($("fileInput").files[0],$("fileInput").files[0]?.name,"Device upload"));
  ["dragenter","dragover"].forEach(ev=>$("dropZone").addEventListener(ev,e=>{e.preventDefault();$("dropZone").classList.add("drag")}));
  ["dragleave","drop"].forEach(ev=>$("dropZone").addEventListener(ev,e=>{e.preventDefault();$("dropZone").classList.remove("drag")}));
  $("dropZone").addEventListener("drop",e=>acceptBlob(e.dataTransfer.files[0],e.dataTransfer.files[0]?.name,"Device upload"));
  $("rightsConfirm").addEventListener("change",updateButtons);
  $("downloadBtn").addEventListener("click",downloadOriginal);
  $("convertBtn").addEventListener("click",()=>{conversionOptions();$("convertCard").classList.add("active");$("convertCard").scrollIntoView({behavior:"smooth",block:"start"});});
  $("runConvertBtn").addEventListener("click",runConvert);
  $("qualityRange").addEventListener("input",()=>$("qualityLabel").textContent=$("qualityRange").value+"%");
  $("editBtn").addEventListener("click",edit);
  $("clearBtn").addEventListener("click",clearCurrent);
  $("demoBtn").addEventListener("click",demo);
  $("searchAllBtn").addEventListener("click",renderProviders);
  $("mediaSearch").addEventListener("input",renderProviders);
  $("clearHistoryBtn").addEventListener("click",()=>{localStorage.removeItem(HISTORY_KEY);renderHistory();});
  renderProviders();renderHistory();
})(window);