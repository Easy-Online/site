/* EasyFile shared local document bus: same-origin module handoff via IndexedDB. */
(function (global) {
  "use strict";

  const DB_NAME = "easyfile-documents";
  const DB_VERSION = 1;
  const STORE = "documents";
  const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

  function makeId(prefix = "doc") {
    if (global.crypto?.randomUUID) return `${prefix}-${global.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error("IndexedDB is unavailable in this browser."));
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("sourceModule", "sourceModule");
          store.createIndex("purpose", "purpose");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open EasyFile document storage."));
    });
  }

  async function withStore(mode, operation) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        try { result = operation(store); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error("Document storage transaction failed."));
        tx.onabort = () => reject(tx.error || new Error("Document storage transaction was aborted."));
      });
    } finally {
      db.close();
    }
  }

  function dataSize(data) {
    if (!data) return 0;
    if (typeof data === "string") return new Blob([data]).size;
    if (data instanceof Blob) return data.size;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    try { return new Blob([JSON.stringify(data)]).size; } catch (_) { return 0; }
  }

  function normalise(document) {
    if (!document || typeof document !== "object") throw new TypeError("A document object is required.");
    const now = new Date().toISOString();
    const size = dataSize(document.data);
    if (size > MAX_DOCUMENT_BYTES) throw new Error("Document is too large for local EasyFile handoff (50 MB limit). Download it instead.");
    return {
      id: document.id || makeId(document.purpose === "recovery" ? "recovery" : "doc"),
      name: document.name || "untitled",
      mimeType: document.mimeType || "application/octet-stream",
      extension: document.extension || "",
      sourceModule: document.sourceModule || "unknown",
      targetModule: document.targetModule || "easy-edit",
      purpose: document.purpose || "handoff",
      data: document.data ?? null,
      metadata: document.metadata || {},
      createdAt: document.createdAt || now,
      updatedAt: now,
      size
    };
  }

  async function put(document) {
    const record = normalise(document);
    await withStore("readwrite", (store) => store.put(record));
    global.dispatchEvent(new CustomEvent("easyfile:document-bus:put", { detail: { id: record.id, record } }));
    return record;
  }

  async function get(id) {
    if (!id) return null;
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read the document."));
      });
    } finally { db.close(); }
  }

  async function remove(id) {
    if (!id) return;
    await withStore("readwrite", (store) => store.delete(id));
  }

  async function consume(id, options = {}) {
    const record = await get(id);
    if (record && options.remove !== false) await remove(id);
    return record;
  }

  async function list(options = {}) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        request.onsuccess = () => {
          let rows = request.result || [];
          if (options.purpose) rows = rows.filter((item) => item.purpose === options.purpose);
          if (options.sourceModule) rows = rows.filter((item) => item.sourceModule === options.sourceModule);
          rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
          resolve(rows.slice(0, options.limit || 50));
        };
        request.onerror = () => reject(request.error || new Error("Could not list documents."));
      });
    } finally { db.close(); }
  }

  async function cleanup(options = {}) {
    const maxAgeMs = options.maxAgeMs || 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    const records = await list({ limit: 500 });
    await Promise.all(records.filter((row) => new Date(row.updatedAt).getTime() < cutoff).map((row) => remove(row.id)));
  }

  async function handoff(document, targetUrl = "easy-edit.html") {
    const record = await put({ ...document, purpose: "handoff", targetModule: "easy-edit" });
    const separator = targetUrl.includes("?") ? "&" : "?";
    return `${targetUrl}${separator}handoff=${encodeURIComponent(record.id)}`;
  }

  global.EasyFileDocumentBus = Object.freeze({
    dbName: DB_NAME,
    maxDocumentBytes: MAX_DOCUMENT_BYTES,
    makeId,
    put,
    get,
    consume,
    remove,
    list,
    cleanup,
    handoff
  });
})(window);
