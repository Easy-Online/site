/* EasyFile Company Profile integration for document modules */
(function () {
  "use strict";

  const PROFILE = window.EasyFileCompanyProfile;
  if (!PROFILE) return;

  const current = (location.pathname.split("/").pop() || "").toLowerCase();
  const SUPPORTED = new Set([
    "easy-invoice.html",
    "easy-quote.html",
    "easy-purchase-order.html",
    "easy-receipt.html",
    "easy-sales-order.html",
    "easy-statement.html",
    "easy-job-card.html"
  ]);
  if (!SUPPORTED.has(current)) return;

  const CONFIG = {
    "easy-invoice.html": {
      fields: {
        companyName: "companyName",
        vatNumber: "companyVat",
        registrationNumber: "companyReg",
        website: "companyWeb",
        email: "companyEmail",
        phone: "companyPhone",
        address: "companyAddress"
      },
      anchor: "companyName",
      logoMode: "invoice"
    },
    "easy-purchase-order.html": {
      fields: {
        companyName: "cName",
        address: "cAddress",
        email: "cEmail",
        phone: "cPhone"
      },
      combinedRegVat: "cRegVat",
      anchor: "cName",
      logoMode: "purchase-order"
    },
    "easy-job-card.html": {
      fields: {
        companyName: "companyName",
        vatNumber: "companyVat",
        registrationNumber: "companyReg",
        email: "companyEmail",
        phone: "companyPhone",
        website: "companyWebsite",
        address: "companyAddress"
      },
      anchor: "companyName",
      logoMode: "lexical"
    },
    "easy-statement.html": {
      fields: {
        companyName: "companyName",
        vatNumber: "companyVat",
        registrationNumber: "companyReg",
        email: "companyEmail",
        phone: "companyPhone",
        website: "companyWebsite",
        address: "companyAddress"
      },
      anchor: "companyName",
      logoMode: "lexical"
    },
    "easy-quote.html": { brandedHeader: true, target: ".print-container", logoMode: "quote" },
    "easy-receipt.html": { brandedHeader: true, target: "main .bg-white", logoMode: "none" },
    "easy-sales-order.html": { brandedHeader: true, target: ".print-container", logoMode: "none" }
  };

  const config = CONFIG[current];
  if (!config) return;

  function el(id) { return document.getElementById(id); }
  function text(value) { return String(value || "").trim(); }
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }
  function displayName(profile) {
    return text(profile.tradingName) || text(profile.companyName) || "Your Company";
  }
  function hasValue(node) {
    return Boolean(node && text(node.value));
  }
  function setField(id, value, overwrite) {
    const node = el(id);
    if (!node || value == null || value === "") return false;
    if (!overwrite && hasValue(node)) return false;
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function regVat(profile) {
    const parts = [];
    if (text(profile.registrationNumber)) parts.push(`Reg: ${text(profile.registrationNumber)}`);
    if (text(profile.vatNumber)) parts.push(`VAT: ${text(profile.vatNumber)}`);
    return parts.join(" • ");
  }

  function applyFields(profile, overwrite) {
    if (!config.fields) return 0;
    let changed = 0;
    Object.entries(config.fields).forEach(([profileKey, fieldId]) => {
      let value = profile[profileKey];
      if (profileKey === "companyName") value = displayName(profile);
      if (setField(fieldId, value, overwrite)) changed += 1;
    });
    if (config.combinedRegVat && setField(config.combinedRegVat, regVat(profile), overwrite)) changed += 1;
    return changed;
  }

  function setImage(node, src) {
    if (!node) return;
    if (src) {
      node.src = src;
      node.classList.remove("hidden");
    } else {
      node.removeAttribute("src");
    }
  }

  function applyLogo(profile, overwrite) {
    if (!profile.logo) return;
    try {
      if (config.logoMode === "invoice") {
        if (overwrite || !window.__companyLogoDataUrl) window.__companyLogoDataUrl = profile.logo;
        const hint = el("logoHint");
        if (hint) hint.textContent = "Using logo from Easy Company Profile";
      } else if (config.logoMode === "purchase-order") {
        if (typeof state !== "undefined" && state && state.company) {
          if (overwrite || !state.company.logoDataUrl) state.company.logoDataUrl = profile.logo;
          if (typeof renderLogo === "function") renderLogo();
        } else {
          setImage(el("logoPreview"), profile.logo);
        }
      } else if (config.logoMode === "lexical") {
        try {
          if (overwrite || !companyLogoDataUrl) companyLogoDataUrl = profile.logo;
        } catch (_) {}
        const preview = el("companyLogoPreview");
        if (preview && (overwrite || !preview.querySelector("img"))) {
          preview.innerHTML = `<img src="${profile.logo}" alt="Company logo" style="max-height:3.5rem;max-width:100%;object-fit:contain">`;
        }
      } else if (config.logoMode === "quote") {
        const image = el("companyLogo");
        if (image && (overwrite || !image.getAttribute("src"))) image.src = profile.logo;
      }
    } catch (error) {
      console.warn("EasyFile could not apply the shared company logo to this module.", error);
    }
  }

  function profileHeaderMarkup(profile) {
    const contacts = [text(profile.phone), text(profile.email), text(profile.website)].filter(Boolean).map(escapeHtml).join(" · ");
    const legal = [
      text(profile.registrationNumber) ? `Reg: ${escapeHtml(profile.registrationNumber)}` : "",
      text(profile.vatNumber) ? `VAT: ${escapeHtml(profile.vatNumber)}` : ""
    ].filter(Boolean).join(" · ");
    return `
      <section class="easyfile-profile-print-header" data-easyfile-profile-header style="border-top:4px solid ${escapeHtml(profile.brandColour || "#2563eb")};padding:1rem 0 1.15rem;margin-bottom:1.35rem;border-bottom:1px solid #e5e7eb;color:#111827">
        <div style="display:flex;justify-content:space-between;gap:1.25rem;align-items:flex-start">
          <div style="display:flex;gap:1rem;align-items:flex-start;min-width:0">
            ${profile.logo ? `<img src="${profile.logo}" alt="Company logo" style="max-width:150px;max-height:64px;object-fit:contain;flex:0 0 auto">` : ""}
            <div style="min-width:0">
              <div style="font-size:1.15rem;font-weight:900;line-height:1.15">${escapeHtml(displayName(profile))}</div>
              ${text(profile.slogan) ? `<div style="font-size:.78rem;color:#64748b;margin-top:.2rem">${escapeHtml(profile.slogan)}</div>` : ""}
              ${text(profile.address) ? `<div style="font-size:.75rem;color:#475569;margin-top:.45rem;white-space:pre-line">${escapeHtml(profile.address)}</div>` : ""}
            </div>
          </div>
          <div style="text-align:right;font-size:.72rem;line-height:1.55;color:#475569;max-width:45%">
            ${contacts ? `<div>${contacts}</div>` : ""}
            ${legal ? `<div>${legal}</div>` : ""}
          </div>
        </div>
      </section>`;
  }

  function ensureBrandedHeader(profile) {
    if (!config.brandedHeader) return;
    const target = document.querySelector(config.target);
    if (!target) return;
    let header = target.querySelector(":scope > [data-easyfile-profile-header]");
    if (!header) {
      const wrap = document.createElement("div");
      wrap.innerHTML = profileHeaderMarkup(profile).trim();
      header = wrap.firstElementChild;
      target.insertBefore(header, target.firstChild);
    } else {
      const wrap = document.createElement("div");
      wrap.innerHTML = profileHeaderMarkup(profile).trim();
      header.replaceWith(wrap.firstElementChild);
    }
    if (current === "easy-quote.html") applyLogo(profile, false);
  }

  function collectModuleCompany(profile) {
    const next = { ...profile };
    if (!config.fields) return next;
    Object.entries(config.fields).forEach(([profileKey, fieldId]) => {
      const node = el(fieldId);
      if (!node) return;
      const value = text(node.value);
      if (!value) return;
      if (profileKey === "companyName") next.companyName = value;
      else next[profileKey] = value;
    });
    return next;
  }

  function profileToolbarAnchor() {
    if (config.anchor) {
      const field = el(config.anchor);
      const card = field?.closest("section, .card, .bg-white");
      const heading = card?.querySelector("h2");
      if (heading) return heading.parentElement || heading;
    }
    return document.querySelector("main > header") || document.querySelector("main h1")?.parentElement || document.querySelector("main");
  }

  function addProfileToolbar() {
    if (document.querySelector("[data-easyfile-profile-toolbar]")) return;
    const anchor = profileToolbarAnchor();
    if (!anchor) return;

    const bar = document.createElement("div");
    bar.dataset.easyfileProfileToolbar = "";
    bar.className = "no-print";
    bar.style.cssText = "display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin:.65rem 0 1rem;padding:.65rem .75rem;border:1px solid #dbe3ef;border-radius:.75rem;background:rgba(239,246,255,.9);color:#1e3a8a;font-size:.78rem";
    bar.innerHTML = `
      <strong style="margin-right:auto"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i> Shared Company Profile</strong>
      <span data-profile-status style="font-weight:700"></span>
      <button type="button" data-profile-use style="border:1px solid #bfdbfe;background:#fff;color:#1d4ed8;border-radius:.55rem;padding:.4rem .58rem;font-weight:900">Use profile</button>
      ${config.fields ? '<button type="button" data-profile-save style="border:1px solid #bfdbfe;background:#fff;color:#1d4ed8;border-radius:.55rem;padding:.4rem .58rem;font-weight:900">Save sender as profile</button>' : ""}
      <a href="easy-company-profile.html" style="border:1px solid #bfdbfe;background:#fff;color:#1d4ed8;border-radius:.55rem;padding:.4rem .58rem;font-weight:900;text-decoration:none">Manage profile</a>`;

    if (anchor.matches?.("h1,h2")) anchor.insertAdjacentElement("afterend", bar);
    else anchor.appendChild(bar);

    bar.querySelector("[data-profile-use]")?.addEventListener("click", () => {
      const profile = PROFILE.load();
      applyProfile(profile, true);
      showStatus("Profile applied", false);
    });

    bar.querySelector("[data-profile-save]")?.addEventListener("click", () => {
      const currentProfile = PROFILE.load();
      const saved = PROFILE.save(collectModuleCompany(currentProfile));
      applyProfile(saved, false);
      showStatus("Profile updated", false);
    });
  }

  function showStatus(message, error) {
    const status = document.querySelector("[data-profile-status]");
    if (status) {
      status.textContent = message;
      status.style.color = error ? "#b91c1c" : "#166534";
      clearTimeout(showStatus._timer);
      showStatus._timer = setTimeout(() => { status.textContent = ""; }, 2600);
    }
  }

  function applyProfile(profile, overwrite) {
    if (!profile) return;
    applyFields(profile, overwrite);
    applyLogo(profile, overwrite);
    ensureBrandedHeader(profile);
  }

  function refreshFromStorage() {
    const profile = PROFILE.load();
    if (!PROFILE.hasProfile()) {
      showStatus("No shared profile saved", true);
      return;
    }
    applyProfile(profile, false);
  }

  function boot() {
    addProfileToolbar();
    const profile = PROFILE.load();
    if (PROFILE.hasProfile()) {
      applyProfile(profile, false);
      showStatus("Profile linked", false);
    } else {
      showStatus("Create a company profile", true);
    }

    window.addEventListener(PROFILE.EVENT_NAME, (event) => {
      applyProfile(event.detail?.profile || PROFILE.load(), false);
      showStatus("Profile refreshed", false);
    });
    window.addEventListener("storage", (event) => {
      if (event.key === PROFILE.STORAGE_KEY) refreshFromStorage();
    });

    /* Re-apply after legacy modules restore their own drafts on window load. */
    window.addEventListener("load", () => setTimeout(refreshFromStorage, 50), { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
