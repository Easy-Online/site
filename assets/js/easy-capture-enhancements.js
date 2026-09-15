/* Easy Capture progressive enhancements: scanned-PDF OCR, line-item editing and upload guards */
(function () {
  "use strict";

  if ((location.pathname.split("/").pop() || "").toLowerCase() !== "easy-capture.html") return;

  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const root = window;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }

  ready(() => {
    if (typeof root.renderLines === "function") installLineItemEditor();
    if (typeof root.extractText === "function") installEnhancedOcr();
    if (typeof root.ingestFiles === "function") installUploadGuard();
  });

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
          <td class="p-2"><input class="input line-qty" data-field="qty" data-i="${i}" type="number" min="0" step="0.01" value="${Number(x.qty ?? 1)}"></td>
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
          const totalCell = tbody.querySelector(`[data-line-total="${i}"]`);
          if (totalCell) totalCell.textContent = root.money(Number(item.qty || 0) * Number(item.unit || 0), r.fields?.currency || "ZAR");
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

  function installEnhancedOcr() {
    const button = document.getElementById("btnExtractText");
    if (!button) return;

    const replacement = button.cloneNode(true);
    button.replaceWith(replacement);
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
      replacement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Extracting…';

      try {
        let text = "";
        if (blob.type === "application/pdf") {
          await root.ensureScript("pdfjs-lib", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const pdf = await window.pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;

          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            text += content.items.map((item) => item.str).join(" ") + "\n";
          }

          if (text.replace(/\s/g, "").length < 20) {
            text = await ocrPdfPages(pdf);
            root.logEvent?.(r, "Text extracted", "Scanned PDF browser OCR");
          } else {
            root.logEvent?.(r, "Text extracted", "PDF text layer");
          }
        } else {
          await root.ensureScript("tesseract-lib", "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js");
          const result = await window.Tesseract.recognize(blob, "eng", {
            logger: (message) => {
              if (message.status === "recognizing text") {
                replacement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> OCR ${Math.round((message.progress || 0) * 100)}%`;
              }
            }
          });
          text = result.data.text || "";
          root.logEvent?.(r, "Text extracted", "Image browser OCR");
        }

        r.extractedText = text;
        root.persist?.();
        const field = document.getElementById("fText");
        if (field) field.value = text;
        root.toast?.("Text extraction complete.");
        root.smartExtract?.();
      } catch (error) {
        console.error("Easy Capture OCR failed", error);
        root.toast?.(error?.message || "Text extraction failed.");
      } finally {
        replacement.disabled = false;
        replacement.innerHTML = '<i class="fa-solid fa-font"></i> Extract text';
      }
    }

    async function ocrPdfPages(pdf) {
      await root.ensureScript("tesseract-lib", "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js");
      const pages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        replacement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> OCR page ${p}/${pdf.numPages}`;
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        await page.render({ canvasContext: context, viewport }).promise;
        const result = await window.Tesseract.recognize(canvas, "eng");
        pages.push(result.data.text || "");
        canvas.width = canvas.height = 1;
      }
      return pages.join("\n\n");
    }
  }
})();
