"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRateLimit, isAllowedOrigin, LIMITS, _memory } = require("../netlify/functions/rate-limit");

const ev = (ip, headers = {}) => ({ headers: { host: "constructionaiexpert.netlify.app", "x-nf-client-connection-ip": ip, ...headers } });

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
  assert.ok([...data.keys()].every((k) => !k.includes("3.3.3.3")), "raw IP must not be stored");
  assert.ok([...data.keys()].some((k) => k.startsWith("ip/")));
  assert.ok([...data.keys()].some((k) => k.startsWith("site/")));
});

test("falls back to memory when the store throws", async () => {
  const store = { get: async () => { throw new Error("down"); }, set: async () => {} };
  assert.equal(await checkRateLimit(ev("4.4.4.4"), { store }), null);
});

test("origin check", () => {
  assert.equal(isAllowedOrigin(ev("x")), true); // no Origin (same-origin GET-style / curl)
  assert.equal(isAllowedOrigin(ev("x", { origin: "https://constructionaiexpert.netlify.app" })), true);
  assert.equal(isAllowedOrigin(ev("x", { origin: "https://deploy-preview-3--constructionaiexpert.netlify.app" })), true);
  assert.equal(isAllowedOrigin(ev("x", { origin: "http://localhost:8888" })), true);
  assert.equal(isAllowedOrigin(ev("x", { origin: "https://evil.example" })), false);
  assert.equal(isAllowedOrigin(ev("x", { origin: "not a url" })), false);
});

// ---------- owner-set limits and the daily AI budget ----------
const RL = require("../netlify/functions/rate-limit");
const blobStore = () => {
  const data = new Map();
  return { data, get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null), set: async (k, v) => { data.set(k, String(v)); }, setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); } };
};

test("limits saved by the owner replace the defaults; bad values are refused", async () => {
  RL._resetCache();
  const store = blobStore();
  assert.deepEqual(await RL.currentLimits(store, { fresh: true }), RL.DEFAULTS);
  const saved = await RL.saveLimits(store, { sitePerDay: "500", perIpPerHour: 10, perIpPerDay: "", dailyBudgetUsd: 12.345 });
  assert.equal(saved.sitePerDay, 500); assert.equal(saved.perIpPerHour, 10);
  assert.equal(saved.perIpPerDay, RL.DEFAULTS.perIpPerDay, "an empty box keeps the default");
  assert.equal(saved.dailyBudgetUsd, 12.35);
  await assert.rejects(RL.saveLimits(store, { sitePerDay: 5 }), /sitePerDay must be between 10 and 100000/);
  await assert.rejects(RL.saveLimits(store, { dailyBudgetUsd: -1 }), /dailyBudgetUsd/);
  await assert.rejects(RL.saveLimits(store, { perIpPerHour: "lots" }), /perIpPerHour/);
  // a saved per-person limit is enforced
  RL._resetCache();
  for (let i = 0; i < 10; i++) assert.equal(await RL.checkRateLimit(ev("5.5.5.5"), { store }), null);
  assert.equal((await RL.checkRateLimit(ev("5.5.5.5"), { store })).statusCode, 429);
  RL._resetCache();
});

test("daily AI budget: spend is added after answers; once reached, new questions wait until tomorrow", async () => {
  RL._resetCache();
  const store = blobStore(), now = new Date("2026-11-26T10:00:00Z");
  await RL.saveLimits(store, { dailyBudgetUsd: 1 });
  RL._resetCache();
  await RL.addCost(ev("6.6.6.6"), 0.6, { store, now });
  assert.equal(await RL.checkRateLimit(ev("6.6.6.6"), { store, now }), null);
  await RL.addCost(ev("6.6.6.6"), 0.45, { store, now });
  const t = await RL.today(store, now);
  assert.equal(t.costUsd, 1.05); assert.equal(t.questions, 1);
  const refused = await RL.checkRateLimit(ev("7.7.7.7"), { store, now });
  assert.equal(refused.statusCode, 503); assert.match(refused.error, /try again tomorrow/);
  assert.equal(await RL.checkRateLimit(ev("7.7.7.7"), { store, now: new Date("2026-11-27T01:00:00Z") }), null, "a new day starts fresh");
  // budget 0 = off
  await RL.saveLimits(store, { dailyBudgetUsd: 0 }); RL._resetCache();
  assert.equal(await RL.checkRateLimit(ev("8.8.8.8"), { store, now }), null);
  RL._resetCache();
});

test("owner settings endpoint: owner key required; shows and saves limits with today's use", async () => {
  process.env.OWNER_KEY = "owner-key-123456";
  const settings = require("../netlify/functions/owner-settings");
  const store = blobStore(); settings.setStoreForTests(store); RL._resetCache();
  const call = (method, body, key = "owner-key-123456") => settings.handler({ httpMethod: method, headers: { "x-owner-key": key }, body: body && JSON.stringify(body) });
  assert.equal((await call("GET", null, "wrong")).statusCode, 401);
  assert.equal((await call("DELETE")).statusCode, 405);
  const got = JSON.parse((await call("GET")).body);
  assert.equal(got.limits.sitePerDay, RL.DEFAULTS.sitePerDay); assert.ok(got.ranges.dailyBudgetUsd); assert.equal(got.today.questions, 0);
  const bad = await call("POST", { sitePerDay: 1 });
  assert.equal(bad.statusCode, 400); assert.match(JSON.parse(bad.body).error, /between 10/);
  const ok = JSON.parse((await call("POST", { sitePerDay: 3000, dailyBudgetUsd: 25 })).body);
  assert.equal(ok.limits.sitePerDay, 3000); assert.equal(ok.limits.dailyBudgetUsd, 25);
  delete process.env.OWNER_KEY; RL._resetCache();
});
