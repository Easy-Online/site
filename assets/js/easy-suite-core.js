/* EasyFile shared core */
(function () {
  const BRAND = Object.freeze({
    name: "EasyFile",
    logoOnDark: "logo-w.png",
    logoOnLight: "logo-b.png"
  });

  const navMount = document.getElementById("easyNavMount");
  const headerMount = document.getElementById("easyHeaderMount");

  function deriveModule() {
    if (window.EASY && typeof window.EASY === "object") return window.EASY;

    const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const map = [
      { k: "easy-quote",          badge: "Q",  title: "EasyQUOTE", subtitle: "Quote Generator" },
      { k: "easy-invoice",        badge: "I",  title: "EasyINV",   subtitle: "Invoice Generator" },
      { k: "easy-purchase-order", badge: "PO", title: "EasyPO",    subtitle: "Purchase Order Generator" },
      { k: "easy-sales-order",    badge: "SO", title: "EasySO",    subtitle: "Sales Order Generator" },
      { k: "easy-receipt",        badge: "R",  title: "EasyREC",   subtitle: "Receipt Generator" },
      { k: "easy-statement",      badge: "S",  title: "EasySTAT",  subtitle: "Statement Generator" },
      { k: "easy-job-card",       badge: "JC", title: "EasyJC",    subtitle: "Job Card Manager" },
      { k: "easy-payroll",        badge: "P",  title: "EasyPAY",   subtitle: "Payroll Manager" },
      { k: "easy-inventory",      badge: "IV", title: "EasyINVTR", subtitle: "Inventory Manager" },
      { k: "easy-crm",            badge: "C",  title: "EasyCRM",   subtitle: "CRM Manager" },
      { k: "index",               badge: "EF", title: "EasyFile",  subtitle: "Practical business tools" }
    ];

    for (const module of map) {
      if (file.includes(module.k)) return module;
    }

    return { badge: "EF", title: "EasyFile", subtitle: "Practical business tools" };
  }

  async function injectPartial(mount, url) {
    if (!mount) return;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    mount.innerHTML = await response.text();
  }

  function brandLogoMarkup(variant = "on-dark") {
    const source = variant === "on-light" ? BRAND.logoOnLight : BRAND.logoOnDark;
    return `<img src="${source}" alt="" width="40" height="40" decoding="async" class="h-10 w-10 object-contain" data-easyfile-logo data-logo-variant="${variant}"><span>${BRAND.name}</span>`;
  }

  function replaceIdentityWithLogo(identity, source = BRAND.logoOnLight) {
    if (!identity) return;

    identity.textContent = "";
    identity.classList.remove("bg-blue-600", "text-white", "font-black");

    const image = document.createElement("img");
    image.src = source;
    image.alt = "";
    image.width = 40;
    image.height = 40;
    image.decoding = "async";
    image.className = "h-10 w-10 object-contain";
    image.dataset.easyfileLogo = "";
    image.dataset.logoVariant = "on-light";
    identity.appendChild(image);
  }

  function ensureFavicons() {
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach((link) => link.remove());

    const definitions = [
      { rel: "icon", href: BRAND.logoOnLight, type: "image/png" },
      { rel: "icon", href: BRAND.logoOnLight, type: "image/png", media: "(prefers-color-scheme: light)" },
      { rel: "icon", href: BRAND.logoOnDark, type: "image/png", media: "(prefers-color-scheme: dark)" },
      { rel: "apple-touch-icon", href: BRAND.logoOnLight }
    ];

    definitions.forEach((definition) => {
      const link = document.createElement("link");
      link.rel = definition.rel;
      link.href = definition.href;
      if (definition.type) link.type = definition.type;
      if (definition.media) link.media = definition.media;
      link.dataset.easyfileFavicon = "";
      document.head.appendChild(link);
    });
  }

  function applyBranding() {
    document.querySelectorAll('nav a[href="index.html"], nav a[href="./"], nav a[href="/"]').forEach((anchor) => {
      if (!/easy\s*(suite|file)/i.test(anchor.textContent || "")) return;
      anchor.classList.add("inline-flex", "items-center", "gap-2");
      anchor.setAttribute("aria-label", `${BRAND.name} home`);
      anchor.innerHTML = brandLogoMarkup("on-dark");
    });

    document.querySelectorAll("header h1").forEach((heading) => {
      const headingText = (heading.textContent || "").trim();
      if (!/^easy/i.test(headingText)) return;

      if (/^easy\s*suite$/i.test(headingText)) heading.textContent = BRAND.name;

      const identity = heading.parentElement?.previousElementSibling;
      if (!identity || !identity.matches(".h-10.w-10")) return;
      replaceIdentityWithLogo(identity, BRAND.logoOnLight);
    });

    document.querySelectorAll("img[data-easyfile-logo]").forEach((image) => {
      const inNavigation = Boolean(image.closest("nav"));
      image.src = inNavigation ? BRAND.logoOnDark : BRAND.logoOnLight;
      image.dataset.logoVariant = inNavigation ? "on-dark" : "on-light";
    });
  }

  function isPurchaseOrderPage() {
    return /(?:^|\/)easy-purchase-order\.html$/i.test(location.pathname);
  }

  const PO_ENCODING_REPLACEMENTS = Object.freeze([
    ["â†’", "→"],
    ["â€¢", "•"],
    ["â‚¬", "€"],
    ["Â£", "£"],
    ["â€”", "—"],
    ["â€“", "–"],
    ["â€¦", "…"],
    ["â€™", "’"],
    ["â€˜", "‘"],
    ["â€œ", "“"],
    ["â€", "”"],
    ["Â", ""]
  ]);

  const PO_COPY_REPLACEMENTS = Object.freeze([
    ["Feature-Rich Purchase Order Generator", "Feature-rich Purchase Order Generator"],
    ["1) Company + supplier → 2) Set PO details → 3) Add/import items → 4) Review totals + VAT → 5) Approve + export/print.",
      "1) Enter company and supplier details → 2) Set PO details → 3) Add or import items → 4) Review totals and VAT → 5) Approve, export, or print."],
    ["Fill with demo company info", "Fill with demo company information"],
    ["Fill with demo supplier info", "Fill with demo supplier information"],
    ["Supplier / Vendor name", "Supplier or vendor name"],
    ["VAT...", "VAT number"],
    ["Internal reference / project code", "Internal reference or project code"],
    ["Digital / License", "Digital / Licence"],
    ["Prices are VAT Exclusive", "Prices are VAT-exclusive"],
    ["Prices are VAT Inclusive", "Prices are VAT-inclusive"],
    ["Discount (global)", "Global Discount"],
    ["Applied to subtotal (before VAT)", "Applied to the subtotal before VAT."],
    ["Add products/services. Totals update live. Import/Export available.",
      "Add products or services. Totals update automatically. Import and export are available."],
    ["Recalc", "Recalculate"],
    ["Terms and conditions (PO binding terms, warranty, returns, etc.)",
      "Terms and conditions (purchase-order terms, warranty, returns, etc.)"],
    ["Quick actions to send PO details.", "Quick actions for sending PO details."],
    ["Email Supplier (mailto)", "Email Supplier"],
    ["Keep supplier VAT and your VAT fields accurate if VAT is claimed.",
      "Keep the supplier’s VAT number and your VAT details accurate if VAT is claimed."],
    ["Use “Approved” when PO is locked for audit trail.",
      "Use “Approved” when the PO is final and ready for the audit trail."],
    ["Print/PDF produces a clean document layout.", "Print/PDF output uses a clean document layout."],
    ["Generated by Easy Suite • EasyPO • Offline document generator",
      "Generated by EasyFile • EasyPO • Offline purchase-order generator"],
    ["PO No:", "PO Number:"],
    ["Payment:", "Payment Terms:"],
    ["Tip: Use clear specs (model, qty, term, SKU).",
      "Tip: Use clear specifications (model, quantity, term, and SKU)."],
    ["Delivery hours: Mon—Fri 08:00—16:30.", "Delivery hours: Mon–Fri 08:00–16:30."],
    ["1) This Purchase Order constitutes an offer to purchase the goods/services listed.",
      "1) This Purchase Order constitutes an offer to purchase the goods or services listed."],
    ["2) Supplier must confirm availability, lead time and final pricing in writing.",
      "2) The supplier must confirm availability, lead time, and final pricing in writing."],
    ["3) Prices and VAT treatment must match this PO unless approved in writing.",
      "3) Prices and VAT treatment must match this PO unless a change is approved in writing."],
    ["4) Warranty/returns per supplier standard terms unless otherwise agreed.",
      "4) Warranty and returns are subject to the supplier’s standard terms unless otherwise agreed."],
    ["5) Payment terms as indicated on this PO, subject to correct tax invoice.",
      "5) Payment terms are as indicated on this PO, subject to receipt of a valid tax invoice."],
    ["Template name required.", "A template name is required."],
    ["CSV imported: ", "CSV import complete: "]
  ]);

  function repairPurchaseOrderText(value) {
    if (typeof value !== "string" || !value) return value;

    let repaired = value;
    PO_ENCODING_REPLACEMENTS.forEach(([from, to]) => {
      repaired = repaired.split(from).join(to);
    });
    PO_COPY_REPLACEMENTS.forEach(([from, to]) => {
      repaired = repaired.split(from).join(to);
    });
    return repaired;
  }

  function repairPurchaseOrderNode(root) {
    if (!root) return;

    const repairTextNode = (textNode) => {
      const parentTag = textNode.parentElement?.tagName;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parentTag)) return;
      const current = textNode.nodeValue;
      const repaired = repairPurchaseOrderText(current);
      if (repaired !== current) textNode.nodeValue = repaired;
    };

    if (root.nodeType === Node.TEXT_NODE) {
      repairTextNode(root);
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) repairTextNode(textNode);

    const elementRoot = root.nodeType === Node.ELEMENT_NODE ? root : null;
    const elements = elementRoot ? [elementRoot, ...elementRoot.querySelectorAll("*")] : [...root.querySelectorAll("*")];

    elements.forEach((element) => {
      ["placeholder", "title", "aria-label"].forEach((attribute) => {
        if (!element.hasAttribute?.(attribute)) return;
        const current = element.getAttribute(attribute);
        const repaired = repairPurchaseOrderText(current);
        if (repaired !== current) element.setAttribute(attribute, repaired);
      });

      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.value) {
        const repaired = repairPurchaseOrderText(element.value);
        if (repaired !== element.value) element.value = repaired;
      }
    });
  }

  function installPurchaseOrderObserver() {
    if (!document.body || document.body.dataset.easyfilePoCopyObserver === "on") return;
    document.body.dataset.easyfilePoCopyObserver = "on";

    let repairing = false;
    const observer = new MutationObserver((mutations) => {
      if (repairing) return;
      repairing = true;
      try {
        mutations.forEach((mutation) => {
          if (mutation.type === "characterData") repairPurchaseOrderNode(mutation.target);
          mutation.addedNodes?.forEach((node) => repairPurchaseOrderNode(node));
          if (mutation.type === "attributes") repairPurchaseOrderNode(mutation.target);
        });
      } finally {
        repairing = false;
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"]
    });

    document.addEventListener("click", () => {
      setTimeout(() => repairPurchaseOrderNode(document.body), 0);
    }, true);
  }

  function repairPurchaseOrderClipboard() {
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== "function" || clipboard.__easyfilePoRepairInstalled) return;
      const originalWriteText = clipboard.writeText.bind(clipboard);
      clipboard.writeText = (text) => originalWriteText(repairPurchaseOrderText(String(text ?? "")));
      Object.defineProperty(clipboard, "__easyfilePoRepairInstalled", { value: true });
    } catch (error) {
      console.debug("EasyFile clipboard copy repair unavailable:", error);
    }
  }

  function applyPurchaseOrderPolish() {
    if (!isPurchaseOrderPage()) return;

    const styleId = "easyfile-purchase-order-typography";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        body,
        button,
        input,
        select,
        textarea {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
        }
        body {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          font-kerning: normal;
        }
        input,
        select,
        textarea,
        button {
          font: inherit;
        }
      `;
      document.head.appendChild(style);
    }

    repairPurchaseOrderNode(document.body);
    installPurchaseOrderObserver();
    repairPurchaseOrderClipboard();
  }

  async function boot() {
    try {
      await injectPartial(navMount, "partials/easy-nav.html");
      await injectPartial(headerMount, "partials/easy-header.html");

      const config = deriveModule();
      const badge = document.getElementById("easyBadge");
      const title = document.getElementById("easyTitle");
      const subtitle = document.getElementById("easySubtitle");

      if (badge) {
        if (badge.tagName === "IMG") {
          badge.src = BRAND.logoOnLight;
          badge.alt = "";
        } else {
          replaceIdentityWithLogo(badge, BRAND.logoOnLight);
        }
      }
      if (title) title.textContent = config.title || BRAND.name;
      if (subtitle) subtitle.textContent = config.subtitle || "Practical business tools";

      ensureFavicons();
      applyBranding();
      applyPurchaseOrderPolish();
    } catch (error) {
      console.warn("EasyFile core load warning:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
