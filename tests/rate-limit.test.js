"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRateLimit, isAllowedOrigin, LIMITS, _memory } = require("../netlify/functions/rate-limit");

const ev = (ip, headers = {}) => ({ headers: { host: "civil-expert-vijay.netlify.app", "x-nf-client-connection-ip": ip, ...headers } });

test("blocks an IP after the hourly limit, others unaffected", async () => {
  _memory.clear();
  for (let i = 0; i < LIMITS.perIpPerHour; i += 1) assert.equal(await checkRateLimit(ev("1.1.1.1"), { store: null }), null);
  const refused = await checkRateLimit(ev("1.1.1.1"), { store: null });
  assert.equal(refused.statusCode, 429);
  assert.equal(await checkRateLimit(ev("2.2.2.2"), { store: null }), null);
});

test("uses a Blobs-like store when given one", async () => {
  const data = new Map();
  const store = { get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); } };
  await checkRateLimit(ev("3.3.3.3"), { store });
  assert.ok([...data.keys()].some((k) => k.startsWith("ip/3.3.3.3/")));
  assert.ok([...data.keys()].some((k) => k.startsWith("site/")));
});

test("falls back to memory when the store throws", async () => {
  const store = { get: async () => { throw new Error("down"); }, set: async () => {} };
  assert.equal(await checkRateLimit(ev("4.4.4.4"), { store }), null);
});

test("origin check", () => {
  assert.equal(isAllowedOrigin(ev("x")), true); // no Origin (same-origin GET-style / curl)
  assert.equal(isAllowedOrigin(ev("x", { origin: "https://civil-expert-vijay.netlify.app" })), true);
  assert.equal(isAllowedOrigin(ev("x", { origin: "https://deploy-preview-3--civil-expert-vijay.netlify.app" })), true);
  assert.equal(isAllowedOrigin(ev("x", { origin: "http://localhost:8888" })), true);
  assert.equal(isAllowedOrigin(ev("x", { origin: "https://evil.example" })), false);
  assert.equal(isAllowedOrigin(ev("x", { origin: "not a url" })), false);
});
