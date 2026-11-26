"use strict";
// Anonymous usage records for the owner dashboard (owner.html, owner-stats.js).
// One small record per question or tool task: channel, style, language, task, saved-answer hit,
// outcome and the AI tokens per model. No names or phone numbers; questions keep only their first words.
// Raw records live under ev/<day>/; once a day is over the dashboard rolls them into sum/<day> and
// deletes the raw ones. Store: Netlify Blobs "usage-events".
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");

const STORE_NAME = "usage-events";
const meterStore = new AsyncLocalStorage();

// US$ per million tokens (Claude API list prices, cache writes at the 5-minute rate = 1.25× input).
// Estimates only — Anthropic's console has the exact bill.
const PRICES = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, over100k: { in: 0.5, out: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } }
};
function priceFor(model) {
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => String(model || "").startsWith(k));
  return { price: PRICES[key || "claude-opus-5-5"], known: Boolean(key) };
}
function callCost({ model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  let { price } = priceFor(model);
  if (price.over100k && input + cacheRead + cacheWrite > 100000) price = price.over100k;
  return (input * price.in + output * price.out + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite) / 1e6;
}

// chat.js runs each request inside a meter; askClaude adds every call's tokens to it.
const withMeter = (meter, fn) => meterStore.run(meter, fn);
function meterCall(model, usage = {}) {
  const meter = meterStore.getStore();
  if (meter) meter.calls.push({ model, input: usage.input_tokens || 0, output: usage.output_tokens || 0, cacheRead: usage.cache_read_input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0 });
}

let storeOverride;
function setStoreForTests(store) { storeOverride = store; }
function openStore(event) {
  if (storeOverride !== undefined) return storeOverride;
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
    return getStore(STORE_NAME);
  } catch { return null; }
}
const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

async function record(event, data) {
  if (String(process.env.USAGE_STATS || "on").toLowerCase() === "off") return;
  const store = openStore(event);
  if (!store) return;
  const at = Date.now();
  try { await store.setJSON(`ev/${dayOf(at)}/${at}-${crypto.randomBytes(4).toString("hex")}`, { at, ...data }); }
  catch (e) { console.error("Usage record failed:", e?.name || e); }
}

const bump = (obj, key, n = 1) => { if (key) obj[key] = (obj[key] || 0) + n; };
function summarize(events) {
  const s = { questions: 0, tasks: {}, channels: {}, audiences: {}, languages: {}, cached: 0, errors: 0, limited: 0, withFiles: 0, followUps: 0, background: 0, waImports: {}, models: {}, cost: 0, unknownModels: 0,
    visitors: { devices: 0, new: 0, returning: 0, sources: {}, returningVia: {}, pages: {} } };
  const seen = new Set();   // device codes are only used to count once per day; the summary keeps no codes
  for (const e of events) {
    if (!e) continue;
    if (e.kind === "visit") {
      if (!e.vid || seen.has(e.vid)) continue;
      seen.add(e.vid);
      const v = s.visitors;
      v.devices++; bump(v.pages, e.page || "home");
      if (e.isNew) { v.new++; bump(v.sources, e.ref || "direct"); }
      else { v.returning++; if (e.via) bump(v.returningVia, e.via); }
      continue;
    }
    if (e.kind === "wa-import") { bump(s.waImports, e.importKind || "tender"); continue; }
    if (e.task) bump(s.tasks, e.task); else s.questions++;
    bump(s.channels, e.channel || "web");
    if (!e.task) { bump(s.audiences, e.audience || "worker"); bump(s.languages, e.language || "auto"); }
    if (e.cached) s.cached++;
    if (e.status === 429) s.limited++; else if (e.status >= 500) s.errors++;
    if (e.files) s.withFiles++;
    if (e.followUp) s.followUps++;
    if (e.background) s.background++;
    for (const c of e.calls || []) {
      const m = (s.models[c.model] ||= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
      m.calls++; m.input += c.input; m.output += c.output; m.cacheRead += c.cacheRead; m.cacheWrite += c.cacheWrite;
      const cost = callCost(c); m.cost += cost; s.cost += cost;
      if (!priceFor(c.model).known) s.unknownModels++;
    }
  }
  return s;
}

module.exports = { STORE_NAME, PRICES, callCost, withMeter, meterCall, record, summarize, openStore, dayOf, setStoreForTests };
