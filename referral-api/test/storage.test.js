"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.EASYFILE_STORAGE_ENCRYPTION_KEY = "test-only-storage-encryption-key-with-more-than-32-characters";

const { signState, verifyState, safeName, joinRemote, assertPublicEndpoint } = require("../src/storage/core");
const { oauthConfig } = require("../src/storage/oauth");

 test("storage OAuth state is signed and tamper evident", () => {
  const state = signState({ nonce:"example-nonce-123456", exp:Date.now()+60_000 });
  assert.equal(verifyState(state).nonce, "example-nonce-123456");
  assert.throws(() => verifyState(`${state}x`), /invalid_oauth_state/);
});

test("storage paths are normalised", () => {
  assert.equal(safeName("../invoice.pdf"), "invoice.pdf");
  assert.equal(joinRemote("/EasyFile/", "/2026/", "invoice.pdf"), "/EasyFile/2026/invoice.pdf");
});

test("OAuth provider reports missing credentials", () => {
  delete process.env.EASYFILE_GOOGLE_CLIENT_ID;
  delete process.env.EASYFILE_GOOGLE_CLIENT_SECRET;
  assert.equal(oauthConfig("google-drive").configured, false);
});

test("private and loopback connector endpoints are blocked", async () => {
  await assert.rejects(() => assertPublicEndpoint("127.0.0.1"), /private_storage_endpoint_blocked/);
  await assert.rejects(() => assertPublicEndpoint("http://10.0.0.1/storage"), /private_storage_endpoint_blocked/);
  await assert.rejects(() => assertPublicEndpoint("localhost"), /private_storage_endpoint_blocked/);
});
