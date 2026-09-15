/* Easy Capture receipt/invoice parser. Pure functions are exposed for browser diagnostics and regression testing. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EasyCaptureParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MONTHS = Object.freeze({
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  });

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\u00a0/g, " ")
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function parseNumber(value) {
    let raw = String(value || "").replace(/[^0-9,.-]/g, "").trim();
    if (!raw) return null;
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) raw = raw.replace(/\./g, "").replace(",", ".");
      else raw = raw.replace(/,/g, "");
    } else if (lastComma >= 0) {
      const decimals = raw.length - lastComma - 1;
      raw = decimals === 2 ? raw.replace(",", ".") : raw.replace(/,/g, "");
    }
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function moneyMatch(line) {
    const matches = String(line || "").match(/(?:ZAR\s*|R\s*|\$\s*|€\s*|£\s*)?(-?\d[\d\s.,]*[.,]\d{2})\b/gi);
    if (!matches || !matches.length) return null;
    return parseNumber(matches[matches.length - 1]);
  }

  function labelledMoney(lines, labels, options) {
    const excluded = options?.excluded || [];
    for (const original of lines) {
      const line = original.toLowerCase();
      if (excluded.some((word) => line.includes(word))) continue;
      for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const after = original.match(new RegExp(`^\\s*${escaped}\\s*(?:[:=.-]+\\s*)?(?:ZAR\\s*|R\\s*)?(-?\\d[\\d\\s.,]*[.,]\\d{2})\\b`, "i"));
        if (after) return parseNumber(after[1]);
        const before = original.match(new RegExp(`(?:ZAR\\s*|R\\s*)?(-?\\d[\\d\\s.,]*[.,]\\d{2})\\s*${escaped}\\b`, "i"));
        if (before) return parseNumber(before[1]);
      }
    }
    return null;
  }

  function isoDate(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function parseDate(text) {
    const value = normalizeText(text);
    let match = value.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.]([0-2]?\d|3[01])\b/);
    if (match) return isoDate(match[1], match[2], match[3]);
    match = value.match(/\b([0-2]?\d|3[01])[-\/.](0?[1-9]|1[0-2])[-\/.](20\d{2})\b/);
    if (match) return isoDate(match[3], match[2], match[1]);
    match = value.match(/\b([0-2]?\d|3[01])\s*[/\-. ]\s*([A-Za-z]{3,9})\s*[/\-. ,]\s*(20\d{2})\b/i);
    if (match) {
      const month = MONTHS[match[2].toLowerCase()];
      if (month) return isoDate(match[3], month, match[1]);
    }
    match = value.match(/\b([0-2]?\d|3[01])\s+([A-Za-z]{3,9})\s+(20\d{2})\b/i);
    if (match) {
      const month = MONTHS[match[2].toLowerCase()];
      if (month) return isoDate(match[3], month, match[1]);
    }
    return "";
  }

  function detectDocumentNumber(text) {
    const patterns = [
      /\b(?:tax\s*inv(?:oice)?|invoice|inv)\s*(?:no\.?|num(?:ber)?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i,
      /\b(?:inv#|invoice#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i,
      /\breceipt\s*(?:no\.?|num(?:ber)?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i,
      /\b(?:document)\s*(?:no\.?|num(?:ber)?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return "";
  }

  function detectVatNumber(text) {
    const match = text.match(/\bVAT\s*(?:NO\.?|NUMBER|REG(?:ISTRATION)?|#)?\s*[:#.-]?\s*([A-Z]?\d{9,12})\b/i);
    return match ? match[1] : "";
  }

  function detectSupplier(lines) {
    const excluded = /^(?:copy\b|tax invoice\b|invoice\b|receipt\b|take\s*-?\s*away\b|terminal\b|operator\b|shift\b|date\b|order\b|cashier\b|table\b|tel\b|fax\b|vat\b|item\b|qty\b|amount\b|sub\s*total\b|subtotal\b|total\b|paid\b|change\b|thank\b|apps accepted\b|gaap\b)/i;
    for (const raw of lines.slice(0, 14)) {
      const line = raw.replace(/^[^A-Za-z0-9]+/, "").trim();
      if (line.length < 3 || line.length > 72 || excluded.test(line)) continue;
      if (/^(?:centurion|pretoria|johannesburg|cape town|durban|wierda park)$/i.test(line)) continue;
      if (/^(?:\d|\(?0\d|www\.|https?:|[A-Z]?\d{8,})/i.test(line)) continue;
      if ((line.match(/[A-Za-z]/g) || []).length < 3) continue;
      return line;
    }
    return "";
  }

  function detectCurrency(text) {
    if (/\bZAR\b|(?:^|\s)R\s*\d/i.test(text)) return "ZAR";
    if (/\$/.test(text)) return "USD";
    if (/€/.test(text)) return "EUR";
    if (/£/.test(text)) return "GBP";
    return "ZAR";
  }

  function detectPayment(text) {
    if (/\b(?:paid\s*)?(?:c\/?card|credit\s*card|debit\s*card|card)\b/i.test(text)) return "Card";
    if (/\b(?:eft|bank\s*transfer)\b/i.test(text)) return "EFT";
    if (/\b(?:cash|tendered)\b/i.test(text)) return "Cash";
    if (/\bdebit\s*order\b/i.test(text)) return "Debit Order";
    return "";
  }

  function classifyCategory(text) {
    const value = text.toLowerCase();
    const rules = [
      [/microsoft|adobe|software|subscription|cloud|license|licence/, "Software"],
      [/uber|bolt|flight|airline|hotel|accommodation|travel/, "Travel"],
      [/fuel|petrol|diesel|shell\s+forecourt|engen|\bbp\b|sasol/, "Fuel"],
      [/cappuccino|coffee|cafe|caff[eè]|restaurant|meal|food|pie\b|take\s*-?\s*away/, "Meals"],
      [/telkom|vodacom|\bmtn\b|cell c|internet|fibre|mobile/, "Telecommunications"],
      [/laptop|computer|monitor|keyboard|mouse|printer|hardware/, "Hardware"],
      [/electricity|water|utility|municipal/, "Utilities"],
      [/consult|legal|accounting|professional fee/, "Professional Services"],
      [/stationery|office|paper|ink|toner/, "Office"]
    ];
    for (const [pattern, category] of rules) if (pattern.test(value)) return category;
    return "Other";
  }

  function isNonItemLine(line) {
    return /^(?:item sales|description|qty|quantity|amount|sub\s*total|subtotal|vat\b|total\b|grand total|paid\b|change\b|thank\b|tax invoice|invoice\b|terminal\b|operator\b|shift\b|date\b|order\b|cashier\b|table\b|covers\b|apps accepted|gaap\b|view your|tap to|packed on|sell by|total price|\*\s*non vat)/i.test(line.trim());
  }

  function parseLineItems(lines, vatPct) {
    const items = [];
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line || line.length < 4 || isNonItemLine(line)) continue;
      let match = line.match(/^(\d+(?:[.,]\d+)?)\s+(.+?)\s+(?:ZAR\s*|R\s*)?(\d[\d.,]*[.,]\d{2})$/i);
      if (match) {
        const qty = parseNumber(match[1]);
        const total = parseNumber(match[3]);
        const description = match[2].trim();
        if (qty != null && qty > 0 && total != null && description.length > 1) {
          items.push({ description, qty, unit: Number((total / qty).toFixed(2)), vatPct: Number(vatPct || 0), total });
          continue;
        }
      }
      match = line.match(/^(.+?)\s+(\d+(?:[.,]\d{1,3})?)\s+(?:ZAR\s*|R\s*)?(\d[\d.,]*[.,]\d{2})$/i);
      if (match) {
        const description = match[1].trim();
        const qty = parseNumber(match[2]);
        const total = parseNumber(match[3]);
        if (qty != null && qty > 0 && qty <= 9999 && total != null && description.length > 1 && !/\b(?:tel|fax|vat|date|shift|inv)\b/i.test(description)) {
          items.push({ description, qty, unit: Number((total / qty).toFixed(2)), vatPct: Number(vatPct || 0), total });
        }
      }
    }
    return items.slice(0, 100);
  }

  function parseReceiptText(input) {
    const text = normalizeText(input);
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const output = { warnings: [], fieldConfidence: {}, lineItems: [] };

    output.supplier = detectSupplier(lines);
    if (output.supplier) output.fieldConfidence.supplier = 82;
    output.supplierVat = detectVatNumber(text);
    if (output.supplierVat) output.fieldConfidence.supplierVat = 95;
    output.number = detectDocumentNumber(text);
    if (output.number) output.fieldConfidence.number = 95;
    output.date = parseDate(text);
    if (output.date) output.fieldConfidence.date = 96;
    output.currency = detectCurrency(text);
    output.fieldConfidence.currency = 90;
    output.paymentMethod = detectPayment(text);
    if (output.paymentMethod) output.fieldConfidence.paymentMethod = 85;
    output.category = classifyCategory(text);
    output.fieldConfidence.category = output.category === "Other" ? 55 : 82;
    output.type = /\bcredit note\b/i.test(text) ? "credit-note" : /\b(?:tax\s+invoice|invoice|inv#|tax\s+inv)\b/i.test(text) ? "supplier-invoice" : "receipt";
    output.fieldConfidence.type = 88;

    let subtotal = labelledMoney(lines, ["sub total", "subtotal", "total excl", "amount excl", "exclusive total"]);
    let vat = labelledMoney(lines, ["vat amount", "vat total", "vat"], { excluded: ["vat no", "vat number", "vat#"] });
    let total = labelledMoney(lines, ["grand total", "amount due", "total"], { excluded: ["sub total", "subtotal", "total excl", "total price", "paid"] });

    if (total == null) {
      for (const line of lines) {
        if (/^\s*total\s*[:=.-]/i.test(line)) {
          total = moneyMatch(line);
          if (total != null) break;
        }
      }
    }

    if (subtotal == null && total != null && vat != null) subtotal = total - vat;
    if (vat == null && subtotal != null && total != null) vat = total - subtotal;

    let vatPct = 15;
    if (subtotal != null && subtotal > 0 && vat != null) {
      const inferred = (vat / subtotal) * 100;
      if (inferred >= 0 && inferred <= 100) vatPct = Math.abs(inferred - 15) < 0.6 ? 15 : Number(inferred.toFixed(2));
    }

    if (subtotal != null) { output.amountExcl = subtotal.toFixed(2); output.fieldConfidence.amountExcl = 92; }
    if (vat != null) { output.vatAmt = vat.toFixed(2); output.fieldConfidence.vatAmt = 94; }
    if (total != null) { output.amountIncl = total.toFixed(2); output.fieldConfidence.amountIncl = 98; }
    output.vatPct = vatPct.toFixed(2);
    output.fieldConfidence.vatPct = subtotal != null && vat != null ? 92 : 65;

    output.lineItems = parseLineItems(lines, vatPct);
    if (output.lineItems.length) output.fieldConfidence.lineItems = 84;

    if (!output.supplier) output.warnings.push("Supplier could not be identified.");
    if (!output.date) output.warnings.push("Transaction date could not be identified.");
    if (!(total > 0)) output.warnings.push("Total amount could not be identified.");
    if (!output.number) output.warnings.push("Invoice/receipt number was not found.");

    if (subtotal != null && vat != null && total != null) {
      const difference = Math.abs((subtotal + vat) - total);
      if (difference > 0.06) output.warnings.push(`VAT arithmetic differs from total by ${difference.toFixed(2)}.`);
    }

    if (output.lineItems.length && total != null) {
      const itemTotal = output.lineItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
      const tolerance = Math.max(0.10, total * 0.015);
      if (Math.abs(itemTotal - total) > tolerance) output.warnings.push("Detected line items do not reconcile to the receipt total; review the item list.");
    }

    const requiredScores = [
      output.fieldConfidence.supplier || 0,
      output.fieldConfidence.date || 0,
      output.fieldConfidence.amountIncl || 0,
      output.fieldConfidence.category || 0
    ];
    const secondaryScores = Object.values(output.fieldConfidence).filter((value) => Number.isFinite(value));
    const requiredAverage = requiredScores.reduce((a, b) => a + b, 0) / requiredScores.length;
    const secondaryAverage = secondaryScores.length ? secondaryScores.reduce((a, b) => a + b, 0) / secondaryScores.length : 0;
    let confidence = Math.round((requiredAverage * 0.65) + (secondaryAverage * 0.35));
    if (!output.supplier || !output.date || !(total > 0)) confidence = Math.min(confidence, 74);
    if (output.warnings.some((warning) => warning.startsWith("VAT arithmetic"))) confidence = Math.min(confidence, 79);
    output.confidence = Math.max(0, Math.min(99, confidence));

    return output;
  }

  function qualityScore(text) {
    const value = normalizeText(text);
    if (!value) return 0;
    let score = Math.min(40, value.length / 12);
    if (/\b(?:total|amount due)\b/i.test(value)) score += 18;
    if (/\bvat\b/i.test(value)) score += 12;
    if (parseDate(value)) score += 12;
    if (detectDocumentNumber(value)) score += 10;
    if (value.split("\n").length >= 6) score += 8;
    return Math.min(100, Math.round(score));
  }

  return Object.freeze({ normalizeText, parseNumber, parseDate, parseLineItems, parseReceiptText, qualityScore });
});
