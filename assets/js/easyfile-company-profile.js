/* Shared EasyFile company profile storage and helpers */
(function () {
  "use strict";

  const STORAGE_KEY = "easy.company.profile.v1";
  const EVENT_NAME = "easyfile:company-profile-changed";

  const DEFAULT_PROFILE = Object.freeze({
    companyName: "",
    tradingName: "",
    registrationNumber: "",
    vatNumber: "",
    address: "",
    postalAddress: "",
    phone: "",
    email: "",
    website: "",
    slogan: "",
    logo: "",
    signature: "",
    signatoryName: "",
    signatoryTitle: "",
    footerText: "",
    legalDisclaimer: "",
    brandColour: "#2563eb",
    updatedAt: ""
  });

  function cloneDefaults() {
    return { ...DEFAULT_PROFILE };
  }

  function normalize(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      ...cloneDefaults(),
      ...source,
      brandColour: /^#[0-9a-f]{6}$/i.test(String(source.brandColour || "")) ? source.brandColour : DEFAULT_PROFILE.brandColour,
      updatedAt: source.updatedAt || ""
    };
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch (error) {
      console.warn("EasyFile company profile could not be loaded.", error);
      return cloneDefaults();
    }
  }

  function save(profile) {
    const value = normalize({ ...profile, updatedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { profile: value } }));
    return value;
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
    const profile = cloneDefaults();
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { profile } }));
    return profile;
  }

  function hasProfile() {
    const profile = load();
    return Boolean(profile.companyName || profile.tradingName || profile.logo || profile.email || profile.phone);
  }

  function readFileAsDataUrl(file, options) {
    const config = { maxBytes: 2.5 * 1024 * 1024, ...options };
    return new Promise((resolve, reject) => {
      if (!file) return resolve("");
      if (!String(file.type || "").startsWith("image/")) return reject(new Error("Please select an image file."));
      if (file.size > config.maxBytes) return reject(new Error("Image is too large. Use an image smaller than 2.5 MB."));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  function download(profile, filename) {
    const blob = new Blob([JSON.stringify(normalize(profile || load()), null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "easyfile-company-profile.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("Choose a company profile JSON file first."));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The profile file could not be read."));
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result || "{}"));
          resolve(save(parsed));
        } catch (_) {
          reject(new Error("That file is not a valid EasyFile company profile."));
        }
      };
      reader.readAsText(file);
    });
  }

  function displayName(profile) {
    const value = normalize(profile || load());
    return value.tradingName || value.companyName || "Your Company";
  }

  window.EasyFileCompanyProfile = Object.freeze({
    STORAGE_KEY,
    EVENT_NAME,
    DEFAULT_PROFILE,
    load,
    save,
    clear,
    hasProfile,
    normalize,
    readFileAsDataUrl,
    download,
    importFromFile,
    displayName
  });
})();
