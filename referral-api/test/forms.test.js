"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { hashToken, normalizeForm, validateResponse, publicForm, readBoundedJson } = require("../src/functions/forms");

test("owner tokens hash deterministically", () => {
  assert.equal(hashToken("owner-token-123"), hashToken("owner-token-123"));
  assert.notEqual(hashToken("owner-token-123"), hashToken("owner-token-456"));
});

test("forms are normalised and public output excludes owner credentials", () => {
  const entity = normalizeForm({
    id: "form-123",
    title: "Customer Discovery",
    category: "Customer Intake",
    fields: [{ id: "name", type: "text", label: "Name", required: true }],
    settings: { collectEmail: true }
  }, "form-123");
  entity.ownerTokenHash = hashToken("secret");
  const output = publicForm(entity);
  assert.equal(output.id, "form-123");
  assert.equal(output.fields[0].label, "Name");
  assert.equal("ownerTokenHash" in output, false);
});

test("required response fields are enforced", () => {
  const form = normalizeForm({
    id: "form-123",
    fields: [
      { id: "name", type: "text", label: "Name", required: true },
      { id: "notes", type: "textarea", label: "Notes", required: false }
    ]
  }, "form-123");

  assert.deepEqual(validateResponse(form, { answers: { notes: "hello" } }), {
    ok: false,
    missing: ["name"]
  });
  assert.equal(validateResponse(form, { answers: { name: "Raydo" } }).ok, true);
});

test("rejects unknown answers and non-scalar field injections", () => {
  const form = normalizeForm({ fields: [{ id: "name", type: "text", required: true }] }, "form-1");
  assert.equal(validateResponse(form, { answers: { name: { injected: true } } }).error, "invalid_answer_type");
  assert.equal(validateResponse(form, { answers: { name: "Alice", admin: "true" } }).error, "unknown_answer_field");
});

test("enforces answer length and allowed options", () => {
  const form = normalizeForm({ fields: [{ id: "plan", type: "select", options: ["Basic", "Pro"] }, { id: "notes", type: "textarea" }] }, "form-2");
  assert.equal(validateResponse(form, { answers: { plan: "Admin" } }).error, "invalid_option");
  assert.equal(validateResponse(form, { answers: { notes: "x".repeat(10001) } }).error, "answer_too_long");
  assert.equal(validateResponse(form, { answers: { plan: "Pro" } }).ok, true);
});

test("validates email, numeric, date and consent values", () => {
  const form = normalizeForm({ fields: [
    { id: "email", type: "email" }, { id: "attendees", type: "number" },
    { id: "when", type: "date" }, { id: "agreement", type: "consent" }
  ] }, "form-3");
  assert.equal(validateResponse(form, { answers: { email: "invalid" } }).error, "invalid_email");
  assert.equal(validateResponse(form, { answers: { attendees: "twelve" } }).error, "invalid_number");
  assert.equal(validateResponse(form, { answers: { when: "next week" } }).error, "invalid_date");
  assert.equal(validateResponse(form, { answers: { agreement: "perhaps" } }).error, "invalid_consent");
  assert.equal(validateResponse(form, { answers: { email: "person@example.org", attendees: "12", when: "2026-11-12", agreement: "Yes" } }).ok, true);
});

test("requires email for published forms configured to collect it", () => {
  const form = normalizeForm({ fields: [], settings: { collectEmail: true } }, "form-4");
  assert.equal(validateResponse(form, { answers: {} }).error, "respondent_email_required");
  assert.equal(validateResponse(form, { answers: { _respondentEmail: "person@example.org" } }).ok, true);
});

test("rejects oversized form bodies using actual UTF-8 bytes", async () => {
  const request = {
    headers: new Map(),
    text: async () => JSON.stringify({ text: "é".repeat(40) })
  };
  await assert.rejects(readBoundedJson(request, 40), (error) => error.statusCode === 413);
});

test("rejects non-object or malformed JSON requests", async () => {
  for (const raw of ["{", "[]", "null"]) {
    await assert.rejects(
      readBoundedJson({ headers: new Map(), text: async () => raw }, 1024),
      (error) => error.statusCode === 400
    );
  }
});

test("rejects oversized content-length before reading a body", async () => {
  const request = {
    headers: new Map([["content-length", "1200"]]),
    text: async () => { throw new Error("must not read oversized request"); }
  };
  await assert.rejects(readBoundedJson(request, 1024), (error) => error.statusCode === 413);
});
