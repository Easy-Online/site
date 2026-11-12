"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { hashToken, normalizeForm, validateResponse, publicForm } = require("../src/functions/forms");

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
