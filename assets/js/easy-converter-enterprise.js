import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PREVIEW_CHAR_LIMIT = 25000;

const state = {
  file: null,
  fileBuffer: null,
  parsed: null,
  originalName: "document.pdf",
  previewTab: "text",
  ocrLibraryLoaded: false,
  Tesseract: null,
  busy: false
};

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const analyzeBtn = $("analyzeBtn");
const resetBtn = $("resetBtn");
const notesBtn = $("notesBtn");
const clearLogBtn = $("clearLogBtn");
const fileMeta = $("fileMeta");
const statusText = $("statusText");
const statusMeta = $("statusMeta");
const progressBar = $("progressBar");
const logBody = $("logBody");
const pageCount = $("pageCount");
const charCount = $("charCount");
const tableCount = $("tableCount");
const ocrPageCount = $("ocrPageCount");
const ocrMode = $("ocrMode");
const ocrScale = $("ocrScale");
const minWordsForTextLayer = $("minWordsForTextLayer");
const lineTolerance = $("lineTolerance");
const detectTables = $("detectTables");
const includePageImages = $("includePageImages");
const mergeSparseRows = $("mergeSparseRows");
const previewText = $("previewText");
const previewTables = $("previewTables");
const previewSummary = $("previewSummary");
const exportHint = $("exportHint");
const ocrModeBadge = $("ocrModeBadge");
const exportButtons = Array.from(document.querySelectorAll("[data-format]"));
const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeSpreadsheetCell(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 2)} ${units[index]}`;
}

function baseName() {
  return (state.originalName || "document.pdf").replace(/\.pdf$/i, "") || "document";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 0);
}

function log(message, tone = "info") {
  const line = document.createElement("div");
  line.className = "converter-log-line";

  const stamp = document.createElement("span");
  stamp.className = "converter-log-time";
  stamp.textContent = `[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]`;

  const body = document.createElement("span");
  body.className = `converter-log-${["success", "warn", "error"].includes(tone) ? tone : "info"}`;
  body.textContent = String(message ?? "");

  line.append(stamp, body);
  logBody.appendChild(line);
  logBody.scrollTop = logBody.scrollHeight;
}

function setStatus(message, meta = "Idle", progress = null) {
  statusText.textContent = message;
  statusMeta.textContent = meta;
  if (progress !== null) progressBar.style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
}

function setMetricValues(parsed) {
  pageCount.textContent = String(parsed?.pageCount ?? 0);
  charCount.textContent = new Intl.NumberFormat("en-ZA").format(parsed?.characterCount ?? 0);
  tableCount.textContent = String(parsed?.tableCount ?? 0);
  ocrPageCount.textContent = String(parsed?.ocrPageCount ?? 0);
}

function setBusy(busy) {
  state.busy = busy;
  analyzeBtn.disabled = busy || !state.fileBuffer;
  resetBtn.disabled = busy;
  fileInput.disabled = busy;
  dropzone.setAttribute("aria-disabled", String(busy));
  dropzone.tabIndex = busy ? -1 : 0;
  if (busy) exportButtons.forEach((button) => { button.disabled = true; });
}

function isPdfFile(file) {
  if (!file) return false;
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  return mime === "application/pdf" || name.endsWith(".pdf");
}

function resetState({ logReset = true } = {}) {
  state.file = null;
  state.fileBuffer = null;
  state.parsed = null;
  state.originalName = "document.pdf";
  fileInput.value = "";
  fileInput.disabled = false;
  fileMeta.textContent = "No file selected yet.";
  previewText.textContent = "Upload a PDF to generate a preview.";
  previewTables.textContent = "";
  previewSummary.textContent = "";
  setMetricValues(null);
  setStatus("Awaiting PDF upload", "Idle", 0);
  exportHint.textContent = "Analyze a PDF to enable export";
  exportButtons.forEach((button) => { button.disabled = true; });
  setBusy(false);
  if (logReset) log("State reset. Ready for another document.");
}

function enableExports() {
  exportButtons.forEach((button) => { button.disabled = false; });
  exportHint.textContent = "Exports enabled";
}

async function setFile(file) {
  if (state.busy) return;
  if (!isPdfFile(file)) {
    setStatus("Please upload a valid PDF.", "Invalid file", 0);
    log("Rejected file because it is not a PDF.", "error");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus("PDF is larger than the 100 MB browser limit.", "File too large", 0);
    log(`Rejected ${file.name}: ${formatBytes(file.size)} exceeds the 100 MB safety limit.`, "error");
    return;
  }
  if (!file.size) {
    setStatus("The selected PDF is empty.", "Invalid file", 0);
    log("Rejected empty PDF file.", "error");
    return;
  }

  try {
    state.file = file;
    state.originalName = file.name || "document.pdf";
    state.fileBuffer = await file.arrayBuffer();
    state.parsed = null;
    fileMeta.textContent = `${state.originalName} · ${formatBytes(file.size)}`;
    exportButtons.forEach((button) => { button.disabled = true; });
    previewText.textContent = "File loaded. Select Analyze and convert to extract content.";
    previewTables.textContent = "";
    previewSummary.textContent = "";
    setMetricValues(null);
    setStatus("PDF ready for analysis", "Ready", 0);
    setBusy(false);
    log(`Loaded ${state.originalName} (${formatBytes(file.size)}).`, "success");
  } catch (error) {
    console.error(error);
    state.file = null;
    state.fileBuffer = null;
    setBusy(false);
    setStatus("The PDF could not be read.", "Read error", 0);
    log(`Could not read PDF: ${error?.message || error}`, "error");
  }
}

function setPreviewTab(tab) {
  state.previewTab = tab;
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  previewText.classList.toggle("hidden", tab !== "text");
  previewTables.classList.toggle("hidden", tab !== "tables");
  previewSummary.classList.toggle("hidden", tab !== "summary");
}

tabButtons.forEach((button) => button.addEventListener("click", () => setPreviewTab(button.dataset.tab)));

function chooseByX(items, tolerance = 22) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const centers = [];
  sorted.forEach((item) => {
    const match = centers.find((center) => Math.abs(center.value - item.x) <= tolerance);
    if (match) {
      match.points.push(item.x);
      match.value = match.points.reduce((sum, point) => sum + point, 0) / match.points.length;
    } else {
      centers.push({ value: item.x, points: [item.x] });
    }
  });
  return centers.map((center) => center.value).sort((a, b) => a - b);
}

function normalizeCell(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function groupTextRows(items, tolerance = 4) {
  const rows = [];
  const ordered = [...items]
    .filter((item) => String(item.str || "").trim())
    .map((item) => ({
      str: String(item.str || "").trim(),
      x: Math.round(item.transform?.[4] || 0),
      y: Math.round(item.transform?.[5] || 0),
      width: Number(item.width || 0),
      height: Number(item.height || 0)
    }))
    .sort((a, b) => Math.abs(a.y - b.y) <= tolerance ? a.x - b.x : b.y - a.y);

  ordered.forEach((item) => {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) {
      row.items.push(item);
      row.y = (row.y + item.y) / 2;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  });

  rows.forEach((row) => row.items.sort((a, b) => a.x - b.x));
  return rows;
}

function linesFromRows(rows) {
  return rows
    .map((row) => row.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function inferTablesFromRows(rows, options = {}) {
  if (!rows.length) return [];
  const mergeSparse = Boolean(options.mergeSparseRows);
  const candidates = [];
  let current = [];

  const flush = () => {
    if (current.length >= 3) candidates.push(current);
    current = [];
  };

  rows.forEach((row) => {
    const xPositions = chooseByX(row.items);
    if (row.items.length >= 2 && xPositions.length >= 2) current.push({ ...row, xPositions });
    else flush();
  });
  flush();

  const tables = [];
  candidates.forEach((candidateRows, index) => {
    const columns = chooseByX(candidateRows.flatMap((row) => row.items), 26);
    if (columns.length < 2) return;

    let matrix = candidateRows.map((row) => {
      const cells = Array.from({ length: columns.length }, () => []);
      row.items.forEach((item) => {
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        columns.forEach((columnX, columnIndex) => {
          const distance = Math.abs(columnX - item.x);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = columnIndex;
          }
        });
        cells[bestIndex].push(item.str);
      });
      return cells.map((cell) => normalizeCell(cell.join(" ")));
    }).filter((row) => row.some(Boolean));

    if (mergeSparse && matrix.length > 1) {
      matrix = matrix.map((row) => row.map((cell) => normalizeCell(cell)));
    }

    if (matrix.length < 2) return;
    const nonEmptyCounts = matrix.map((row) => row.filter(Boolean).length);
    const averageNonEmpty = nonEmptyCounts.reduce((sum, count) => sum + count, 0) / Math.max(nonEmptyCounts.length, 1);
    if (averageNonEmpty < 2) return;

    const headers = matrix[0].map((cell, columnIndex) => cell || `Column ${columnIndex + 1}`);
    const bodyRows = matrix.slice(1).filter((row) => row.some(Boolean));
    if (!bodyRows.length) return;

    tables.push({
      id: `table-${index + 1}`,
      title: `Detected Table ${index + 1}`,
      columnCount: headers.length,
      rowCount: bodyRows.length,
      headers,
      rows: bodyRows,
      confidence: Math.max(.4, Math.min(.98, averageNonEmpty / Math.max(headers.length, 1)))
    });
  });

  return tables;
}

async function renderPageToCanvas(page, scale = 2) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas rendering is not supported by this browser.");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

async function loadOcrLibrary() {
  if (state.ocrLibraryLoaded && state.Tesseract) return state.Tesseract;
  setStatus("Loading OCR engine…", "Initializing OCR", 5);
  log("Loading the OCR runtime.");

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-ocr="true"]');
    if (existing && window.Tesseract) return resolve();
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("OCR library failed to load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.dataset.ocr = "true";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("OCR library failed to load.")), { once: true });
    document.head.appendChild(script);
  });

  if (!window.Tesseract) throw new Error("OCR runtime loaded without exposing Tesseract.");
  state.ocrLibraryLoaded = true;
  state.Tesseract = window.Tesseract;
  log("OCR engine loaded successfully.", "success");
  return state.Tesseract;
}

async function textFromOcr(canvas, pageNumber, totalPages) {
  const Tesseract = await loadOcrLibrary();
  const dataUrl = canvas.toDataURL("image/png");
  const result = await Tesseract.recognize(dataUrl, "eng", {
    logger: (event) => {
      if (!event?.status) return;
      const percent = typeof event.progress === "number" ? Math.round(event.progress * 100) : 0;
      const globalProgress = Math.round((((pageNumber - 1) + percent / 100) / totalPages) * 100);
      setStatus(`OCR processing page ${pageNumber}…`, `${event.status} · ${percent}%`, globalProgress);
    }
  });

  const lines = String(result?.data?.text || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return {
    text: lines.join("\n"),
    lines,
    confidence: Number(result?.data?.confidence || 0) / 100,
    dataUrl
  };
}

function shouldUseOcr(rows, preference, minWords) {
  if (preference === "always") return true;
  if (preference === "never") return false;
  const words = linesFromRows(rows).join(" ").split(/\s+/).filter(Boolean).length;
  return words < minWords;
}

function updateSummaryPreview() {
  if (!state.parsed) {
    previewSummary.textContent = "No summary available yet.";
    return;
  }
  const parsed = state.parsed;
  const lines = [
    `Source file: ${parsed.sourceFile}`,
    `Pages: ${parsed.pageCount}`,
    `Characters: ${parsed.characterCount}`,
    `Detected tables: ${parsed.tableCount}`,
    `OCR pages: ${parsed.ocrPageCount}`,
    `Extracted at: ${new Date(parsed.extractedAt).toLocaleString("en-ZA")}`,
    "",
    "Per-page summary:"
  ];
  parsed.pages.forEach((page) => {
    lines.push(`- Page ${page.pageNumber}: source=${page.source}, lines=${page.lines.length}, tables=${page.tables.length}, confidence=${Math.round((page.confidence || 0) * 100)}%`);
  });
  previewSummary.textContent = lines.join("\n");
}

function updateTablePreview() {
  if (!state.parsed) {
    previewTables.textContent = "No tables available yet.";
    return;
  }
  const allTables = state.parsed.pages.flatMap((page) => page.tables.map((table) => ({ pageNumber: page.pageNumber, ...table })));
  if (!allTables.length) {
    previewTables.textContent = "No tables were detected in this document. OCR pages currently export as text rather than inferred tables.";
    return;
  }

  previewTables.innerHTML = allTables.map((table) => {
    const headerHtml = table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
    const rowsHtml = table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
    return `<section class="converter-table-section"><p class="converter-table-caption">Page ${table.pageNumber} · ${escapeHtml(table.title)} · ${table.rowCount} rows · ${table.columnCount} columns · ${Math.round((table.confidence || 0) * 100)}% confidence</p><div class="converter-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div></section>`;
  }).join("");
}

function updateTextPreview() {
  if (!state.parsed) {
    previewText.textContent = "Upload a PDF to generate a preview.";
    return;
  }
  const text = state.parsed.text || "No text extracted.";
  previewText.textContent = text.length > PREVIEW_CHAR_LIMIT ? `${text.slice(0, PREVIEW_CHAR_LIMIT)}\n\n[Preview truncated. Exports contain the complete extracted text.]` : text;
}

async function buildParsedObject() {
  const pdfBytes = new Uint8Array(state.fileBuffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;
  const parsedPages = [];
  const minWords = Number(minWordsForTextLayer.value) || 24;
  const groupingTolerance = Number(lineTolerance.value) || 4;
  const ocrPreference = ocrMode.value;
  const renderScale = Number(ocrScale.value) || 2;
  const shouldDetectTables = detectTables.checked;
  const attachPageImages = includePageImages.checked;
  const sparseRowMerge = mergeSparseRows.checked;

  log(`Starting document analysis for ${pdf.numPages} page(s).`);
  setStatus("Analyzing PDF structure…", `0 / ${pdf.numPages} pages`, 4);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = groupTextRows(content.items, groupingTolerance);
    const embeddedLines = linesFromRows(rows);
    const useOcr = shouldUseOcr(rows, ocrPreference, minWords);
    let pageText = embeddedLines.join("\n");
    let confidence = embeddedLines.length ? .96 : .75;
    let source = "embedded-text";
    let imageData = null;

    setStatus(`Processing page ${pageNumber} of ${pdf.numPages}…`, useOcr ? "OCR candidate" : "Reading text layer", Math.round((pageNumber - 1) / pdf.numPages * 100));
    log(`Page ${pageNumber}: embedded rows=${rows.length}, OCR=${useOcr ? "yes" : "no"}.`);

    if (useOcr) {
      const canvas = await renderPageToCanvas(page, renderScale);
      const ocrResult = await textFromOcr(canvas, pageNumber, pdf.numPages);
      pageText = ocrResult.text;
      confidence = ocrResult.confidence;
      source = "ocr";
      if (attachPageImages) imageData = ocrResult.dataUrl;
      canvas.width = 1;
      canvas.height = 1;
    }

    const lines = pageText.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const tables = shouldDetectTables && source !== "ocr" ? inferTablesFromRows(rows, { mergeSparseRows: sparseRowMerge }) : [];

    parsedPages.push({
      pageNumber,
      source,
      confidence,
      lines,
      text: lines.join("\n"),
      tables,
      pageImageDataUrl: imageData,
      stats: {
        embeddedRows: rows.length,
        embeddedTokens: embeddedLines.join(" ").split(/\s+/).filter(Boolean).length
      }
    });

    if (typeof page.cleanup === "function") page.cleanup();
    setStatus(`Completed page ${pageNumber} of ${pdf.numPages}`, `${Math.round(pageNumber / pdf.numPages * 100)}%`, Math.round(pageNumber / pdf.numPages * 100));
  }

  if (typeof pdf.cleanup === "function") pdf.cleanup();
  const text = parsedPages.map((page) => `--- Page ${page.pageNumber} (${page.source}) ---\n${page.text}`).join("\n\n");
  const allTables = parsedPages.flatMap((page) => page.tables.map((table) => ({ pageNumber: page.pageNumber, ...table })));
  return {
    sourceFile: state.originalName,
    pageCount: parsedPages.length,
    extractedAt: new Date().toISOString(),
    ocrMode: ocrPreference,
    pages: parsedPages,
    tableCount: allTables.length,
    ocrPageCount: parsedPages.filter((page) => page.source === "ocr").length,
    characterCount: text.length,
    text,
    tables: allTables
  };
}

function exportTxt() {
  downloadBlob(new Blob([state.parsed.text], { type: "text/plain;charset=utf-8" }), `${baseName()}.txt`);
}

function exportJson() {
  downloadBlob(new Blob([JSON.stringify(state.parsed, null, 2)], { type: "application/json;charset=utf-8" }), `${baseName()}.json`);
}

function exportXml() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<document sourceFile="${xmlEscape(state.parsed.sourceFile)}" pageCount="${state.parsed.pageCount}" tableCount="${state.parsed.tableCount}" ocrPageCount="${state.parsed.ocrPageCount}" extractedAt="${xmlEscape(state.parsed.extractedAt)}">\n${state.parsed.pages.map((page) => `  <page number="${page.pageNumber}" source="${xmlEscape(page.source)}" confidence="${Math.round((page.confidence || 0) * 100)}">\n    <text>${xmlEscape(page.text)}</text>\n    <lines>\n${page.lines.map((line) => `      <line>${xmlEscape(line)}</line>`).join("\n")}\n    </lines>\n    <tables>\n${page.tables.map((table) => `      <table id="${xmlEscape(table.id)}" title="${xmlEscape(table.title)}" rowCount="${table.rowCount}" columnCount="${table.columnCount}" confidence="${Math.round((table.confidence || 0) * 100)}">\n        <headers>\n${table.headers.map((header) => `          <header>${xmlEscape(header)}</header>`).join("\n")}\n        </headers>\n        <rows>\n${table.rows.map((row) => `          <row>${row.map((cell) => `<cell>${xmlEscape(cell)}</cell>`).join("")}</row>`).join("\n")}\n        </rows>\n      </table>`).join("\n")}\n    </tables>\n  </page>`).join("\n")}\n</document>`;
  downloadBlob(new Blob([xml], { type: "application/xml;charset=utf-8" }), `${baseName()}.xml`);
}

function exportCsv() {
  const rows = [];
  if (state.parsed.tables.length) {
    const maxColumns = Math.max(...state.parsed.tables.map((table) => table.headers.length), 1);
    rows.push(["page_number", "table_id", "table_title", "row_index", ...Array.from({ length: maxColumns }, (_, index) => `column_${index + 1}`)]);
    state.parsed.tables.forEach((table) => {
      table.rows.forEach((row, rowIndex) => rows.push([table.pageNumber, table.id, table.title, rowIndex + 1, ...row]));
    });
  } else {
    rows.push(["page_number", "line_number", "source", "line_text"]);
    state.parsed.pages.forEach((page) => page.lines.forEach((line, index) => rows.push([page.pageNumber, index + 1, page.source, line])));
  }
  const csv = rows.map((row) => row.map((cell) => `"${safeSpreadsheetCell(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `${baseName()}.csv`);
}

function requireXlsx() {
  if (!window.XLSX?.utils) throw new Error("Excel export library is unavailable. Check your connection and retry.");
  return window.XLSX;
}

function exportXlsx() {
  const XLSX = requireXlsx();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    source_file: safeSpreadsheetCell(state.parsed.sourceFile),
    pages: state.parsed.pageCount,
    characters: state.parsed.characterCount,
    tables: state.parsed.tableCount,
    ocr_pages: state.parsed.ocrPageCount,
    extracted_at: state.parsed.extractedAt,
    ocr_mode: state.parsed.ocrMode
  }]), "Summary");

  const pageRows = state.parsed.pages.map((page) => ({
    page_number: page.pageNumber,
    source: page.source,
    confidence: Math.round((page.confidence || 0) * 100),
    line_count: page.lines.length,
    table_count: page.tables.length,
    text: safeSpreadsheetCell(page.text)
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pageRows), "Pages");

  const lineRows = state.parsed.pages.flatMap((page) => page.lines.map((line, index) => ({
    page_number: page.pageNumber,
    source: page.source,
    line_number: index + 1,
    line_text: safeSpreadsheetCell(line)
  })));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lineRows), "Lines");

  state.parsed.tables.forEach((table, index) => {
    const aoa = [
      table.headers.map(safeSpreadsheetCell),
      ...table.rows.map((row) => row.map(safeSpreadsheetCell))
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), `Table${index + 1}`.slice(0, 31));
  });

  XLSX.writeFile(workbook, `${baseName()}.xlsx`, { compression: true });
}

function requireDocx() {
  if (!window.docx?.Document || !window.docx?.Packer) throw new Error("Word export library is unavailable. Check your connection and retry.");
  return window.docx;
}

async function exportDocx() {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } = requireDocx();
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(`Converted from ${state.parsed.sourceFile}`)] }),
    new Paragraph({ text: `Pages: ${state.parsed.pageCount}` }),
    new Paragraph({ text: `Detected tables: ${state.parsed.tableCount}` }),
    new Paragraph({ text: `OCR pages: ${state.parsed.ocrPageCount}` }),
    new Paragraph({ text: `Extracted at: ${new Date(state.parsed.extractedAt).toLocaleString("en-ZA")}` })
  ];

  state.parsed.pages.forEach((page) => {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: `Page ${page.pageNumber} (${page.source})` }));
    children.push(new Paragraph({ text: `Confidence: ${Math.round((page.confidence || 0) * 100)}%` }));
    page.lines.forEach((line) => children.push(new Paragraph({ text: line })));
    page.tables.forEach((table) => {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: table.title }));
      const rows = [
        new TableRow({ children: table.headers.map((header) => new TableCell({ children: [new Paragraph({ text: header || "Column" })] })) }),
        ...table.rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph({ text: cell || "" })] })) }))
      ];
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    });
  });

  const documentFile = new Document({ sections: [{ children }] });
  downloadBlob(await Packer.toBlob(documentFile), `${baseName()}.docx`);
}

function exportPdf() {
  if (state.file) downloadBlob(state.file, state.originalName);
}

async function runAnalysis() {
  if (!state.fileBuffer || state.busy) return;
  setBusy(true);
  exportHint.textContent = "Analysis in progress";
  setStatus("Starting analysis…", "Preparing", 2);
  log("Beginning analysis pipeline.");

  try {
    state.parsed = await buildParsedObject();
    updateTextPreview();
    updateTablePreview();
    updateSummaryPreview();
    setMetricValues(state.parsed);
    setStatus("Analysis completed successfully", `${state.parsed.pageCount} page(s) processed`, 100);
    enableExports();
    setPreviewTab("text");
    log(`Analysis complete. Pages=${state.parsed.pageCount}, tables=${state.parsed.tableCount}, OCR pages=${state.parsed.ocrPageCount}.`, "success");
  } catch (error) {
    console.error(error);
    state.parsed = null;
    setStatus("Analysis failed", error?.message || "Unknown error", 0);
    previewText.textContent = "The document could not be parsed. It may be encrypted, malformed, unsupported or too large for the current browser session.";
    previewTables.textContent = "";
    previewSummary.textContent = "";
    exportHint.textContent = "Analysis failed";
    log(`Analysis failed: ${error?.message || error}`, "error");
  } finally {
    setBusy(false);
    if (state.parsed) enableExports();
  }
}

exportButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const format = button.dataset.format;
    if (!state.parsed && format !== "pdf") return;
    if (!state.file && format === "pdf") return;
    try {
      log(`Export requested: ${String(format).toUpperCase()}.`);
      if (format === "pdf") exportPdf();
      else if (format === "docx") await exportDocx();
      else if (format === "xlsx") exportXlsx();
      else if (format === "csv") exportCsv();
      else if (format === "txt") exportTxt();
      else if (format === "json") exportJson();
      else if (format === "xml") exportXml();
      log(`${String(format).toUpperCase()} export completed.`, "success");
    } catch (error) {
      console.error(error);
      setStatus(`Export failed for ${String(format).toUpperCase()}`, error?.message || "Export error");
      log(`Export failed for ${String(format).toUpperCase()}: ${error?.message || error}`, "error");
    }
  });
});

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (file) await setFile(file);
});

dropzone.addEventListener("click", () => {
  if (!state.busy) fileInput.click();
});
dropzone.addEventListener("keydown", (event) => {
  if (!state.busy && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    fileInput.click();
  }
});
["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.busy) dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  });
});
dropzone.addEventListener("drop", async (event) => {
  if (state.busy) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) await setFile(file);
});

analyzeBtn.addEventListener("click", runAnalysis);
resetBtn.addEventListener("click", () => resetState());
notesBtn.addEventListener("click", () => $("conversion-notes").scrollIntoView({ behavior: "smooth", block: "start" }));
clearLogBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  logBody.textContent = "";
  log("Log cleared.");
});
ocrMode.addEventListener("change", () => {
  ocrModeBadge.textContent = ocrMode.value === "always" ? "Always" : ocrMode.value === "never" ? "Never" : "Auto";
});

resetState({ logReset: false });
setPreviewTab("text");
log("System ready. Upload a PDF to begin.");
