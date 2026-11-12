"use strict";

const crypto = require("node:crypto");
const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");

const FORM_TABLE = safeTableName(process.env.EASYFILE_FORMS_TABLE || "EasyFileForms");
const RESPONSE_TABLE = safeTableName(process.env.EASYFILE_FORM_RESPONSES_TABLE || "EasyFileFormResponses");
const DEFAULT_ORIGINS = [
  "https://www.easyfile.co.za",
  "https://easyfile.co.za",
  "https://easy-online-office.github.io"
];
let formTablePromise;
let responseTablePromise;

function safeTableName(value) {
  const name = String(value || "").trim();
  return /^[A-Za-z][A-Za-z0-9]{2,62}$/.test(name) ? name : "EasyFileForms";
}

function connectionString() {
  return process.env.EASYFILE_FORMS_STORAGE || process.env.EASYFILE_REFERRALS_STORAGE || process.env.AzureWebJobsStorage || "";
}

function configuredOrigins() {
  return String(process.env.EASYFILE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .concat(DEFAULT_ORIGINS)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function cors(request) {
  const origin = request.headers.get("origin") || "";
  const allowed = configuredOrigins();
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "Content-Type, X-EasyForm-Owner-Token",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(request, status, body) {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request) }, jsonBody: body };
}

function text(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicForm(entity) {
  if (!entity) return null;
  return {
    id: entity.rowKey,
    title: entity.title || "Untitled form",
    category: entity.category || "Business",
    description: entity.description || "",
    fields: parseJson(entity.fieldsJson, []),
    settings: parseJson(entity.settingsJson, {}),
    publishedAt: entity.publishedAt || entity.timestamp || null,
    updatedAt: entity.updatedAt || null
  };
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function normalizeForm(body, id) {
  const fields = Array.isArray(body?.fields) ? body.fields.slice(0, 100).map((field) => ({
    id: text(field.id || uid("field"), 100),
    type: text(field.type || "text", 30),
    label: text(field.label || "Question", 200),
    help: text(field.help || "", 500),
    required: Boolean(field.required),
    placeholder: text(field.placeholder || "", 300),
    options: Array.isArray(field.options) ? field.options.slice(0, 100).map((x) => text(x, 200)) : []
  })) : [];
  return {
    partitionKey: "form",
    rowKey: text(id || body?.id || uid("form"), 120),
    title: text(body?.title || "Untitled form", 200),
    category: text(body?.category || "Business", 80),
    description: text(body?.description || "", 2000),
    fieldsJson: JSON.stringify(fields),
    settingsJson: JSON.stringify(body?.settings || {}),
    updatedAt: new Date().toISOString()
  };
}

function validateResponse(form, body) {
  const answers = body?.answers && typeof body.answers === "object" ? body.answers : {};
  const fields = parseJson(form.fieldsJson, []);
  const missing = fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = answers[field.id];
      if (Array.isArray(value)) return value.length === 0;
      return value === undefined || value === null || value === "" || value === false || value === "No";
    })
    .map((field) => field.id);
  if (missing.length) return { ok: false, missing };
  return { ok: true, answers };
}

async function table(name, cacheName) {
  if (!connectionString()) throw new Error("Storage is not configured.");
  if (!globalThis[cacheName]) {
    globalThis[cacheName] = (async () => {
      const client = TableClient.fromConnectionString(connectionString(), name);
      try { await client.createTable(); } catch (error) { if (error.statusCode !== 409) throw error; }
      return client;
    })();
  }
  return globalThis[cacheName];
}
async function formsTable() { return table(FORM_TABLE, "__easyFormTablePromise"); }
async function responsesTable() { return table(RESPONSE_TABLE, "__easyFormResponsesTablePromise"); }

async function getFormEntity(id) {
  try { return await (await formsTable()).getEntity("form", id); }
  catch (error) { if (error.statusCode === 404) return null; throw error; }
}

function authorised(entity, request) {
  const supplied = request.headers.get("x-easyform-owner-token") || "";
  if (!entity?.ownerTokenHash || !supplied) return false;
  const a = Buffer.from(entity.ownerTokenHash);
  const b = Buffer.from(hashToken(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.http("easyFormPreflight", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "easy-form/{*rest}",
  handler: async (request) => ({ status: 204, headers: cors(request) })
});

app.http("easyFormCreate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "easy-form/forms",
  handler: async (request) => {
    try {
      const body = await request.json();
      const ownerToken = text(body.ownerToken, 256);
      if (ownerToken.length < 24) return json(request, 400, { ok: false, error: "owner_token_required" });
      const entity = normalizeForm(body, body.id);
      const existing = await getFormEntity(entity.rowKey);
      if (existing && !authorised(existing, request) && hashToken(ownerToken) !== existing.ownerTokenHash) {
        return json(request, 403, { ok: false, error: "forbidden" });
      }
      entity.ownerTokenHash = existing?.ownerTokenHash || hashToken(ownerToken);
      entity.publishedAt = existing?.publishedAt || new Date().toISOString();
      await (await formsTable()).upsertEntity(entity, "Merge");
      return json(request, existing ? 200 : 201, { ok: true, form: publicForm(entity) });
    } catch (error) {
      return json(request, 500, { ok: false, error: "form_save_failed", message: text(error.message, 300) });
    }
  }
});

app.http("easyFormGet", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "easy-form/forms/{formId}",
  handler: async (request) => {
    try {
      const form = await getFormEntity(text(request.params.formId, 120));
      if (!form) return json(request, 404, { ok: false, error: "form_not_found" });
      return json(request, 200, { ok: true, form: publicForm(form) });
    } catch (error) {
      return json(request, 500, { ok: false, error: "form_read_failed", message: text(error.message, 300) });
    }
  }
});

app.http("easyFormSubmit", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "easy-form/forms/{formId}/responses",
  handler: async (request) => {
    try {
      const formId = text(request.params.formId, 120);
      const form = await getFormEntity(formId);
      if (!form) return json(request, 404, { ok: false, error: "form_not_found" });
      const body = await request.json();
      const validation = validateResponse(form, body);
      if (!validation.ok) return json(request, 400, { ok: false, error: "required_fields_missing", missing: validation.missing });
      const response = {
        partitionKey: formId,
        rowKey: uid("resp"),
        formTitle: form.title,
        status: "New",
        answersJson: JSON.stringify(validation.answers),
        respondentEmail: text(body.respondentEmail || validation.answers?._respondentEmail || "", 254),
        reviewNote: "",
        submittedAt: new Date().toISOString(),
        reviewedAt: ""
      };
      await (await responsesTable()).createEntity(response);
      return json(request, 201, { ok: true, responseId: response.rowKey, submittedAt: response.submittedAt });
    } catch (error) {
      return json(request, 500, { ok: false, error: "response_submit_failed", message: text(error.message, 300) });
    }
  }
});

app.http("easyFormResponses", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "easy-form/forms/{formId}/responses",
  handler: async (request) => {
    try {
      const formId = text(request.params.formId, 120);
      const form = await getFormEntity(formId);
      if (!form) return json(request, 404, { ok: false, error: "form_not_found" });
      if (!authorised(form, request)) return json(request, 403, { ok: false, error: "forbidden" });
      const items = [];
      for await (const entity of (await responsesTable()).listEntities({ queryOptions: { filter: `PartitionKey eq '${formId.replace(/'/g, "''")}'` } })) {
        items.push({
          id: entity.rowKey,
          formId,
          formTitle: entity.formTitle || form.title,
          status: entity.status || "New",
          answers: parseJson(entity.answersJson, {}),
          submittedAt: entity.submittedAt || null,
          reviewedAt: entity.reviewedAt || null,
          reviewNote: entity.reviewNote || ""
        });
      }
      items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
      return json(request, 200, { ok: true, responses: items });
    } catch (error) {
      return json(request, 500, { ok: false, error: "responses_read_failed", message: text(error.message, 300) });
    }
  }
});

app.http("easyFormResponseUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "easy-form/forms/{formId}/responses/{responseId}",
  handler: async (request) => {
    try {
      const formId = text(request.params.formId, 120);
      const responseId = text(request.params.responseId, 120);
      const form = await getFormEntity(formId);
      if (!form) return json(request, 404, { ok: false, error: "form_not_found" });
      if (!authorised(form, request)) return json(request, 403, { ok: false, error: "forbidden" });
      const body = await request.json();
      const entity = {
        partitionKey: formId,
        rowKey: responseId,
        status: ["New", "Reviewed", "Flagged"].includes(body.status) ? body.status : "New",
        reviewNote: text(body.reviewNote || "", 1000),
        reviewedAt: body.status === "New" ? "" : new Date().toISOString()
      };
      await (await responsesTable()).updateEntity(entity, "Merge");
      return json(request, 200, { ok: true });
    } catch (error) {
      return json(request, error.statusCode === 404 ? 404 : 500, { ok: false, error: "response_update_failed", message: text(error.message, 300) });
    }
  }
});

app.http("easyFormResponseDelete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "easy-form/forms/{formId}/responses/{responseId}",
  handler: async (request) => {
    try {
      const formId = text(request.params.formId, 120);
      const responseId = text(request.params.responseId, 120);
      const form = await getFormEntity(formId);
      if (!form) return json(request, 404, { ok: false, error: "form_not_found" });
      if (!authorised(form, request)) return json(request, 403, { ok: false, error: "forbidden" });
      await (await responsesTable()).deleteEntity(formId, responseId);
      return json(request, 200, { ok: true });
    } catch (error) {
      return json(request, error.statusCode === 404 ? 404 : 500, { ok: false, error: "response_delete_failed", message: text(error.message, 300) });
    }
  }
});

module.exports = { hashToken, normalizeForm, validateResponse, publicForm };
