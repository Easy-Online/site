/* Built-in Easy Edit adapters. Requires pdf.js, pdf-lib, Mammoth and SheetJS where applicable. */
(function (global) {
  "use strict";

  const { extOf, baseName } = global.EasyEdit || {};
  const textExt = new Set(["txt","md","markdown","json","csv","xml","svg","css","js","mjs","ts","yaml","yml","log"]);
  const imageExt = new Set(["png","jpg","jpeg","webp","gif","bmp"]);

  function bytesToText(data) {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return data.text();
    const bytes = data instanceof ArrayBuffer ? data : data?.buffer;
    return new TextDecoder().decode(bytes || new ArrayBuffer(0));
  }
  async function toArrayBuffer(data) {
    if (data instanceof ArrayBuffer) return data.slice(0);
    if (data instanceof Blob) return data.arrayBuffer();
    if (typeof data === "string") return new TextEncoder().encode(data).buffer;
    if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    throw new Error("Unsupported binary document payload.");
  }
  function saveName(current, extension) {
    const base = baseName(current.name || "easy-edit");
    return `${base}-edited.${extension}`;
  }
  function copy(value) {
    if (global.structuredClone) return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function normaliseRotation(value) { return ((Number(value || 0) % 360) + 360) % 360; }

  const textAdapter = {
    id: "text",
    supports(d) { return textExt.has(d.extension) || String(d.mimeType || "").startsWith("text/"); },
    async open(d) { return { model: { text: await bytesToText(d.data), extension: d.extension || "txt" } }; },
    capabilities(model) { return { editText: true, formatJson: model.extension === "json", export: [model.extension || "txt"] }; },
    snapshot(model) { return { text: model.text, extension: model.extension }; },
    restore(_model, state) { return { ...state }; },
    apply(model, action, payload) {
      if (action === "set-text") return { ...model, text: String(payload.text ?? "") };
      if (action === "format-json") return { ...model, text: JSON.stringify(JSON.parse(model.text), null, 2) };
      if (action === "minify-json") return { ...model, text: JSON.stringify(JSON.parse(model.text)) };
      return model;
    },
    async export(model, _format, current) {
      const extension = model.extension || current.extension || "txt";
      const mime = extension === "json" ? "application/json" : extension === "csv" ? "text/csv" : "text/plain";
      return { blob: new Blob([model.text], { type: `${mime};charset=utf-8` }), name: current.name || `easy-edit.${extension}`, mimeType: mime };
    },
    recovery(model) { return { text: model.text, extension: model.extension }; }
  };

  const htmlAdapter = {
    id: "html",
    supports(d) { return ["html","htm"].includes(d.extension) || d.mimeType === "text/html"; },
    async open(d) { return { model: { source: await bytesToText(d.data) } }; },
    capabilities() { return { visual: true, source: true, elements: true, export: ["html"] }; },
    snapshot(model) { return { source: model.source }; },
    restore(_model, state) { return { source: state.source }; },
    apply(model, action, payload) {
      if (action === "set-source") return { ...model, source: String(payload.source ?? "") };
      return model;
    },
    async export(model, _format, current) {
      const name = /\.html?$/i.test(current.name) ? current.name.replace(/\.htm$/i, ".html") : `${baseName(current.name)}.html`;
      return { blob: new Blob([model.source], { type: "text/html;charset=utf-8" }), name, mimeType: "text/html" };
    },
    recovery(model) { return { source: model.source }; }
  };

  const imageAdapter = {
    id: "image",
    supports(d) { return imageExt.has(d.extension) || String(d.mimeType || "").startsWith("image/"); },
    async open(d) {
      const sourceBytes = await toArrayBuffer(d.data);
      const blob = new Blob([sourceBytes], { type: d.mimeType || "image/*" });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      try {
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Image could not be decoded.")); image.src = url; });
      } finally { URL.revokeObjectURL(url); }
      return { model: { sourceBytes, mimeType: d.mimeType || blob.type, width: image.naturalWidth, height: image.naturalHeight, image, rotation: 0, flipX: false, gray: false, brightness: 100, contrast: 100, overlays: [] } };
    },
    capabilities() { return { rotate: true, flip: true, filters: true, textOverlay: true, export: ["png","jpg"] }; },
    snapshot(model) { return { rotation: model.rotation, flipX: model.flipX, gray: model.gray, brightness: model.brightness, contrast: model.contrast, overlays: copy(model.overlays) }; },
    restore(model, state) { return { ...model, ...state, overlays: copy(state.overlays || []) }; },
    apply(model, action, p) {
      if (action === "rotate") model.rotation = (model.rotation + Number(p.degrees || 0)) % 360;
      if (action === "flip-x") model.flipX = !model.flipX;
      if (action === "toggle-gray") model.gray = !model.gray;
      if (action === "brightness") model.brightness = Number(p.value || 100);
      if (action === "contrast") model.contrast = Number(p.value || 100);
      if (action === "add-text") model.overlays.push({ text: String(p.text || ""), x: Number(p.x), y: Number(p.y), size: Math.max(8, Number(p.size || 30)) });
      if (action === "clear-text") model.overlays = [];
      return model;
    },
    render(model, canvas) {
      const rot = ((model.rotation % 360) + 360) % 360;
      const swap = rot === 90 || rot === 270;
      const ctx = canvas.getContext("2d");
      canvas.width = swap ? model.height : model.width;
      canvas.height = swap ? model.width : model.height;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rot * Math.PI / 180);
      ctx.scale(model.flipX ? -1 : 1, 1);
      ctx.filter = `brightness(${model.brightness}%) contrast(${model.contrast}%) grayscale(${model.gray ? 100 : 0}%)`;
      ctx.drawImage(model.image, -model.width / 2, -model.height / 2);
      ctx.restore();
      ctx.filter = "none";
      ctx.fillStyle = "#111827";
      model.overlays.forEach((o) => { ctx.font = `700 ${o.size}px Arial`; ctx.fillText(o.text, o.x * canvas.width, o.y * canvas.height); });
    },
    async export(model, format, current) {
      const canvas = document.createElement("canvas");
      this.render(model, canvas);
      const wantsJpeg = format === "jpg" || format === "jpeg" || ["jpg","jpeg"].includes(current.extension);
      const mimeType = wantsJpeg ? "image/jpeg" : "image/png";
      const extension = wantsJpeg ? "jpg" : "png";
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image export failed.")), mimeType, .94));
      return { blob, name: saveName(current, extension), mimeType };
    },
    recovery(model) { return { sourceBytes: model.sourceBytes, mimeType: model.mimeType, width: model.width, height: model.height, rotation: model.rotation, flipX: model.flipX, gray: model.gray, brightness: model.brightness, contrast: model.contrast, overlays: model.overlays }; }
  };

  const pdfAdapter = {
    id: "pdf",
    supports(d) { return d.extension === "pdf" || d.mimeType === "application/pdf"; },
    async open(d) {
      if (!global.pdfjsLib || !global.PDFLib) throw new Error("PDF libraries did not load.");
      const bytes = await toArrayBuffer(d.data);
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdfjsDoc = await global.pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
      return { model: { bytes, pdfjsDoc, page: 1, numPages: pdfjsDoc.numPages, rotations: Array(pdfjsDoc.numPages).fill(0), overlays: {} } };
    },
    capabilities() { return { pages: true, rotate: true, textOverlay: true, export: ["pdf"] }; },
    snapshot(model) { return { page: model.page, rotations: copy(model.rotations), overlays: copy(model.overlays) }; },
    restore(model, state) { return { ...model, page: state.page, rotations: copy(state.rotations), overlays: copy(state.overlays) }; },
    async apply(model, action, p) {
      if (action === "page") model.page = Math.min(model.numPages, Math.max(1, Number(p.page || 1)));
      if (action === "rotate") { const i = model.page - 1; model.rotations[i] = (model.rotations[i] + Number(p.degrees || 0) + 360) % 360; }
      if (action === "add-text") {
        const page = await model.pdfjsDoc.getPage(model.page);
        const viewport = page.getViewport({ scale: 1.4, rotation: normaliseRotation(page.rotate + model.rotations[model.page - 1]) });
        const [pdfX, pdfY] = viewport.convertToPdfPoint(Number(p.x) * viewport.width, Number(p.y) * viewport.height);
        (model.overlays[model.page] ||= []).push({ text: String(p.text || ""), pdfX, pdfY, size: Math.max(6, Number(p.size || 18)) });
      }
      if (action === "clear-page-overlays") model.overlays[model.page] = [];
      return model;
    },
    async render(model, canvas) {
      const page = await model.pdfjsDoc.getPage(model.page);
      const viewport = page.getViewport({ scale: 1.4, rotation: normaliseRotation(page.rotate + model.rotations[model.page - 1]) });
      const ctx = canvas.getContext("2d");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      ctx.fillStyle = "#0f172a";
      (model.overlays[model.page] || []).forEach((o) => {
        const point = Number.isFinite(o.pdfX) ? viewport.convertToViewportPoint(o.pdfX, o.pdfY) : [o.x * canvas.width, o.y * canvas.height];
        ctx.font = `${o.size * viewport.scale}px Arial`;
        ctx.fillText(o.text, point[0], point[1]);
      });
      return { width: canvas.width, height: canvas.height, page: model.page, numPages: model.numPages };
    },
    async export(model, _format, current) {
      const doc = await global.PDFLib.PDFDocument.load(model.bytes.slice(0));
      const pages = doc.getPages();
      const font = await doc.embedFont(global.PDFLib.StandardFonts.Helvetica);
      pages.forEach((page, i) => {
        const extra = model.rotations[i] || 0;
        const finalRotation = normaliseRotation(page.getRotation().angle + extra);
        if (extra) page.setRotation(global.PDFLib.degrees(finalRotation));
        const { width, height } = page.getSize();
        const overlayRotation = normaliseRotation(360 - finalRotation);
        (model.overlays[i + 1] || []).forEach((o) => page.drawText(o.text, {
          x: Number.isFinite(o.pdfX) ? o.pdfX : o.x * width,
          y: Number.isFinite(o.pdfY) ? o.pdfY : (1 - o.y) * height,
          size: o.size,
          font,
          rotate: global.PDFLib.degrees(overlayRotation),
          color: global.PDFLib.rgb(.06,.09,.16)
        }));
      });
      const bytes = await doc.save();
      return { blob: new Blob([bytes], { type: "application/pdf" }), name: saveName(current, "pdf"), mimeType: "application/pdf" };
    },
    recovery(model) { return { bytes: model.bytes, page: model.page, numPages: model.numPages, rotations: model.rotations, overlays: model.overlays }; }
  };

  const docxAdapter = {
    id: "docx",
    supports(d) { return d.extension === "docx" || d.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; },
    async open(d) {
      if (!global.mammoth) throw new Error("DOCX conversion library did not load.");
      const bytes = await toArrayBuffer(d.data);
      const result = await global.mammoth.convertToHtml({ arrayBuffer: bytes });
      const source = `<!doctype html><html><head><meta charset="utf-8"><title>${baseName(d.name)}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:auto;padding:40px;line-height:1.6}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:6px}</style></head><body>${result.value}</body></html>`;
      return { delegateAdapterId: "html", model: { source }, name: `${baseName(d.name)}.html`, mimeType: "text/html", extension: "html", warnings: ["DOCX was converted to editable HTML; complex Word layout may not be preserved."] };
    }
  };

  const workbookAdapter = {
    id: "workbook",
    supports(d) { return ["xlsx","xls"].includes(d.extension); },
    async open(d) {
      if (!global.XLSX) throw new Error("Spreadsheet conversion library did not load.");
      const bytes = await toArrayBuffer(d.data);
      const wb = global.XLSX.read(bytes, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const csv = global.XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
      return { delegateAdapterId: "text", model: { text: csv, extension: "csv" }, name: `${baseName(d.name)}.csv`, mimeType: "text/csv", extension: "csv", warnings: [`Workbook opened as CSV from sheet: ${sheetName}.`] };
    }
  };

  global.EasyEditAdapters = Object.freeze({
    registerAll(engine) {
      [pdfAdapter, imageAdapter, htmlAdapter, textAdapter, docxAdapter, workbookAdapter].forEach((adapter) => engine.registerAdapter(adapter));
      return engine;
    },
    adapters: Object.freeze({ pdf: pdfAdapter, image: imageAdapter, html: htmlAdapter, text: textAdapter, docx: docxAdapter, workbook: workbookAdapter })
  });
})(window);
