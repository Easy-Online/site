/* Easy Capture -> Smart Extract OCR + Easy Save handoff integration */
(function () {
  "use strict";

  const current = (location.pathname.split("/").pop() || "").toLowerCase();
  const HANDOFF_DB = "easyfile.handoff.v1";
  const HANDOFF_STORE = "handoffs";
  const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

  function openHandoffDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDOFF_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(HANDOFF_STORE)) {
          req.result.createObjectStore(HANDOFF_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function handoffPut(value) {
    const db = await openHandoffDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDOFF_STORE, "readwrite");
      tx.objectStore(HANDOFF_STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function handoffGet(id) {
    const db = await openHandoffDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(HANDOFF_STORE, "readonly").objectStore(HANDOFF_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function cleanupHandoffs() {
    const db = await openHandoffDb();
    return new Promise((resolve) => {
      const tx = db.transaction(HANDOFF_STORE, "readwrite");
      const store = tx.objectStore(HANDOFF_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const cutoff = Date.now() - HANDOFF_TTL_MS;
        (req.result || []).forEach((item) => {
          if (new Date(item.createdAt || 0).getTime() < cutoff) store.delete(item.id);
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  function pageToast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    const target = document.getElementById("toastMsg") || el;
    target.textContent = message;
    el.classList.remove("hidden");
    el.classList.add("show");
    clearTimeout(pageToast.timer);
    pageToast.timer = setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("show");
    }, 3600);
  }

  function installSmartExtractOcrBridge() {
    const smart = document.getElementById("btnExtract");
    const textButton = document.getElementById("btnExtractText");
    const textArea = document.getElementById("fText");
    if (!smart || !textButton || !textArea || smart.dataset.ocrBridgeInstalled) return;
    smart.dataset.ocrBridgeInstalled = "true";

    const evidenceCopy = textArea.closest("section")?.querySelector("p.text-xs");
    if (evidenceCopy) {
      evidenceCopy.textContent = "Generated automatically from the uploaded image or PDF. Edit anything that was read incorrectly, or paste text manually as a fallback.";
    }

    smart.addEventListener("click", async (event) => {
      if (textArea.value.trim()) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const originalHtml = smart.innerHTML;
      smart.disabled = true;
      smart.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reading document…';

      textButton.click();

      const started = Date.now();
      const timeoutMs = 180000;
      while (Date.now() - started < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!textButton.disabled) break;
      }

      smart.disabled = false;
      smart.innerHTML = originalHtml;

      if (!textArea.value.trim()) {
        pageToast("OCR could not read this document. Try a clearer image, crop/rotate it, or paste text manually.");
      }
    }, true);
  }

  function installEasySaveButton() {
    const smart = document.getElementById("btnExtract");
    const actionRow = smart?.parentElement;
    if (!actionRow || document.getElementById("btnSaveEasySave")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "btnSaveEasySave";
    button.className = "btn btn-outline";
    button.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save to Easy Save';
    button.addEventListener("click", queueForEasySave);
    actionRow.appendChild(button);
  }

  async function queueForEasySave() {
    const button = document.getElementById("btnSaveEasySave");
    if (!button) return;

    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing…';

    try {
      if (typeof active !== "function" || typeof getBlob !== "function") {
        throw new Error("Easy Capture handoff is unavailable on this page.");
      }

      if (typeof readForm === "function") readForm();
      const record = active();
      if (!record) throw new Error("Select a captured document first.");

      const blob = await getBlob(record.id);
      if (!blob) throw new Error("The original document is unavailable in browser storage.");

      const fields = record.fields || {};
      const metadata = {
        schema: "easyfile.capture-handoff.v1",
        sourceModule: "Easy Capture",
        captureId: record.id,
        capturedAt: record.createdAt || "",
        updatedAt: record.updatedAt || "",
        confidence: Number(record.confidence || 0),
        status: record.status || "needs-review",
        original: {
          name: record.source?.name || `capture-${record.id}`,
          type: record.source?.type || blob.type || "application/octet-stream",
          size: Number(record.source?.size || blob.size || 0),
          sha256: record.source?.sha256 || ""
        },
        fields: {
          type: fields.type || "",
          supplier: fields.supplier || "",
          supplierVat: fields.supplierVat || "",
          number: fields.number || "",
          date: fields.date || "",
          currency: fields.currency || "ZAR",
          category: fields.category || "",
          amountExcl: fields.amountExcl || "",
          vatPct: fields.vatPct || "",
          vatAmt: fields.vatAmt || "",
          amountIncl: fields.amountIncl || "",
          paymentMethod: fields.paymentMethod || "",
          reference: fields.reference || "",
          notes: fields.notes || ""
        },
        extractedText: record.extractedText || "",
        lineItems: Array.isArray(record.lineItems) ? record.lineItems : []
      };

      const handoffId = `CAPSAVE-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      await handoffPut({
        id: handoffId,
        createdAt: new Date().toISOString(),
        blob,
        filename: metadata.original.name,
        type: metadata.original.type,
        metadata
      });

      if (typeof logEvent === "function") logEvent(record, "Queued for Easy Save", handoffId);
      if (typeof persist === "function") persist();

      location.href = `easy-save.html?captureHandoff=${encodeURIComponent(handoffId)}`;
    } catch (error) {
      console.error(error);
      pageToast(error.message || "Could not prepare this document for Easy Save.");
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }

  function makeQueuedFiles(handoff) {
    const originalBlob = handoff.blob;
    const originalName = handoff.filename || `capture-${handoff.id}`;
    const originalType = handoff.type || originalBlob?.type || "application/octet-stream";
    const originalFile = new File([originalBlob], originalName, { type: originalType, lastModified: Date.now() });

    const base = originalName.replace(/\.[^.]+$/, "") || "capture";
    const metadataBlob = new Blob([JSON.stringify(handoff.metadata || {}, null, 2)], { type: "application/json" });
    const metadataFile = new File([metadataBlob], `${base}.easyfile.json`, { type: "application/json", lastModified: Date.now() });
    return [originalFile, metadataFile];
  }

  function queueFilesViaInput(files) {
    const input = document.getElementById("fileInput");
    if (!input) throw new Error("Easy Save file queue is unavailable.");

    if (typeof DataTransfer !== "undefined") {
      const dt = new DataTransfer();
      files.forEach((file) => dt.items.add(file));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  async function installEasySaveHandoffReceiver() {
    const params = new URLSearchParams(location.search);
    const handoffId = params.get("captureHandoff");
    if (!handoffId) return;

    try {
      const handoff = await handoffGet(handoffId);
      if (!handoff?.blob) throw new Error("The Easy Capture handoff has expired or is unavailable.");

      const files = makeQueuedFiles(handoff);
      if (!queueFilesViaInput(files)) {
        throw new Error("This browser cannot transfer the captured file into the Easy Save queue automatically.");
      }

      const sourceHeading = document.getElementById("source-heading");
      sourceHeading?.scrollIntoView({ behavior: "smooth", block: "start" });
      pageToast("Receipt and EasyFile metadata added to the Easy Save queue. Choose a destination, then select Save all.");

      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("captureHandoff");
      history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    } catch (error) {
      console.error(error);
      pageToast(error.message || "Could not receive the Easy Capture document.");
    }
  }

  async function boot() {
    cleanupHandoffs().catch(() => {});
    if (current === "easy-capture.html") {
      installSmartExtractOcrBridge();
      installEasySaveButton();
    } else if (current === "easy-save.html") {
      await installEasySaveHandoffReceiver();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();