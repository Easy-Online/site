/* Easy Capture progressive enhancements: receipt OCR, parsing, scanned-PDF support, line-item editing and upload guards. */
(function () {
  "use strict";

  if ((location.pathname.split("/").pop() || "").toLowerCase() !== "easy-capture.html") return;

  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_IMAGE_DIMENSION = 2200;
  const MAX_OCR_PDF_PAGES = 12;
  const root = window;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }

  ready(() => initialize().catch((error) => {
    console.error("Easy Capture enhancements failed to initialize", error);
    root.toast?.("Easy Capture OCR enhancements could not be loaded.");
  }));

  async function initialize() {
    await ensureParser();
    if (typeof root.renderLines === "function") installLineItemEditor();
    if (typeof root.ingestFiles === "function") installUploadGuard();
    if (typeof root.smartExtract === "function") installSmartExtraction();
    if (typeof root.extractText === "function") installEnhancedOcr();
  }

  async function ensureParser() {
    if (root.EasyCaptureParser) return root.EasyCaptureParser;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src$="assets/js/easy-capture-parser.js"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "assets/js/easy-capture-parser.js";
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Easy Capture parser."));
      document.head.appendChild(script);
    });
    if (!root.EasyCaptureParser) throw new Error("Easy Capture parser did not initialize.");
    return root.EasyCaptureParser;
  }

  function installLineItemEditor() {
    root.renderLines = function renderLinesEnhanced() {
      const r = root.active?.();
      const tbody = document.getElementById("lineRows");
      if (!r || !tbody) return;

      const items = r.lineItems || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-5 text-center text-slate-500">No line items.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map((x, i) => `
        <tr class="border-t" data-line-row="${i}">
          <td class="p-2"><input class="input line-desc" data-field="description" data-i="${i}" value="${root.escapeHtml(x.description || "")}"></td>
          <td class="p-2"><input class="input line-qty" data-field="qty" data-i="${i}" type="number" min="0" step="0.001" value="${Number(x.qty ?? 1)}"></td>
          <td class="p-2"><input class="input line-unit" data-field="unit" data-i="${i}" type="number" min="0" step="0.01" value="${Number(x.unit ?? 0)}"></td>
          <td class="p-2"><input class="input line-vat" data-field="vatPct" data-i="${i}" type="number" min="0" step="0.01" value="${Number(x.vatPct ?? 15)}"></td>
          <td class="p-2 text-right mono" data-line-total="${i}">${root.money(Number(x.qty || 0) * Number(x.unit || 0), r.fields?.currency || "ZAR")}</td>
          <td class="p-2 no-print"><button class="text-red-600" data-del-line="${i}" title="Delete line" aria-label="Delete line ${i + 1}"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`).join("");

      tbody.querySelectorAll("input[data-i]").forEach((input) => {
        input.addEventListener("input", () => {
          const i = Number(input.dataset.i);
          const item = r.lineItems[i];
          if (!item) return;
          const field = input.dataset.field;
          item[field] = field === "description" ? input.value : Number(input.value || 0);
          item.total = Number(item.qty || 0) * Number(item.unit || 0);
          const totalCell = tbody.querySelector(`[data-line-total="${i}"]`);
          if (totalCell) totalCell.textContent = root.money(item.total, r.fields?.currency || "ZAR");
          root.persist?.();
        });
      });

      tbody.querySelectorAll("[data-del-line]").forEach((button) => {
        button.addEventListener("click", () => {
          r.lineItems.splice(Number(button.dataset.delLine), 1);
          root.logEvent?.(r, "Line item removed");
          root.persist?.();
          root.renderLines();
          root.renderAudit?.();
        });
      });
    };

    root.renderLines();
  }

  function installUploadGuard() {
    const original = root.ingestFiles;
    root.ingestFiles = async function guardedIngestFiles(fileList) {
      const files = Array.from(fileList || []);
      const accepted = [];
      let skipped = 0;
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          skipped++;
          root.toast?.(`${file.name} exceeds the 25 MB local capture limit.`);
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length) await original.call(root, accepted);
      if (skipped && !accepted.length) root.toast?.("No files were added.");
    };
  }

  function installSmartExtraction() {
    const parser = root.EasyCaptureParser;
    const oldButton = document.getElementById("btnExtract");
    if (oldButton) {
      const button = oldButton.cloneNode(true);
      oldButton.replaceWith(button);
      button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Extract fields';
      button.title = "Extract structured receipt fields from the current OCR evidence";
      button.addEventListener("click", enhancedSmartExtract);
    }

    const textArea = document.getElementById("fText");
    const section = textArea?.closest("section");
    if (section && !document.getElementById("ocrReviewTools")) {
      const tools = document.createElement("div");
      tools.id = "ocrReviewTools";
      tools.className = "mt-3 flex flex-wrap items-center gap-2 no-print";
      tools.innerHTML = `
        <button type="button" class="btn btn-outline" id="btnCleanOcr"><i class="fa-solid fa-broom"></i> Clean text</button>
        <button type="button" class="btn btn-outline" id="btnCopyOcr"><i class="fa-solid fa-copy"></i> Copy text</button>
        <span id="ocrQuality" class="pill pill-gray">OCR quality: —</span>`;
      textArea.insertAdjacentElement("afterend", tools);

      const diagnostics = document.createElement("div");
      diagnostics.id = "ocrDiagnostics";
      diagnostics.className = "mt-3 text-xs text-slate-600";
      tools.insertAdjacentElement("afterend", diagnostics);

      document.getElementById("btnCleanOcr")?.addEventListener("click", () => {
        const cleaned = parser.normalizeText(textArea.value);
        textArea.value = cleaned;
        textArea.dispatchEvent(new Event("input", { bubbles: true }));
        renderOcrDiagnostics();
        root.toast?.("OCR evidence cleaned.");
      });

      document.getElementById("btnCopyOcr")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(textArea.value || "");
          root.toast?.("OCR evidence copied.");
        } catch {
          textArea.select();
          document.execCommand?.("copy");
          root.toast?.("OCR evidence copied.");
        }
      });

      textArea.addEventListener("input", () => renderOcrDiagnostics());
    }

    document.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-id]")) setTimeout(renderOcrDiagnostics, 0);
    });

    root.smartExtract = enhancedSmartExtract;
    setTimeout(renderOcrDiagnostics, 0);
  }

  function enhancedSmartExtract() {
    const parser = root.EasyCaptureParser;
    const text = document.getElementById("fText")?.value || "";
    if (!text.trim()) {
      root.toast?.("Run OCR or paste corrected receipt text first.");
      return;
    }

    const parsed = parser.parseReceiptText(text);
    const r = root.active?.();
    if (!r) return;

    root.readForm?.();
    const fields = r.fields || (r.fields = {});
    const fieldMap = [
      "supplier", "supplierVat", "number", "date", "currency", "category",
      "amountExcl", "vatPct", "vatAmt", "amountIncl", "paymentMethod", "type"
    ];
    fieldMap.forEach((key) => {
      if (parsed[key] !== undefined && parsed[key] !== null && parsed[key] !== "") fields[key] = parsed[key];
    });

    if (parsed.lineItems?.length) {
      r.lineItems = parsed.lineItems.map((item) => ({
        description: item.description,
        qty: Number(item.qty || 0),
        unit: Number(item.unit || 0),
        vatPct: Number(item.vatPct || 0),
        total: Number(item.total || 0)
      }));
    }

    r.confidence = parsed.confidence || 0;
    r.fieldConfidence = parsed.fieldConfidence || {};
    r.extractionWarnings = parsed.warnings || [];
    r.extractionEngine = "receipt-parser-v2";
    r.extractedText = parser.normalizeText(text);

    const requiredComplete = Boolean(fields.supplier && fields.date && Number(fields.amountIncl) > 0 && fields.category);
    const hardWarning = r.extractionWarnings.some((warning) => /VAT arithmetic|Total amount|Transaction date|Supplier could not/i.test(warning));
    if (r.status !== "duplicate" && r.status !== "processed") {
      r.status = requiredComplete && r.confidence >= 85 && !hardWarning ? "ready" : "needs-review";
    }

    root.logEvent?.(r, "Smart extraction", `${r.confidence}% confidence · ${r.lineItems?.length || 0} line item(s)`);
    root.persist?.();
    root.renderAll?.();
    renderOcrDiagnostics();
    root.toast?.(`Fields extracted: ${r.confidence}% confidence${r.extractionWarnings.length ? ` · ${r.extractionWarnings.length} review item(s)` : ""}.`);
  }

  function renderOcrDiagnostics() {
    const parser = root.EasyCaptureParser;
    const text = document.getElementById("fText")?.value || "";
    const quality = parser?.qualityScore?.(text) || 0;
    const r = root.active?.();
    const qualityEl = document.getElementById("ocrQuality");
    if (qualityEl) {
      const ocrConfidence = Number(r?.ocr?.confidence || 0);
      qualityEl.textContent = ocrConfidence ? `OCR ${Math.round(ocrConfidence)}% · evidence ${quality}%` : `Evidence quality: ${quality}%`;
      qualityEl.className = `pill ${quality >= 80 ? "pill-green" : quality >= 55 ? "pill-amber" : "pill-gray"}`;
    }

    const diagnostics = document.getElementById("ocrDiagnostics");
    if (!diagnostics) return;
    const warnings = r?.extractionWarnings || [];
    const engine = r?.ocr?.mode ? `OCR mode: ${r.ocr.mode}` : "";
    const items = r?.lineItems?.length ? `${r.lineItems.length} line item${r.lineItems.length === 1 ? "" : "s"} detected` : "";
    const meta = [engine, items].filter(Boolean).join(" · ");
    diagnostics.innerHTML = `${meta ? `<p class="font-bold text-slate-500">${root.escapeHtml(meta)}</p>` : ""}${warnings.length ? `<div class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900"><strong>Review before posting:</strong><ul class="list-disc pl-5 mt-1">${warnings.map((warning) => `<li>${root.escapeHtml(warning)}</li>`).join("")}</ul></div>` : text.trim() ? '<p class="mt-2 text-emerald-700 font-bold">No parser warnings detected.</p>' : '<p class="mt-2">Run OCR, or paste corrected receipt text, then choose Extract fields.</p>'}`;
  }

  function installEnhancedOcr() {
    const button = document.getElementById("btnExtractText");
    if (!button) return;

    const replacement = button.cloneNode(true);
    button.replaceWith(replacement);
    replacement.innerHTML = '<i class="fa-solid fa-font"></i> Run OCR';
    replacement.title = "Extract text from the original receipt or invoice";
    replacement.addEventListener("click", enhancedExtractText);

    async function enhancedExtractText() {
      const r = root.active?.();
      if (!r) return;
      const blob = await root.getBlob?.(r.id);
      if (!blob) {
        root.toast?.("Original file is unavailable.");
        return;
      }

      replacement.disabled = true;
      replacement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing…';

      try {
        let text = "";
        let ocrConfidence = 0;
        let mode = "";
        let passes = 1;

        if (blob.type === "application/pdf") {
          await root.ensureScript("pdfjs-lib", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const pdf = await window.pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;

          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            text += content.items.map((item) => item.str).join(" ") + "\n";
          }

          if (root.EasyCaptureParser.qualityScore(text) < 45) {
            const result = await ocrPdfPages(pdf);
            text = result.text;
            ocrConfidence = result.confidence;
            passes = result.passes;
            mode = "scanned PDF OCR";
          } else {
            mode = "PDF text layer";
            ocrConfidence = 100;
          }
        } else {
          await root.ensureScript("tesseract-lib", "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js");
          const canvas = await prepareReceiptCanvas(blob);
          const result = await recognizeBest(canvas, "image receipt");
          text = result.text;
          ocrConfidence = result.confidence;
          passes = result.passes;
          mode = result.mode;
          canvas.width = canvas.height = 1;
        }

        text = root.EasyCaptureParser.normalizeText(text);
        r.extractedText = text;
        r.ocr = {
          engine: "tesseract.js/pdf.js",
          confidence: Number(ocrConfidence || 0),
          evidenceQuality: root.EasyCaptureParser.qualityScore(text),
          mode,
          passes,
          preprocessing: mode === "PDF text layer" ? "none" : "receipt-contrast-v2",
          processedAt: new Date().toISOString()
        };
        root.logEvent?.(r, "Text extracted", `${mode} · ${Math.round(ocrConfidence || 0)}% OCR confidence`);
        root.persist?.();
        const field = document.getElementById("fText");
        if (field) field.value = text;
        renderOcrDiagnostics();
        root.toast?.("OCR complete. Extracting receipt fields…");
        enhancedSmartExtract();
      } catch (error) {
        console.error("Easy Capture OCR failed", error);
        root.toast?.(error?.message || "Text extraction failed.");
      } finally {
        replacement.disabled = false;
        replacement.innerHTML = '<i class="fa-solid fa-font"></i> Run OCR';
      }
    }

    async function ocrPdfPages(pdf) {
      await root.ensureScript("tesseract-lib", "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js");
      const pageCount = Math.min(pdf.numPages, MAX_OCR_PDF_PAGES);
      const pages = [];
      let confidenceTotal = 0;
      let totalPasses = 0;

      for (let p = 1; p <= pageCount; p++) {
        replacement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> OCR page ${p}/${pageCount}`;
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2.0 });
        const rawCanvas = document.createElement("canvas");
        rawCanvas.width = Math.ceil(viewport.width);
        rawCanvas.height = Math.ceil(viewport.height);
        const context = rawCanvas.getContext("2d", { alpha: false });
        await page.render({ canvasContext: context, viewport }).promise;
        const enhanced = enhanceCanvas(rawCanvas);
        const result = await recognizeBest(enhanced, `PDF page ${p}`);
        pages.push(result.text || "");
        confidenceTotal += result.confidence || 0;
        totalPasses += result.passes || 1;
        rawCanvas.width = rawCanvas.height = 1;
        enhanced.width = enhanced.height = 1;
      }

      if (pdf.numPages > pageCount) root.toast?.(`OCR limited to the first ${pageCount} PDF pages.`);
      return { text: pages.join("\n\n"), confidence: pageCount ? confidenceTotal / pageCount : 0, passes: totalPasses };
    }

    async function recognizeBest(canvas, label) {
      const first = await recognize(canvas, "6", `${label} OCR`);
      const firstQuality = root.EasyCaptureParser.qualityScore(first.text);
      let best = { ...first, passes: 1, mode: "structured receipt OCR" };

      if (firstQuality < 72 || Number(first.confidence || 0) < 62) {
        const second = await recognize(canvas, "11", `${label} sparse OCR`);
        const secondQuality = root.EasyCaptureParser.qualityScore(second.text);
        const firstScore = firstQuality + Number(first.confidence || 0) * 0.45;
        const secondScore = secondQuality + Number(second.confidence || 0) * 0.45;
        best = secondScore > firstScore
          ? { ...second, passes: 2, mode: "sparse receipt OCR" }
          : { ...first, passes: 2, mode: "structured receipt OCR" };
      }
      return best;
    }

    async function recognize(canvas, psm, progressLabel) {
      const result = await window.Tesseract.recognize(canvas, "eng", {
        logger: (message) => {
          if (message.status === "recognizing text") {
            replacement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${progressLabel} ${Math.round((message.progress || 0) * 100)}%`;
          }
        }
      }, {
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: "1"
      });
      return { text: result.data?.text || "", confidence: Number(result.data?.confidence || 0) };
    }
  }

  async function prepareReceiptCanvas(blob) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(blob);
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const source = document.createElement("canvas");
    source.width = Math.max(1, Math.round(bitmap.width * scale));
    source.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = source.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, source.width, source.height);
    context.drawImage(bitmap, 0, 0, source.width, source.height);
    bitmap.close?.();

    const cropped = cropToPaper(source);
    source.width = source.height = 1;
    return enhanceCanvas(cropped);
  }

  function cropToPaper(canvas) {
    const sampleWidth = Math.min(360, canvas.width);
    const ratio = sampleWidth / canvas.width;
    const sampleHeight = Math.max(1, Math.round(canvas.height * ratio));
    const sample = document.createElement("canvas");
    sample.width = sampleWidth;
    sample.height = sampleHeight;
    const sampleContext = sample.getContext("2d", { alpha: false, willReadFrequently: true });
    sampleContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
    const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const columnHits = new Uint32Array(sampleWidth);
    const rowHits = new Uint32Array(sampleHeight);

    for (let y = 0; y < sampleHeight; y += 2) {
      for (let x = 0; x < sampleWidth; x += 2) {
        const i = (y * sampleWidth + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const luma = (0.299 * r) + (0.587 * g) + (0.114 * b);
        if (luma > 168 && (max - min) < 88) {
          columnHits[x]++;
          rowHits[y]++;
        }
      }
    }

    const minColumnHits = sampleHeight * 0.055;
    const minRowHits = sampleWidth * 0.055;
    let left = 0, right = sampleWidth - 1, top = 0, bottom = sampleHeight - 1;
    while (left < right && columnHits[left] < minColumnHits) left++;
    while (right > left && columnHits[right] < minColumnHits) right--;
    while (top < bottom && rowHits[top] < minRowHits) top++;
    while (bottom > top && rowHits[bottom] < minRowHits) bottom--;

    const widthRatio = (right - left + 1) / sampleWidth;
    const heightRatio = (bottom - top + 1) / sampleHeight;
    if (widthRatio < 0.20 || heightRatio < 0.25) {
      sample.width = sample.height = 1;
      return canvas;
    }

    const marginX = Math.round(sampleWidth * 0.025);
    const marginY = Math.round(sampleHeight * 0.02);
    left = Math.max(0, left - marginX);
    right = Math.min(sampleWidth - 1, right + marginX);
    top = Math.max(0, top - marginY);
    bottom = Math.min(sampleHeight - 1, bottom + marginY);

    const sx = Math.round(left / ratio);
    const sy = Math.round(top / ratio);
    const sw = Math.max(1, Math.round((right - left + 1) / ratio));
    const sh = Math.max(1, Math.round((bottom - top + 1) / ratio));
    const cropped = document.createElement("canvas");
    cropped.width = Math.min(sw, canvas.width - sx);
    cropped.height = Math.min(sh, canvas.height - sy);
    cropped.getContext("2d", { alpha: false }).drawImage(canvas, sx, sy, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    sample.width = sample.height = 1;
    return cropped;
  }

  function enhanceCanvas(source) {
    const upscale = source.width < 1500 ? Math.min(2, 1700 / Math.max(1, source.width)) : 1;
    const target = document.createElement("canvas");
    target.width = Math.max(1, Math.round(source.width * upscale));
    target.height = Math.max(1, Math.round(source.height * upscale));
    const context = target.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, target.width, target.height);
    context.filter = "grayscale(1) contrast(1.55) brightness(1.08)";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, target.width, target.height);
    context.filter = "none";
    if (source !== target) source.width = source.height = 1;
    return target;
  }
})();
