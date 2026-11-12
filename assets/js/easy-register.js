/* Easy Register — universal local-first people register */
(function () {
  "use strict";

  const STORE_KEY = "easyfile.register.v1";
  const PREF_KEY = "easyfile.register.preferences.v1";

  const TEMPLATES = Object.freeze([
    { id:"access", label:"Access control", icon:"fa-shield-halved", hint:"Visitors, gates, buildings", company:true, host:true, reason:true, vehicle:true, identity:true, signature:true },
    { id:"attendance", label:"Attendance", icon:"fa-user-check", hint:"Classes, meetings, sessions", company:false, host:false, reason:false, vehicle:false, identity:false, signature:true },
    { id:"training", label:"Training", icon:"fa-graduation-cap", hint:"Training evidence & sign-off", company:true, host:true, reason:false, vehicle:false, identity:false, signature:true },
    { id:"course", label:"Course registration", icon:"fa-book-open-reader", hint:"Learners, cohorts, programmes", company:true, host:false, reason:false, vehicle:false, identity:false, signature:true },
    { id:"event", label:"Event", icon:"fa-calendar-days", hint:"Delegates and guests", company:true, host:false, reason:false, vehicle:false, identity:false, signature:false },
    { id:"contractor", label:"Contractor", icon:"fa-helmet-safety", hint:"Site and contractor control", company:true, host:true, reason:true, vehicle:true, identity:true, signature:true },
    { id:"staff", label:"Staff movement", icon:"fa-id-badge", hint:"Staff in/out and presence", company:false, host:false, reason:true, vehicle:false, identity:false, signature:false },
    { id:"custom", label:"Custom", icon:"fa-sliders", hint:"Build your own register", company:false, host:false, reason:false, vehicle:false, identity:false, signature:false }
  ]);

  const state = {
    registers: [],
    activeId: null,
    query: "",
    status: "",
    privacy: false,
    selectedTemplate: "access",
    signatureDirty: false
  };

  const $ = (id) => document.getElementById(id);
  const nowLocalInput = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const todayISO = () => new Date().toISOString().slice(0,10);
  const uid = (prefix) => `${prefix}_${(crypto.randomUUID?.() || (Date.now().toString(36)+Math.random().toString(36).slice(2)))}`;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const normal = (v) => String(v ?? "").trim();
  const lower = (v) => normal(v).toLowerCase();

  function toast(message) {
    const el = $("registerToast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 2800);
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      state.registers = Array.isArray(raw.registers) ? raw.registers : [];
      state.activeId = raw.activeId || state.registers[0]?.id || null;
      const pref = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      state.privacy = !!pref.privacy;
    } catch (_) {
      state.registers = [];
      state.activeId = null;
    }
    autoCheckoutExpiredRegisters();
  }

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify({ registers: state.registers, activeId: state.activeId }));
    localStorage.setItem(PREF_KEY, JSON.stringify({ privacy: state.privacy }));
  }

  function activeRegister() {
    return state.registers.find((r) => r.id === state.activeId) || null;
  }

  function templateFor(id) {
    return TEMPLATES.find((t) => t.id === id) || TEMPLATES[TEMPLATES.length - 1];
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.hidden = false;
    document.body.style.overflow = "hidden";
    const focusable = el.querySelector("input:not([type=hidden]),button,select,textarea");
    setTimeout(() => focusable?.focus(), 30);
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.hidden = true;
    if (!document.querySelector(".register-modal:not([hidden])")) document.body.style.overflow = "";
  }

  function renderTemplates() {
    $("templateGrid").innerHTML = TEMPLATES.map((t) => `
      <button type="button" class="register-template ${state.selectedTemplate === t.id ? "is-selected" : ""}" data-template="${t.id}">
        <i class="fa-solid ${t.icon}" aria-hidden="true"></i>
        <strong>${esc(t.label)}</strong>
        <small>${esc(t.hint)}</small>
      </button>`).join("");
    $("templateGrid").querySelectorAll("[data-template]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedTemplate = button.dataset.template;
        applyTemplateDefaults(templateFor(state.selectedTemplate));
        renderTemplates();
      });
    });
  }

  function applyTemplateDefaults(t) {
    $("reqCompany").checked = !!t.company;
    $("reqHost").checked = !!t.host;
    $("reqReason").checked = !!t.reason;
    $("reqVehicle").checked = !!t.vehicle;
    $("reqId").checked = !!t.identity;
    $("reqSignature").checked = !!t.signature;
    if (!$("registerNotice").value) {
      $("registerNotice").value = t.id === "access" || t.id === "contractor"
        ? "Information is collected for access control, safety, security and incident-response purposes. Only provide information necessary for this visit."
        : "Information is collected to record registration, participation, attendance and related evidence for this session or programme.";
    }
  }

  function clearRegisterForm() {
    $("registerForm").reset();
    $("registerId").value = "";
    $("registerStart").value = todayISO();
    $("registerEnd").value = todayISO();
    $("requireConsent").checked = true;
    $("customFieldBuilder").innerHTML = "";
    state.selectedTemplate = "access";
    applyTemplateDefaults(templateFor("access"));
    renderTemplates();
  }

  function showRegisterBuilder(register = null) {
    clearRegisterForm();
    if (register) {
      $("registerModalTitle").textContent = "Edit register";
      $("registerId").value = register.id;
      $("registerName").value = register.name || "";
      $("registerLocation").value = register.location || "";
      $("registerStart").value = register.start || "";
      $("registerEnd").value = register.end || "";
      $("registerExpected").value = register.expected || "";
      $("registerOwner").value = register.owner || "";
      $("registerNotice").value = register.notice || "";
      $("reqSignature").checked = !!register.requirements?.signature;
      $("reqId").checked = !!register.requirements?.identity;
      $("reqCompany").checked = !!register.requirements?.company;
      $("reqHost").checked = !!register.requirements?.host;
      $("reqReason").checked = !!register.requirements?.reason;
      $("reqVehicle").checked = !!register.requirements?.vehicle;
      $("autoCheckout").checked = !!register.autoCheckout;
      $("requireConsent").checked = register.requireConsent !== false;
      state.selectedTemplate = register.type || "custom";
      renderTemplates();
      (register.customFields || []).forEach((field) => addCustomFieldRow(field));
    } else {
      $("registerModalTitle").textContent = "New register";
    }
    openModal("registerModal");
  }

  function addCustomFieldRow(field = {}) {
    const row = document.createElement("div");
    row.className = "register-field-row";
    row.innerHTML = `
      <input class="custom-field-label" maxlength="60" placeholder="Field label" value="${esc(field.label || "")}">
      <select class="custom-field-type">
        <option value="text" ${field.type === "text" || !field.type ? "selected" : ""}>Text</option>
        <option value="number" ${field.type === "number" ? "selected" : ""}>Number</option>
        <option value="date" ${field.type === "date" ? "selected" : ""}>Date</option>
        <option value="yesno" ${field.type === "yesno" ? "selected" : ""}>Yes / No</option>
      </select>
      <button type="button" class="register-icon-btn register-danger" title="Remove field"><i class="fa-solid fa-trash"></i></button>`;
    row.querySelector("button").addEventListener("click", () => row.remove());
    $("customFieldBuilder").appendChild(row);
  }

  function collectCustomFields() {
    return Array.from(document.querySelectorAll("#customFieldBuilder .register-field-row")).map((row) => ({
      id: row.dataset.id || uid("field"),
      label: normal(row.querySelector(".custom-field-label").value),
      type: row.querySelector(".custom-field-type").value
    })).filter((f) => f.label);
  }

  function saveRegisterFromForm(event) {
    event.preventDefault();
    const id = $("registerId").value || uid("register");
    const existing = state.registers.find((r) => r.id === id);
    const record = {
      id,
      name: normal($("registerName").value),
      type: state.selectedTemplate,
      location: normal($("registerLocation").value),
      start: $("registerStart").value,
      end: $("registerEnd").value,
      expected: Math.max(0, Number($("registerExpected").value || 0)),
      owner: normal($("registerOwner").value),
      notice: normal($("registerNotice").value),
      autoCheckout: $("autoCheckout").checked,
      requireConsent: $("requireConsent").checked,
      requirements: {
        signature: $("reqSignature").checked,
        identity: $("reqId").checked,
        company: $("reqCompany").checked,
        host: $("reqHost").checked,
        reason: $("reqReason").checked,
        vehicle: $("reqVehicle").checked
      },
      customFields: collectCustomFields(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      entries: existing?.entries || []
    };
    if (!record.name) return toast("Register name is required.");
    if (existing) Object.assign(existing, record);
    else state.registers.unshift(record);
    state.activeId = id;
    persist();
    closeModal("registerModal");
    renderAll();
    toast(existing ? "Register updated." : "Register created.");
  }

  function duplicateActive() {
    const r = activeRegister();
    if (!r) return toast("Create a register first.");
    const copy = JSON.parse(JSON.stringify(r));
    copy.id = uid("register");
    copy.name = r.name + " — Copy";
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    copy.entries = [];
    state.registers.unshift(copy);
    state.activeId = copy.id;
    persist();
    renderAll();
    toast("Register duplicated.");
  }

  function deleteActive() {
    const r = activeRegister();
    if (!r) return;
    if (!confirm(`Delete "${r.name}" and all of its entries? This cannot be undone unless you have a JSON backup.`)) return;
    state.registers = state.registers.filter((x) => x.id !== r.id);
    state.activeId = state.registers[0]?.id || null;
    persist();
    renderAll();
    toast("Register deleted.");
  }

  function showEntryForm(entry = null) {
    const r = activeRegister();
    if (!r) return showRegisterBuilder();
    $("entryForm").reset();
    $("entryId").value = "";
    $("entryIn").value = nowLocalInput();
    $("entryStatus").value = "present";
    $("entryModalTitle").textContent = entry ? "Edit entry" : "Check in";
    $("entryCompanyWrap").hidden = !r.requirements?.company;
    $("entryIdWrap").hidden = !r.requirements?.identity;
    $("entryHostWrap").hidden = !r.requirements?.host;
    $("entryReasonWrap").hidden = !r.requirements?.reason;
    $("entryVehicleWrap").hidden = !r.requirements?.vehicle;
    $("signatureSection").hidden = !r.requirements?.signature;
    $("consentWrap").hidden = r.requireConsent === false;
    $("consentText").textContent = r.notice || "I acknowledge the purpose of this register and consent to the information being recorded for that purpose.";
    $("customEntryFields").innerHTML = (r.customFields || []).map((field) => {
      const value = entry?.custom?.[field.id] ?? "";
      const type = field.type === "yesno" ? "select" : "input";
      if (type === "select") return `<label><span>${esc(field.label)}</span><select data-custom-entry="${field.id}"><option value=""></option><option value="Yes" ${value === "Yes" ? "selected" : ""}>Yes</option><option value="No" ${value === "No" ? "selected" : ""}>No</option></select></label>`;
      const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
      return `<label><span>${esc(field.label)}</span><input type="${inputType}" data-custom-entry="${field.id}" value="${esc(value)}"></label>`;
    }).join("");

    clearSignature();
    if (entry) {
      $("entryId").value = entry.id;
      $("entryName").value = entry.name || "";
      $("entryPhone").value = entry.phone || "";
      $("entryEmail").value = entry.email || "";
      $("entryCompany").value = entry.company || "";
      $("entryIdentity").value = entry.identity || "";
      $("entryHost").value = entry.host || "";
      $("entryReason").value = entry.reason || "";
      $("entryVehicle").value = entry.vehicle || "";
      $("entryIn").value = toLocalDateTimeInput(entry.checkIn);
      $("entryStatus").value = entry.status || (entry.checkOut ? "completed" : "present");
      $("entryNotes").value = entry.notes || "";
      $("entryConsent").checked = entry.consent !== false;
      if (entry.signature) restoreSignature(entry.signature);
    }
    openModal("entryModal");
  }

  function toLocalDateTimeInput(value) {
    if (!value) return nowLocalInput();
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return nowLocalInput();
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function saveEntryFromForm(event) {
    event.preventDefault();
    const r = activeRegister();
    if (!r) return;
    if (r.requireConsent !== false && !$("entryConsent").checked) return toast("Privacy acknowledgement is required for this register.");
    if (!normal($("entryName").value)) return toast("Full name is required.");

    const id = $("entryId").value || uid("entry");
    const existing = r.entries.find((e) => e.id === id);
    const checkIn = new Date($("entryIn").value || Date.now()).toISOString();
    const status = $("entryStatus").value;
    const custom = {};
    document.querySelectorAll("[data-custom-entry]").forEach((input) => { custom[input.dataset.customEntry] = input.value; });
    const signature = r.requirements?.signature ? getSignatureData() : "";
    const entry = {
      id,
      name: normal($("entryName").value),
      phone: normal($("entryPhone").value),
      email: normal($("entryEmail").value),
      company: normal($("entryCompany").value),
      identity: normal($("entryIdentity").value),
      host: normal($("entryHost").value),
      reason: normal($("entryReason").value),
      vehicle: normal($("entryVehicle").value).toUpperCase(),
      checkIn,
      checkOut: status === "completed" ? (existing?.checkOut || new Date().toISOString()) : (existing?.checkOut || ""),
      status,
      notes: normal($("entryNotes").value),
      consent: r.requireConsent === false ? true : $("entryConsent").checked,
      signature,
      custom,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (r.requirements?.signature && !signature && !existing?.signature) return toast("Signature is required for this register.");
    if (r.requirements?.identity && !entry.identity) entry.status = "exception";

    if (existing) Object.assign(existing, entry, { signature: signature || existing.signature || "" });
    else r.entries.unshift(entry);
    r.updatedAt = new Date().toISOString();
    persist();
    closeModal("entryModal");
    renderAll();
    toast(existing ? "Entry updated." : "Check-in recorded.");
  }

  function checkOut(entryId) {
    const r = activeRegister();
    const e = r?.entries.find((x) => x.id === entryId);
    if (!e) return;
    e.checkOut = new Date().toISOString();
    e.status = "completed";
    e.updatedAt = new Date().toISOString();
    persist();
    renderAll();
    toast(`${e.name} checked out.`);
  }

  function deleteEntry(entryId) {
    const r = activeRegister();
    const e = r?.entries.find((x) => x.id === entryId);
    if (!r || !e) return;
    if (!confirm(`Delete entry for ${e.name}?`)) return;
    r.entries = r.entries.filter((x) => x.id !== entryId);
    persist();
    renderAll();
    toast("Entry deleted.");
  }

  function bulkClose() {
    const r = activeRegister();
    if (!r) return toast("Create a register first.");
    const open = r.entries.filter((e) => !e.checkOut && e.status !== "completed");
    if (!open.length) return toast("There are no open entries.");
    if (!confirm(`Check out all ${open.length} currently open entries?`)) return;
    const ts = new Date().toISOString();
    open.forEach((e) => { e.checkOut = ts; e.status = "completed"; e.updatedAt = ts; });
    persist();
    renderAll();
    toast(`${open.length} entries closed.`);
  }

  function autoCheckoutExpiredRegisters() {
    const today = todayISO();
    let changed = false;
    state.registers.forEach((r) => {
      if (!r.autoCheckout || !r.end || r.end >= today) return;
      const ts = new Date(r.end + "T23:59:59").toISOString();
      r.entries.filter((e) => !e.checkOut && e.status !== "completed").forEach((e) => {
        e.checkOut = ts; e.status = "completed"; e.notes = [e.notes,"Auto-checkout at register end"].filter(Boolean).join(" · "); changed = true;
      });
    });
    if (changed) persist();
  }

  function masked(value, kind) {
    if (!state.privacy || !value) return esc(value || "");
    if (kind === "name") {
      const parts = normal(value).split(/\s+/);
      return esc(parts.map((p, i) => i === 0 ? p : p.charAt(0) + "•••").join(" "));
    }
    if (kind === "email") {
      const [a,b] = String(value).split("@");
      return esc(b ? `${a.charAt(0)}•••@${b}` : "••••");
    }
    return '<span class="register-mask">••••••••</span>';
  }

  function entryMatches(e, r) {
    const q = lower(state.query);
    if (state.status && state.status !== effectiveStatus(e)) return false;
    if (!q) return true;
    const customValues = Object.values(e.custom || {}).join(" ");
    return lower([e.name,e.phone,e.email,e.company,e.identity,e.host,e.reason,e.vehicle,e.notes,customValues,r.name,r.location].join(" ")).includes(q);
  }

  function effectiveStatus(e) {
    if (e.status === "exception") return "exception";
    if (e.status === "late") return "late";
    if (e.checkOut || e.status === "completed") return "completed";
    return "present";
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-ZA",{dateStyle:"medium",timeStyle:"short"});
  }

  function duration(e) {
    if (!e.checkIn) return "—";
    const start = new Date(e.checkIn).getTime();
    const end = e.checkOut ? new Date(e.checkOut).getTime() : Date.now();
    const mins = Math.max(0, Math.round((end - start)/60000));
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins/60)}h ${mins%60}m`;
  }

  function statusMarkup(status) {
    const label = status === "present" ? "Present" : status === "completed" ? "Completed" : status === "late" ? "Late" : "Exception";
    return `<span class="register-status register-status-${status}">${label}</span>`;
  }

  function renderRegisterList() {
    const list = $("registerList");
    if (!state.registers.length) {
      list.innerHTML = '<div class="register-empty" style="padding:1rem .5rem"><p>No registers yet.</p></div>';
      return;
    }
    list.innerHTML = state.registers.map((r) => `
      <button class="register-list-item ${r.id === state.activeId ? "is-active" : ""}" data-register-id="${r.id}">
        <span class="register-list-icon"><i class="fa-solid ${templateFor(r.type).icon}"></i></span>
        <span class="register-list-copy"><strong>${esc(r.name)}</strong><small>${esc(r.location || templateFor(r.type).label)}</small></span>
        <span class="register-list-count">${r.entries?.length || 0}</span>
      </button>`).join("");
    list.querySelectorAll("[data-register-id]").forEach((button) => button.addEventListener("click", () => {
      state.activeId = button.dataset.registerId;
      persist();
      renderAll();
    }));
  }

  function renderFilters() {
    const current = $("registerFilter").value;
    $("registerFilter").innerHTML = '<option value="">All registers</option>' + state.registers.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    $("registerFilter").value = current && state.registers.some((r) => r.id === current) ? current : "";
  }

  function renderOverview() {
    const r = activeRegister();
    if (!r) {
      $("activeTypeLabel").textContent = "No register selected";
      $("activeRegisterName").textContent = "Create your first register";
      $("activeRegisterMeta").textContent = "Choose a template and configure what evidence you need.";
      ["statTotal","statPresent","statCompleted"].forEach((id) => $(id).textContent = "0");
      $("statAttendance").textContent = "0%";
      return;
    }
    $("activeTypeLabel").textContent = templateFor(r.type).label;
    $("activeRegisterName").textContent = r.name;
    $("activeRegisterMeta").textContent = [r.location, r.owner ? `Owner: ${r.owner}` : "", r.start && r.end ? `${r.start} → ${r.end}` : (r.start || "")].filter(Boolean).join(" · ");
    const total = r.entries.length;
    const present = r.entries.filter((e) => effectiveStatus(e) === "present" || effectiveStatus(e) === "late").length;
    const completed = r.entries.filter((e) => effectiveStatus(e) === "completed").length;
    const attendance = r.expected ? Math.min(999, Math.round((new Set(r.entries.map((e) => lower(e.name))).size / r.expected) * 100)) : (total ? 100 : 0);
    $("statTotal").textContent = total;
    $("statPresent").textContent = present;
    $("statCompleted").textContent = completed;
    $("statAttendance").textContent = attendance + "%";
  }

  function visibleRegisters() {
    const filterId = $("registerFilter").value;
    if (filterId) return state.registers.filter((r) => r.id === filterId);
    const active = activeRegister();
    return active ? [active] : [];
  }

  function renderEntries() {
    const registers = visibleRegisters();
    const all = registers.flatMap((r) => (r.entries || []).map((e) => ({e,r}))).filter(({e,r}) => entryMatches(e,r));
    $("entryHead").innerHTML = `<tr><th>Name</th><th>Check in</th><th>Status</th><th>Duration</th><th>Contact / detail</th><th>Evidence</th><th class="no-print">Actions</th></tr>`;
    $("entryBody").innerHTML = all.map(({e,r}) => {
      const status = effectiveStatus(e);
      const detail = [e.company,e.reason,e.vehicle].filter(Boolean).join(" · ");
      const evidence = [
        r.requirements?.signature ? (e.signature ? "Signed" : "No signature") : "",
        r.requirements?.identity ? (e.identity ? "ID captured" : "ID missing") : "",
        r.requireConsent !== false ? (e.consent ? "Acknowledged" : "No acknowledgement") : ""
      ].filter(Boolean).join(" · ") || "Standard";
      return `<tr>
        <td><strong>${masked(e.name,"name")}</strong><br><span class="register-muted">${esc(r.name)}</span></td>
        <td>${esc(formatDateTime(e.checkIn))}</td>
        <td>${statusMarkup(status)}</td>
        <td>${esc(duration(e))}</td>
        <td>${detail ? esc(detail) + "<br>" : ""}<span class="${state.privacy ? "register-mask" : ""}">${state.privacy ? "••••" : esc(e.phone || e.email || "—")}</span></td>
        <td>${esc(evidence)}</td>
        <td class="no-print"><div class="register-row-actions">
          <button class="register-row-action" data-edit-entry="${e.id}" data-register="${r.id}">Edit</button>
          ${status !== "completed" ? `<button class="register-row-action out" data-out-entry="${e.id}" data-register="${r.id}">Check out</button>` : ""}
          <button class="register-row-action delete" data-delete-entry="${e.id}" data-register="${r.id}">Delete</button>
        </div></td>
      </tr>`;
    }).join("");
    $("emptyState").style.display = all.length ? "none" : "block";
    $("entryBody").querySelectorAll("[data-edit-entry]").forEach((b) => b.addEventListener("click", () => {
      state.activeId = b.dataset.register; persist();
      const e = activeRegister()?.entries.find((x) => x.id === b.dataset.editEntry); if (e) showEntryForm(e);
    }));
    $("entryBody").querySelectorAll("[data-out-entry]").forEach((b) => b.addEventListener("click", () => {
      state.activeId = b.dataset.register; persist(); checkOut(b.dataset.outEntry);
    }));
    $("entryBody").querySelectorAll("[data-delete-entry]").forEach((b) => b.addEventListener("click", () => {
      state.activeId = b.dataset.register; persist(); deleteEntry(b.dataset.deleteEntry);
    }));
  }

  function issueFor(r,e) {
    const issues = [];
    const status = effectiveStatus(e);
    if ((status === "present" || status === "late") && e.checkIn && Date.now() - new Date(e.checkIn).getTime() > 12*60*60*1000) issues.push("Open for more than 12 hours");
    if (r.requirements?.signature && !e.signature) issues.push("Missing signature");
    if (r.requirements?.identity && !e.identity) issues.push("Missing ID / passport");
    if (r.requireConsent !== false && !e.consent) issues.push("Missing privacy acknowledgement");
    if (status === "exception") issues.push("Marked as exception");
    return issues;
  }

  function renderExceptions() {
    const items = [];
    state.registers.forEach((r) => (r.entries || []).forEach((e) => {
      const issues = issueFor(r,e);
      if (issues.length) items.push({r,e,issues});
    }));
    $("exceptionList").innerHTML = items.length ? items.slice(0,12).map(({r,e,issues}) => `
      <div class="register-exception"><i class="fa-solid fa-circle-exclamation"></i><div><strong>${masked(e.name,"name")} · ${esc(r.name)}</strong><p>${esc(issues.join(" · "))}</p></div></div>`).join("")
      : '<div class="register-exception"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i><div><strong>No current exceptions</strong><p>Required evidence and open entries look consistent.</p></div></div>';
  }

  function renderKPIs() {
    const allEntries = state.registers.flatMap((r) => r.entries || []);
    const today = todayISO();
    const todayCount = allEntries.filter((e) => String(e.checkIn || "").slice(0,10) === today).length;
    const onSite = allEntries.filter((e) => ["present","late"].includes(effectiveStatus(e))).length;
    let exceptions = 0;
    state.registers.forEach((r) => (r.entries || []).forEach((e) => { if (issueFor(r,e).length) exceptions++; }));
    $("kpiRegisters").textContent = state.registers.length;
    $("kpiToday").textContent = todayCount;
    $("kpiOnSite").textContent = onSite;
    $("kpiExceptions").textContent = exceptions;
  }

  function renderAll() {
    renderRegisterList();
    renderFilters();
    renderOverview();
    renderEntries();
    renderExceptions();
    renderKPIs();
    $("privacyMode").checked = state.privacy;
  }

  function exportCSV() {
    const r = activeRegister();
    if (!r) return toast("Create a register first.");
    const custom = r.customFields || [];
    const headers = ["Name","Phone","Email","Company","ID/Passport","Host/Facilitator","Purpose","Vehicle","Check In","Check Out","Status","Duration","Consent","Notes",...custom.map((f)=>f.label)];
    const quote = (v) => `"${String(v ?? "").replace(/"/g,'""')}"`;
    const rows = (r.entries || []).map((e) => [
      e.name,e.phone,e.email,e.company,e.identity,e.host,e.reason,e.vehicle,e.checkIn,e.checkOut,effectiveStatus(e),duration(e),e.consent ? "Yes":"No",e.notes,...custom.map((f)=>e.custom?.[f.id] || "")
    ].map(quote).join(","));
    downloadText(`${safeFile(r.name)}.csv`,[headers.map(quote).join(","),...rows].join("\n"),"text/csv;charset=utf-8");
  }

  function exportJSON() {
    const r = activeRegister();
    if (!r) return toast("Create a register first.");
    downloadText(`${safeFile(r.name)}.json`,JSON.stringify({format:"easy-register-v1",exportedAt:new Date().toISOString(),register:r},null,2),"application/json");
  }

  function safeFile(value) { return lower(value).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "easy-register"; }
  function downloadText(filename,content,type) {
    const blob = new Blob([content],{type});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
  }

  function parseCSV(text) {
    const rows=[]; let row=[],field="",quoted=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i],n=text[i+1];
      if (c === '"' && quoted && n === '"') { field+='"'; i++; continue; }
      if (c === '"') { quoted=!quoted; continue; }
      if (c === "," && !quoted) { row.push(field); field=""; continue; }
      if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && n === "\n") i++;
        row.push(field); field="";
        if (row.some((x)=>x.trim())) rows.push(row);
        row=[]; continue;
      }
      field+=c;
    }
    row.push(field); if (row.some((x)=>x.trim())) rows.push(row);
    return rows;
  }

  async function importCSV(file) {
    const r = activeRegister();
    if (!r) return toast("Create a register first.");
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return toast("CSV has no data rows.");
    const headers = rows.shift().map(lower);
    const idx = (...names) => headers.findIndex((h) => names.includes(h));
    const nameIndex = idx("name","full name","fullname");
    if (nameIndex < 0) return toast('CSV needs a "Name" or "Full Name" column.');
    let added=0;
    rows.forEach((cols) => {
      const name = normal(cols[nameIndex]);
      if (!name) return;
      const value = (...names) => { const i=idx(...names); return i>=0 ? normal(cols[i]) : ""; };
      r.entries.push({
        id:uid("entry"),name,phone:value("phone","mobile","cell"),email:value("email"),company:value("company","organisation","organization"),
        identity:value("id","id/passport","passport"),host:value("host","facilitator"),reason:value("purpose","reason"),vehicle:value("vehicle","vehicle registration"),
        checkIn:new Date().toISOString(),checkOut:"",status:"present",notes:value("notes"),consent:true,signature:"",custom:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
      }); added++;
    });
    persist(); renderAll(); toast(`${added} entries imported.`);
  }

  function shareActive() {
    const r = activeRegister();
    if (!r) return toast("Create a register first.");
    const code = r.id.split("_").pop().slice(0,8).toUpperCase();
    const url = new URL(location.href);
    url.searchParams.set("register",r.id);
    url.hash = "check-in";
    $("shareCode").value = code;
    $("shareLink").value = url.toString();
    const box = $("qrBox");
    box.innerHTML = "";
    if (window.QRCode) {
      new QRCode(box,{text:url.toString(),width:220,height:220,colorDark:"#0f172a",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
    } else {
      box.innerHTML = '<i class="fa-solid fa-qrcode"></i>';
    }
    openModal("shareModal");
  }

  async function copyValue(id,label) {
    const text = $(id).value;
    try { await navigator.clipboard.writeText(text); toast(label + " copied."); }
    catch (_) { $(id).select(); document.execCommand("copy"); toast(label + " copied."); }
  }

  function showRollCall() {
    const present = state.registers.flatMap((r) => (r.entries || []).filter((e) => ["present","late"].includes(effectiveStatus(e))).map((e)=>({r,e})));
    $("rollCallList").innerHTML = present.length ? present.map(({r,e}) => `
      <div class="register-rollcall-item">
        <div class="register-rollcall-copy"><strong>${masked(e.name,"name")}</strong><small>${esc(r.name)} · ${esc(r.location || "No location")} · in ${esc(formatDateTime(e.checkIn))}</small></div>
        <label class="register-rollcall-mark"><input type="checkbox"> Physically confirmed</label>
      </div>`).join("") : '<div class="register-empty"><i class="fa-solid fa-circle-check"></i><h3>No one is marked present</h3><p>There are no open entries across saved registers.</p></div>';
    openModal("rollCallModal");
  }

  function seedDemo() {
    if (state.registers.length && !confirm("Add demo registers and sample entries alongside your existing data?")) return;
    const ts = Date.now();
    const demo = [
      {
        id:uid("register"),name:"Main Gate Visitor Register",type:"access",location:"Centurion Office – Reception",start:todayISO(),end:todayISO(),expected:12,owner:"Security Desk",
        notice:"Information is collected for access control, safety, security and incident-response purposes.",autoCheckout:false,requireConsent:true,
        requirements:{signature:true,identity:true,company:true,host:true,reason:true,vehicle:true},customFields:[{id:"field_badge",label:"Visitor badge",type:"text"}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
        entries:[
          {id:uid("entry"),name:"Thandi Mokoena",phone:"082 555 0142",email:"thandi@example.co.za",company:"Mokoena Consulting",identity:"9001010000000",host:"Facilities",reason:"Supplier meeting",vehicle:"GP 123-456",checkIn:new Date(ts-45*60000).toISOString(),checkOut:"",status:"present",notes:"Badge issued",consent:true,signature:"",custom:{field_badge:"V-014"},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
          {id:uid("entry"),name:"Pieter van Wyk",phone:"083 555 0188",email:"",company:"Northstar Electrical",identity:"P1234567",host:"Operations",reason:"Maintenance",vehicle:"JL 82 ZN GP",checkIn:new Date(ts-150*60000).toISOString(),checkOut:new Date(ts-25*60000).toISOString(),status:"completed",notes:"",consent:true,signature:"",custom:{field_badge:"C-008"},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
        ]
      },
      {
        id:uid("register"),name:"AI Fundamentals – Cohort Attendance",type:"training",location:"Training Room 2",start:todayISO(),end:todayISO(),expected:8,owner:"Lead Facilitator",
        notice:"Attendance is recorded as evidence of participation in this training session.",autoCheckout:false,requireConsent:true,
        requirements:{signature:false,identity:false,company:true,host:true,reason:false,vehicle:false},customFields:[{id:"field_student",label:"Student number",type:"text"},{id:"field_complete",label:"Assessment complete",type:"yesno"}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
        entries:[
          {id:uid("entry"),name:"Naledi Khumalo",phone:"",email:"naledi@example.com",company:"Skunkworks Academy",identity:"",host:"Lead Facilitator",reason:"",vehicle:"",checkIn:new Date(ts-80*60000).toISOString(),checkOut:"",status:"present",notes:"",consent:true,signature:"",custom:{field_student:"STU-104",field_complete:"Yes"},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
        ]
      }
    ];
    state.registers = [...demo,...state.registers];
    state.activeId = demo[0].id;
    persist(); renderAll(); toast("Demo registers added.");
  }

  /* Signature pad */
  let canvas,ctx,drawing=false,last=null;
  function setupSignature() {
    canvas = $("signatureCanvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      const p = event.touches?.[0] || event;
      return { x:(p.clientX-rect.left)*(canvas.width/rect.width), y:(p.clientY-rect.top)*(canvas.height/rect.height) };
    };
    const start = (e) => { drawing=true; last=point(e); state.signatureDirty=true; e.preventDefault(); };
    const move = (e) => { if(!drawing) return; const p=point(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); };
    const end = () => { drawing=false; last=null; };
    ["pointerdown"].forEach((n)=>canvas.addEventListener(n,start));
    ["pointermove"].forEach((n)=>canvas.addEventListener(n,move));
    ["pointerup","pointercancel","pointerleave"].forEach((n)=>canvas.addEventListener(n,end));
  }
  function clearSignature() { if (!ctx || !canvas) return; ctx.clearRect(0,0,canvas.width,canvas.height); state.signatureDirty=false; }
  function getSignatureData() {
    if (!canvas || !ctx || !state.signatureDirty) return "";
    return canvas.toDataURL("image/png");
  }
  function restoreSignature(data) {
    if (!data || !ctx || !canvas) return;
    const img = new Image();
    img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); state.signatureDirty=true; };
    img.src = data;
  }

  function printRollCall() {
    const was = document.title;
    document.title = "Easy Register — Emergency Roll Call";
    window.print();
    setTimeout(()=>{document.title=was;},300);
  }

  function runDiagnostics() {
    const tests = [];
    const assert = (name,condition) => tests.push({name,pass:!!condition});
    try {
      const sample = [{name:"A",status:"present",checkIn:new Date().toISOString(),checkOut:""}];
      assert("Status resolution",effectiveStatus(sample[0])==="present");
      sample[0].checkOut=new Date().toISOString(); assert("Check-out resolution",effectiveStatus(sample[0])==="completed");
      const csv=parseCSV('Name,Company\n"A, Person","ACME, Ltd"\n'); assert("CSV quoted comma",csv[1][0]==="A, Person"&&csv[1][1]==="ACME, Ltd");
      assert("Filename sanitising",safeFile("Gate Register #1")==="gate-register-1");
      const temp=templateFor("training"); assert("Template lookup",temp.label==="Training");
      assert("Persistence model",Array.isArray(state.registers));
    } catch (_) { assert("Unexpected runtime error",false); }
    return tests;
  }

  function bind() {
    $("btnNewRegister").addEventListener("click",()=>showRegisterBuilder());
    $("btnAddRegisterSide").addEventListener("click",()=>showRegisterBuilder());
    $("btnSeedDemo").addEventListener("click",seedDemo);
    $("btnEditRegister").addEventListener("click",()=>{const r=activeRegister(); if(r) showRegisterBuilder(r); else toast("Create a register first.");});
    $("btnDuplicateRegister").addEventListener("click",duplicateActive);
    $("btnDeleteRegister").addEventListener("click",deleteActive);
    $("btnOpenCheckIn").addEventListener("click",()=>showEntryForm());
    $("btnQuickCheckIn").addEventListener("click",()=>showEntryForm());
    $("btnBulkOut").addEventListener("click",bulkClose);
    $("btnShare").addEventListener("click",shareActive);
    $("btnExportCsv").addEventListener("click",exportCSV);
    $("btnExportJson").addEventListener("click",exportJSON);
    $("btnPrint").addEventListener("click",()=>window.print());
    $("btnEmergency").addEventListener("click",showRollCall);
    $("btnPrintRollCall").addEventListener("click",printRollCall);
    $("btnColumns").addEventListener("click",()=>{const r=activeRegister(); if(r) showRegisterBuilder(r); else toast("Create a register first.");});
    $("btnImportCsv").addEventListener("click",()=>{if(!activeRegister()) return toast("Create a register first.");$("csvInput").click();});
    $("csvInput").addEventListener("change",(e)=>{const file=e.target.files?.[0]; if(file) importCSV(file); e.target.value="";});
    $("registerForm").addEventListener("submit",saveRegisterFromForm);
    $("entryForm").addEventListener("submit",saveEntryFromForm);
    $("btnAddField").addEventListener("click",()=>addCustomFieldRow());
    $("btnClearSignature").addEventListener("click",clearSignature);
    $("btnCopyCode").addEventListener("click",()=>copyValue("shareCode","Register code"));
    $("btnCopyLink").addEventListener("click",()=>copyValue("shareLink","Link"));
    $("globalSearch").addEventListener("input",(e)=>{state.query=e.target.value;renderEntries();});
    $("statusFilter").addEventListener("change",(e)=>{state.status=e.target.value;renderEntries();});
    $("registerFilter").addEventListener("change",renderEntries);
    $("privacyMode").addEventListener("change",(e)=>{state.privacy=e.target.checked;persist();renderAll();});
    document.querySelectorAll("[data-close-modal]").forEach((el)=>el.addEventListener("click",()=>closeModal(el.dataset.closeModal)));
    document.addEventListener("keydown",(e)=>{if(e.key==="Escape"){document.querySelectorAll(".register-modal:not([hidden])").forEach((m)=>closeModal(m.id));}});
  }

  function handleDeepLink() {
    const params = new URLSearchParams(location.search);
    const id = params.get("register");
    if (!id) return;
    const r = state.registers.find((x)=>x.id===id);
    if (r) {
      state.activeId=id; persist(); setTimeout(()=>showEntryForm(),120);
    }
  }

  function boot() {
    load();
    bind();
    setupSignature();
    renderTemplates();
    renderAll();
    handleDeepLink();
    const diagnostics = runDiagnostics();
    const failed = diagnostics.filter((x)=>!x.pass);
    if (failed.length) console.error("Easy Register diagnostics failed:",failed);
    else console.info("Easy Register diagnostics passed:",diagnostics.length);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();