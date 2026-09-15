/* Easy Edit UI client for the shared Easy Edit engine. */
(function (global) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const bus = global.EasyFileDocumentBus;
  const engine = global.EasyEditAdapters.registerAll(new global.EasyEdit.Engine({ bus, historyLimit: 80 }));
  let selectedElement = null;
  let htmlTimer = null;

  function status(message, error = false) {
    const el = $("status");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.style.background = error ? "#b91c1c" : "#0f172a";
    clearTimeout(status.timer);
    status.timer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = sanitiseName(name);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function sanitiseName(name) { return String(name || "easy-edit").replace(/[\\/:*?"<>|]+/g, "-"); }

  function hideWorkspaces() {
    ["emptyState","textWorkspace","htmlWorkspace","canvasWorkspace","pdfInspector","imageInspector","htmlInspector","textInspector"].forEach((id) => $(id)?.classList.add("hidden"));
  }

  function showKind(kind) {
    hideWorkspaces();
    const map = { text: ["textWorkspace","textInspector"], html: ["htmlWorkspace","htmlInspector"], pdf: ["canvasWorkspace","pdfInspector"], image: ["canvasWorkspace","imageInspector"] };
    (map[kind] || ["emptyState"]).forEach((id) => $(id)?.classList.remove("hidden"));
    $("pageControls")?.classList.toggle("hidden", kind !== "pdf");
  }

  function updateChrome() {
    const current = engine.current;
    const kind = current?.adapterId;
    const warnings = current?.warnings || [];
    if (!current) return;
    $("fileName").textContent = current.name || "Untitled";
    $("fileMeta").textContent = `${kind.toUpperCase()}${warnings.length ? ` • ${warnings[0]}` : ""}`;
    $("modeBadge").innerHTML = `<i class="fa-solid fa-pen"></i> ${kind.toUpperCase()}`;
    $("downloadBtn").disabled = false;
    $("resetBtn").disabled = false;
    $("undoBtn").disabled = !engine.history.canUndo();
    $("redoBtn").disabled = !engine.history.canRedo();
    const dirty = $("dirtyBadge");
    if (dirty) {
      dirty.textContent = engine.dirty ? "Unsaved changes" : "Saved / clean";
      dirty.dataset.dirty = engine.dirty ? "true" : "false";
    }
    $("selectionSummary").textContent = `${current.name} • ${kind.toUpperCase()}${engine.dirty ? " • modified" : ""}`;
  }

  async function renderCurrent() {
    if (!engine.current) return;
    const kind = engine.current.adapterId;
    const model = engine.current.model;
    showKind(kind);
    updateChrome();

    if (kind === "text") {
      if ($("textEditor").value !== model.text) $("textEditor").value = model.text;
      const isJson = model.extension === "json";
      $("formatJson").disabled = !isJson; $("minifyJson").disabled = !isJson;
    } else if (kind === "html") {
      if ($("htmlEditor").value !== model.source) $("htmlEditor").value = model.source;
      refreshHtmlPreview();
    } else if (kind === "image") {
      global.EasyEditAdapters.adapters.image.render(model, $("editCanvas"));
      $("brightness").value = model.brightness; $("contrast").value = model.contrast;
      $("brightnessVal").textContent = `${model.brightness}%`; $("contrastVal").textContent = `${model.contrast}%`;
    } else if (kind === "pdf") {
      const info = await global.EasyEditAdapters.adapters.pdf.render(model, $("editCanvas"));
      $("pageLabel").textContent = `Page ${info.page} / ${info.numPages}`;
      $("prevPage").disabled = info.page <= 1; $("nextPage").disabled = info.page >= info.numPages;
    }
  }

  function refreshHtmlPreview() {
    const frame = $("htmlPreview");
    if (!frame || !engine.current || engine.current.adapterId !== "html") return;
    selectedElement = null;
    $("selectionSummary").textContent = `${engine.current.name} • HTML`;
    const source = engine.current.model.source;
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: 'self'; style-src 'unsafe-inline' 'self' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src data: 'self' https://fonts.gstatic.com; media-src data: blob: 'self';">`;
    frame.srcdoc = /<head[\s>]/i.test(source)
      ? source.replace(/<head([^>]*)>/i, `<head$1>${csp}`)
      : /<html[\s>]/i.test(source)
        ? source.replace(/<html([^>]*)>/i, `<html$1><head>${csp}</head>`)
        : `${csp}${source}`;
    frame.onload = () => bindPreview(frame);
  }

  function bindPreview(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("body *").forEach((el) => {
      el.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); selectElement(el); });
    });
  }

  function selectElement(el) {
    selectedElement = el;
    $("selectionSummary").textContent = `Selected <${el.tagName.toLowerCase()}>`;
    $("elementText").value = ["IMG","INPUT","HR","BR"].includes(el.tagName) ? "" : el.textContent || "";
    $("fontSize").value = parseInt(getComputedStyle(el).fontSize, 10) || 16;
    $("textAlign").value = getComputedStyle(el).textAlign || "";
    const rgb = getComputedStyle(el).color.match(/\d+/g);
    if (rgb?.length >= 3) $("textColor").value = `#${rgb.slice(0,3).map((n) => (+n).toString(16).padStart(2,"0")).join("")}`;
  }

  async function commitPreviewDom(reason = "visual-edit") {
    const doc = $("htmlPreview").contentDocument;
    if (!doc) return;
    const source = `<!doctype html>\n${doc.documentElement.outerHTML.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, "")}`;
    await engine.execute("set-source", { source });
    status(reason === "delete" ? "Element deleted" : "HTML updated");
  }

  function addHtmlElement(tag) {
    const doc = $("htmlPreview").contentDocument;
    if (!doc) return;
    const el = doc.createElement(tag);
    if (tag === "h2") el.textContent = "New heading";
    else if (tag === "p") el.textContent = "New paragraph";
    else if (tag === "button") el.textContent = "Button";
    else if (tag === "img") { el.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect width='100%25' height='100%25' fill='%23e2e8f0'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='Arial' font-size='38'%3EImage%3C/text%3E%3C/svg%3E"; el.alt = "Placeholder image"; el.style.maxWidth = "100%"; }
    doc.body.appendChild(el); selectElement(el); commitPreviewDom("add");
  }

  async function openFile(file) {
    if (!file) return;
    try {
      await engine.openFile(file, { sourceModule: "local-file" });
      await renderCurrent();
      status(`Opened ${file.name}`);
    } catch (error) { console.error(error); status(error.message || "Could not open file.", true); }
  }

  async function download() {
    try {
      const result = await engine.export();
      saveBlob(result.blob, result.name);
      engine.markClean(); updateChrome(); status(`Downloaded ${result.name}`);
    } catch (error) { console.error(error); status(error.message || "Export failed.", true); }
  }

  async function reset() {
    if (!engine.current) return;
    if (engine.dirty && !confirm("Discard all Easy Edit changes and reopen the original document?")) return;
    try { await engine.reset(); await renderCurrent(); status("Edits reset"); }
    catch (error) { status(error.message || "Could not reset document.", true); }
  }

  async function recoverLast() {
    if (!bus) return status("Browser recovery storage is unavailable.", true);
    try {
      const records = await bus.list({ purpose: "recovery", limit: 10 });
      const record = records.find((row) => row.metadata?.dirty);
      if (!record) return status("No recoverable Easy Edit session was found.");
      if (engine.dirty && !confirm("Replace the current unsaved document with the latest recovered session?")) return;
      await engine.restoreRecovery(record);
      await renderCurrent();
      status(`Recovered ${record.name}`);
    } catch (error) { console.error(error); status(error.message || "Recovery failed.", true); }
  }

  function defaultHtml() {
    return `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Untitled</title><style>body{font-family:Arial,sans-serif;max-width:960px;margin:0 auto;padding:48px;line-height:1.6}button{padding:12px 18px;border:0;border-radius:8px;background:#2563eb;color:white}</style></head>\n<body><h1>Edit this page visually</h1><p>Click any element in the preview, then use the inspector.</p><button>Call to action</button></body>\n</html>`;
  }

  async function newHtml() {
    if (engine.dirty && !confirm("Discard the current unsaved changes and create a new HTML document?")) return;
    await engine.openDocument({ name: "untitled.html", mimeType: "text/html", extension: "html", sourceModule: "easy-edit", data: defaultHtml() });
    await renderCurrent();
  }

  async function loadHandoff() {
    const id = new URLSearchParams(location.search).get("handoff");
    if (!id || !bus) return false;
    try {
      const doc = await bus.consume(id, { remove: false });
      if (!doc) throw new Error("The EasyFile handoff document was not found or has expired.");
      await engine.openDocument(doc);
      await renderCurrent();
      status(`Loaded from ${doc.sourceModule || "EasyFile"}`);
      return true;
    } catch (error) { console.error(error); status(error.message, true); return false; }
  }

  function wire() {
    $("openBtn").addEventListener("click", () => $("fileInput").click());
    $("dropZone").addEventListener("click", () => $("fileInput").click());
    $("dropZone").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("fileInput").click(); });
    $("fileInput").addEventListener("change", (e) => { openFile(e.target.files[0]); e.target.value = ""; });
    ["dragenter","dragover"].forEach((type) => $("dropZone").addEventListener(type, (e) => { e.preventDefault(); $("dropZone").classList.add("drag"); }));
    ["dragleave","drop"].forEach((type) => $("dropZone").addEventListener(type, (e) => { e.preventDefault(); $("dropZone").classList.remove("drag"); }));
    $("dropZone").addEventListener("drop", (e) => openFile(e.dataTransfer.files[0]));
    $("downloadBtn").addEventListener("click", download);
    $("resetBtn").addEventListener("click", reset);
    $("recoverBtn")?.addEventListener("click", recoverLast);
    $("newHtmlBtn").addEventListener("click", newHtml);
    $("undoBtn").addEventListener("click", () => { if (engine.undo()) renderCurrent(); });
    $("redoBtn").addEventListener("click", () => { if (engine.redo()) renderCurrent(); });

    $("textEditor").addEventListener("input", (e) => { clearTimeout(htmlTimer); htmlTimer = setTimeout(() => engine.execute("set-text", { text: e.target.value }).catch((err) => status(err.message, true)), 250); });
    $("formatJson").addEventListener("click", () => engine.execute("format-json").catch((e) => status(`Invalid JSON: ${e.message}`, true)));
    $("minifyJson").addEventListener("click", () => engine.execute("minify-json").catch((e) => status(`Invalid JSON: ${e.message}`, true)));

    $("htmlEditor").addEventListener("input", (e) => { clearTimeout(htmlTimer); htmlTimer = setTimeout(() => engine.execute("set-source", { source: e.target.value }).catch((err) => status(err.message, true)), 300); });
    document.querySelectorAll("[data-add-tag]").forEach((b) => b.addEventListener("click", () => addHtmlElement(b.dataset.addTag)));
    $("elementText").addEventListener("input", (e) => { if (!selectedElement) return; selectedElement.textContent = e.target.value; });
    $("elementText").addEventListener("change", () => commitPreviewDom());
    $("fontSize").addEventListener("change", (e) => { if (!selectedElement) return; selectedElement.style.fontSize = e.target.value ? `${e.target.value}px` : ""; commitPreviewDom(); });
    $("textAlign").addEventListener("change", (e) => { if (!selectedElement) return; selectedElement.style.textAlign = e.target.value; commitPreviewDom(); });
    $("textColor").addEventListener("change", (e) => { if (!selectedElement) return; selectedElement.style.color = e.target.value; commitPreviewDom(); });
    $("deleteElement").addEventListener("click", () => { if (!selectedElement) return; selectedElement.remove(); selectedElement = null; commitPreviewDom("delete"); });

    $("prevPage").addEventListener("click", () => { const m = engine.current?.model; if (engine.current?.adapterId === "pdf" && m.page > 1) { m.page -= 1; renderCurrent(); } });
    $("nextPage").addEventListener("click", () => { const m = engine.current?.model; if (engine.current?.adapterId === "pdf" && m.page < m.numPages) { m.page += 1; renderCurrent(); } });
    $("pdfRotateLeft").addEventListener("click", () => engine.execute("rotate", { degrees: -90 }));
    $("pdfRotateRight").addEventListener("click", () => engine.execute("rotate", { degrees: 90 }));
    $("pdfClearPage").addEventListener("click", () => engine.execute("clear-page-overlays"));

    $("imgRotateLeft").addEventListener("click", () => engine.execute("rotate", { degrees: -90 }));
    $("imgRotateRight").addEventListener("click", () => engine.execute("rotate", { degrees: 90 }));
    $("imgFlip").addEventListener("click", () => engine.execute("flip-x"));
    $("imgGray").addEventListener("click", () => engine.execute("toggle-gray"));
    $("brightness").addEventListener("change", (e) => engine.execute("brightness", { value: +e.target.value }));
    $("contrast").addEventListener("change", (e) => engine.execute("contrast", { value: +e.target.value }));
    $("imgClearText").addEventListener("click", () => engine.execute("clear-text"));

    $("editCanvas").addEventListener("click", (e) => {
      if (!engine.current) return;
      const r = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (engine.current.adapterId === "pdf") {
        const text = $("pdfText").value.trim(); if (!text) return status("Enter overlay text first.");
        engine.execute("add-text", { text, x, y, size: +$("pdfTextSize").value || 18 });
      } else if (engine.current.adapterId === "image") {
        const text = $("imgText").value.trim(); if (!text) return;
        engine.execute("add-text", { text, x, y, size: +$("imgTextSize").value || 30 });
      }
    });

    document.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); download(); }
      if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); $("fileInput").click(); }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); if (engine.undo()) renderCurrent(); }
      if (mod && (e.shiftKey && e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) { e.preventDefault(); if (engine.redo()) renderCurrent(); }
    });

    global.addEventListener("beforeunload", (event) => { if (!engine.dirty) return; event.preventDefault(); event.returnValue = ""; });
    engine.addEventListener("open", () => renderCurrent());
    engine.addEventListener("change", () => renderCurrent());
    engine.addEventListener("clean", updateChrome);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wire();
    await bus?.cleanup?.().catch(() => {});
    await loadHandoff();
    global.EasyEditApp = Object.freeze({ engine, openFile, download, newHtml, loadHandoff });
  }, { once: true });
})(window);
