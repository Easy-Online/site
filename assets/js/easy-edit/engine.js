/* Easy Edit shared document engine. UI-independent and reusable by EasyFile modules. */
(function (global) {
  "use strict";

  class HistoryStack {
    constructor(limit = 80) { this.limit = limit; this.entries = []; this.index = -1; }
    reset(snapshot) { this.entries = [snapshot]; this.index = 0; }
    push(snapshot) {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push(snapshot);
      if (this.entries.length > this.limit) this.entries.shift();
      this.index = this.entries.length - 1;
    }
    canUndo() { return this.index > 0; }
    canRedo() { return this.index >= 0 && this.index < this.entries.length - 1; }
    undo() { if (!this.canUndo()) return null; this.index -= 1; return this.entries[this.index]; }
    redo() { if (!this.canRedo()) return null; this.index += 1; return this.entries[this.index]; }
    current() { return this.index >= 0 ? this.entries[this.index] : null; }
  }

  function extOf(name = "") { return (String(name).split(".").pop() || "").toLowerCase(); }
  function baseName(name = "") { return String(name).replace(/\.[^.]+$/, "") || "easy-edit"; }
  function clone(value) {
    if (global.structuredClone) return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  class Engine extends EventTarget {
    constructor(options = {}) {
      super();
      this.adapters = new Map();
      this.history = new HistoryStack(options.historyLimit || 80);
      this.current = null;
      this.dirty = false;
      this.bus = options.bus || global.EasyFileDocumentBus || null;
      this.recoveryLimitBytes = options.recoveryLimitBytes || 25 * 1024 * 1024;
      this.recoveryTimer = null;
    }

    registerAdapter(adapter) {
      if (!adapter?.id || typeof adapter.supports !== "function" || typeof adapter.open !== "function") {
        throw new TypeError("Invalid Easy Edit adapter.");
      }
      this.adapters.set(adapter.id, adapter);
      return this;
    }

    adapter(id = this.current?.adapterId) { return id ? this.adapters.get(id) : null; }
    capabilities() { return this.adapter()?.capabilities?.(this.current?.model) || {}; }

    async descriptorFromFile(file, metadata = {}) {
      return {
        id: metadata.id || null,
        name: file.name || metadata.name || "untitled",
        mimeType: file.type || metadata.mimeType || "application/octet-stream",
        extension: extOf(file.name || metadata.name || ""),
        sourceModule: metadata.sourceModule || "local-file",
        data: await file.arrayBuffer(),
        file,
        metadata
      };
    }

    async openFile(file, metadata = {}) { return this.openDocument(await this.descriptorFromFile(file, metadata)); }

    async openDocument(document) {
      if (!document) throw new TypeError("A document is required.");
      const descriptor = {
        id: document.id || null,
        name: document.name || "untitled",
        mimeType: document.mimeType || "application/octet-stream",
        extension: document.extension || extOf(document.name || ""),
        sourceModule: document.sourceModule || "unknown",
        data: document.data,
        metadata: document.metadata || {}
      };
      const adapter = Array.from(this.adapters.values()).find((candidate) => candidate.supports(descriptor));
      if (!adapter) throw new Error(`No Easy Edit adapter supports ${descriptor.name}.`);
      let opened = await adapter.open(descriptor, this);
      let activeAdapter = adapter;
      if (opened?.delegateAdapterId) {
        activeAdapter = this.adapters.get(opened.delegateAdapterId);
        if (!activeAdapter) throw new Error(`Missing delegate adapter: ${opened.delegateAdapterId}`);
        descriptor.name = opened.name || descriptor.name;
        descriptor.mimeType = opened.mimeType || descriptor.mimeType;
        descriptor.extension = opened.extension || extOf(descriptor.name);
        opened = { model: opened.model, warnings: opened.warnings || [] };
      }
      const model = opened?.model ?? opened;
      this.current = {
        id: descriptor.id || this.bus?.makeId?.("edit") || `edit-${Date.now()}`,
        originalDescriptor: { ...descriptor, data: descriptor.data },
        name: descriptor.name,
        mimeType: descriptor.mimeType,
        extension: descriptor.extension,
        sourceModule: descriptor.sourceModule,
        metadata: descriptor.metadata,
        adapterId: activeAdapter.id,
        model,
        warnings: opened?.warnings || []
      };
      this.dirty = false;
      this.history.reset(this.snapshot());
      this.emit("open", { current: this.current, capabilities: this.capabilities() });
      return this.current;
    }

    snapshot() {
      if (!this.current) return null;
      const adapter = this.adapter();
      return {
        adapterId: this.current.adapterId,
        state: adapter.snapshot ? adapter.snapshot(this.current.model) : clone(this.current.model)
      };
    }

    restore(snapshot, reason = "restore") {
      if (!snapshot || !this.current) return;
      const adapter = this.adapters.get(snapshot.adapterId);
      if (!adapter) throw new Error(`Adapter unavailable: ${snapshot.adapterId}`);
      this.current.adapterId = snapshot.adapterId;
      this.current.model = adapter.restore ? adapter.restore(this.current.model, clone(snapshot.state)) : clone(snapshot.state);
      this.dirty = reason !== "open";
      this.emit("change", { reason, dirty: this.dirty, current: this.current });
    }

    async execute(action, payload = {}) {
      if (!this.current) throw new Error("No document is open.");
      const adapter = this.adapter();
      if (typeof adapter.apply !== "function") throw new Error(`${adapter.id} does not support editing actions.`);
      const result = await adapter.apply(this.current.model, action, payload, this);
      if (result !== undefined) this.current.model = result;
      this.history.push(this.snapshot());
      this.dirty = true;
      this.emit("change", { reason: action, dirty: true, current: this.current });
      this.scheduleRecovery();
      return this.current.model;
    }

    undo() {
      const snapshot = this.history.undo();
      if (!snapshot) return false;
      this.restore(snapshot, "undo");
      return true;
    }

    redo() {
      const snapshot = this.history.redo();
      if (!snapshot) return false;
      this.restore(snapshot, "redo");
      return true;
    }

    markClean() { this.dirty = false; this.emit("clean", { current: this.current }); }

    async reset() {
      if (!this.current?.originalDescriptor) return false;
      await this.openDocument(this.current.originalDescriptor);
      return true;
    }

    async export(format) {
      if (!this.current) throw new Error("No document is open.");
      const adapter = this.adapter();
      const result = await adapter.export(this.current.model, format, this.current, this);
      if (!result?.blob) throw new Error("Adapter export did not return a Blob.");
      return result;
    }

    async createHandoff(targetUrl = "easy-edit.html", format) {
      if (!this.bus) throw new Error("EasyFile document bus is unavailable.");
      const exported = await this.export(format);
      return this.bus.handoff({
        name: exported.name,
        mimeType: exported.mimeType || exported.blob.type,
        extension: extOf(exported.name),
        sourceModule: "easy-edit",
        data: exported.blob,
        metadata: { parentId: this.current.id }
      }, targetUrl);
    }

    scheduleRecovery() {
      if (!this.bus || !this.current) return;
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => this.saveRecovery().catch(() => {}), 900);
    }

    async saveRecovery() {
      if (!this.bus || !this.current) return null;
      const snapshot = this.snapshot();
      const original = this.current.originalDescriptor;
      const originalSize = original?.data instanceof ArrayBuffer ? original.data.byteLength : original?.data instanceof Blob ? original.data.size : typeof original?.data === "string" ? new Blob([original.data]).size : 0;
      if (originalSize > this.recoveryLimitBytes) return null;
      const record = {
        id: `recovery-${this.current.id}`,
        name: this.current.name,
        mimeType: "application/x-easyedit-recovery",
        extension: "easyedit",
        sourceModule: "easy-edit",
        purpose: "recovery",
        data: {
          originalDescriptor: original,
          adapterId: this.current.adapterId,
          snapshot
        },
        metadata: { documentId: this.current.id, dirty: this.dirty }
      };
      return this.bus.put(record);
    }

    async restoreRecovery(record) {
      if (!record?.data?.originalDescriptor || !record.data.snapshot) throw new Error("Invalid Easy Edit recovery record.");
      await this.openDocument(record.data.originalDescriptor);
      if (this.current.adapterId !== record.data.snapshot.adapterId) throw new Error("Recovery adapter mismatch.");
      this.restore(record.data.snapshot, "recovery");
      this.history.reset(record.data.snapshot);
      this.dirty = true;
      this.emit("change", { reason: "recovery", dirty: true, current: this.current });
      return this.current;
    }

    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  }

  global.EasyEdit = Object.freeze({ Engine, HistoryStack, extOf, baseName });
})(window);
