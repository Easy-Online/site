/* Privacy-preserving, device-local activation instrumentation. No data is transmitted. */
(function () {
  "use strict";

  const STORAGE_KEY = "easyfile:product-events:v1";
  const MAX_EVENTS = 200;
  const ALLOWED_EVENTS = new Set([
    "converter_viewed",
    "sample_loaded",
    "statement_selected",
    "conversion_started",
    "conversion_completed",
    "export_completed"
  ]);

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function record(name, properties = {}) {
    if (!ALLOWED_EVENTS.has(name)) return;
    const safe = {};
    if (typeof properties.exportType === "string") safe.exportType = properties.exportType.slice(0, 12);
    if (typeof properties.source === "string") safe.source = properties.source.slice(0, 12);
    const events = read();
    events.push({ name, at: new Date().toISOString(), properties: safe });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
    } catch {}
  }

  function bind() {
    if (!document.body.classList.contains("bank-converter-page")) return;
    record("converter_viewed");

    document.getElementById("sampleButton")?.addEventListener("click", () => record("sample_loaded"));
    document.getElementById("pdfFile")?.addEventListener("change", (event) => {
      if (event.currentTarget.files?.length) record("statement_selected", { source: "pdf" });
    });
    document.getElementById("convertButton")?.addEventListener("click", () => record("conversion_started"));

    const results = document.getElementById("resultSection");
    if (results) {
      let recorded = !results.hidden;
      new MutationObserver(() => {
        if (!results.hidden && !recorded) {
          recorded = true;
          record("conversion_completed");
        }
        if (results.hidden) recorded = false;
      }).observe(results, { attributes: true, attributeFilter: ["hidden"] });
    }

    [
      ["exportCsvButton", "csv"],
      ["exportExcelButton", "excel"],
      ["exportAuditButton", "audit"]
    ].forEach(([id, exportType]) => {
      document.getElementById(id)?.addEventListener("click", () => record("export_completed", { exportType }));
    });
  }

  window.EasyFileProductAnalytics = Object.freeze({
    snapshot: () => read().map((event) => ({ ...event, properties: { ...event.properties } })),
    clear: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
