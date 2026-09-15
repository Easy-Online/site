/* Universal EasyFile -> Easy Edit document handoff. */
(function (global) {
  "use strict";

  const currentFile = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (currentFile === "easy-edit.html" || currentFile === "index.html") return;

  const BUTTON_ID = "easyfileBtnEdit";

  function toast(message, error = false) {
    const old = document.querySelector(".easyfile-edit-handoff-toast");
    old?.remove();
    const el = document.createElement("div");
    el.className = "easyfile-edit-handoff-toast";
    el.textContent = message;
    el.setAttribute("role", error ? "alert" : "status");
    el.style.cssText = `position:fixed;right:16px;bottom:16px;z-index:10000;max-width:380px;padding:12px 14px;border-radius:12px;color:#fff;background:${error ? "#b91c1c" : "#0f172a"};box-shadow:0 14px 35px rgba(2,6,23,.28);font-weight:700;font-size:.85rem`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function loadBus() {
    if (global.EasyFileDocumentBus) return Promise.resolve(global.EasyFileDocumentBus);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src$="assets/js/easyfile-document-bus.js"]');
      const script = existing || document.createElement("script");
      const done = () => global.EasyFileDocumentBus ? resolve(global.EasyFileDocumentBus) : reject(new Error("EasyFile document bus did not initialise."));
      if (existing) { existing.addEventListener("load", done, { once: true }); setTimeout(done, 0); return; }
      script.src = "assets/js/easyfile-document-bus.js";
      script.addEventListener("load", done, { once: true });
      script.addEventListener("error", () => reject(new Error("Could not load the EasyFile document bus.")), { once: true });
      document.head.appendChild(script);
    });
  }

  function controlValue(control) {
    if (control.type === "file") return null;
    if (control.tagName === "SELECT") return control.options[control.selectedIndex]?.textContent || control.value;
    if (control.type === "checkbox" || control.type === "radio") return control.checked ? "Yes" : "No";
    return control.value;
  }

  function editableClone() {
    const source = document.querySelector("#printArea, .print-container, #previewCard, main") || document.body;
    const clone = source.cloneNode(true);
    clone.querySelectorAll("script, .no-print, #easyfileModuleActions, [data-easyfile-policy-links]").forEach((node) => node.remove());
    const originalControls = source.querySelectorAll("input,select,textarea,[contenteditable='true']");
    const cloneControls = clone.querySelectorAll("input,select,textarea,[contenteditable='true']");
    cloneControls.forEach((control, index) => {
      const original = originalControls[index];
      if (!original || original.type === "file") { control.remove(); return; }
      const replacement = document.createElement(control.tagName === "TEXTAREA" ? "div" : "span");
      const value = original.isContentEditable ? original.textContent : controlValue(original);
      replacement.textContent = value || "";
      replacement.style.whiteSpace = "pre-wrap";
      replacement.dataset.easyfileField = original.id || original.name || `field-${index + 1}`;
      control.replaceWith(replacement);
    });
    return clone;
  }

  function stylesheetMarkup() {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
      .map((link) => `<link rel="stylesheet" href="${new URL(link.getAttribute("href"), location.href).href}">`)
      .join("\n");
  }

  function inlineStyles() {
    return Array.from(document.querySelectorAll("head style")).map((style) => style.outerHTML).join("\n");
  }

  function buildDocumentHtml() {
    const clone = editableClone();
    return `<!doctype html>\n<html lang="en-ZA">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${document.title.replace(/[<>]/g, "")}</title>\n<base href="${location.href}">\n${stylesheetMarkup()}\n${inlineStyles()}\n<style>body{padding:24px}.easyfile-edit-source-banner{font:700 12px/1.4 system-ui,sans-serif;color:#475569;margin:0 0 16px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc}</style>\n</head>\n<body>\n<div class="easyfile-edit-source-banner">Editable copy from ${currentFile}. Changes in Easy Edit do not alter the source record until you export or hand it back.</div>\n${clone.outerHTML}\n</body>\n</html>`;
  }

  async function sendToEasyEdit() {
    try {
      const bus = await loadBus();
      const html = buildDocumentHtml();
      const target = await bus.handoff({
        name: `${currentFile.replace(/\.html$/i, "")}-${new Date().toISOString().slice(0, 10)}.html`,
        mimeType: "text/html",
        extension: "html",
        sourceModule: currentFile.replace(/\.html$/i, ""),
        data: html,
        metadata: { sourceUrl: location.href, sourceTitle: document.title, handoffVersion: 1 }
      });
      location.href = target;
    } catch (error) {
      console.error(error);
      toast(error.message || "Could not open this document in Easy Edit.", true);
    }
  }

  function createButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const toolbar = document.getElementById("easyfileModuleActions");
    const group = toolbar?.querySelector(".easyfile-action-group") || toolbar?.querySelector(".easyfile-action-row");
    if (!group) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "easyfile-action-button easyfile-action-secondary bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-lg";
    button.innerHTML = '<i class="fa-solid fa-pen-ruler text-blue-600" aria-hidden="true"></i><span>Edit in Easy Edit</span>';
    button.addEventListener("click", sendToEasyEdit);
    group.appendChild(button);
  }

  function mount() {
    createButton();
    if (document.getElementById(BUTTON_ID)) return;
    const observer = new MutationObserver(() => {
      createButton();
      if (document.getElementById(BUTTON_ID)) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }

  global.EasyFileEditHandoff = Object.freeze({ send: sendToEasyEdit, buildDocumentHtml });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})(window);
